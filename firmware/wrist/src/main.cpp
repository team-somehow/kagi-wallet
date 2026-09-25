// Leash wrist shard, M5StickS3.
//
// Talks newline-delimited JSON over USB serial. On the laptop, hub/ relays that to the
// phone app. The wrist never initiates anything except a revoke and status reports.
//
// Buttons: A (front) approves, B (side) rejects. Hold B for 2 seconds to revoke every key.

#include <Arduino.h>
#include <ArduinoJson.h>
#include <M5Unified.h>
#include <Preferences.h>

#include "frost.h"

static const char* FW = "0.1.0";

// ---- look -----------------------------------------------------------------

static uint16_t C_BG, C_TEXT, C_MUTED, C_FAINT, C_AMBER, C_RED, C_CELL;
static M5Canvas canvas(&M5.Display);
static const int W = 240, H = 135;

// ---- state ----------------------------------------------------------------

enum class Mode { Unpaired, Pairing, Home, Prompt, Result, Revoked };

struct Prompt {
  String id;
  String kind;  // "tx" or "grant"
  String title;
  String amount;
  String line1;
  String line2;
  uint8_t msg[32];
  uint8_t D1[65];
  uint8_t E1[65];
  uint32_t shownAt;
};

static Preferences prefs;
static Mode mode = Mode::Unpaired;
static bool paired = false;
static uint8_t share[32];
static uint8_t groupKey[32];
static String deviceId;
static String pairCode;
static bool pairWaitingPhone = false;
static Prompt prompt;
static String resultText;
static uint16_t resultColor;
static uint32_t resultUntil = 0;
static uint32_t lastPhone = 0;
static bool dirty = true;

// Exposure, as last reported by the phone.
static double expLeft = 0, expCap = 0, expSpent = 0;
static int expKeys = 0;
static bool warned80 = false;

// Wear detection.
static bool onArm = true;
static uint32_t lastMotion = 0;
static float lastA[3] = {0, 0, 0};
static const uint32_t STILL_MS = 120000;

static uint32_t lastStatus = 0;
static String rx;

// ---- helpers --------------------------------------------------------------

static String hex(const uint8_t* b, size_t n) {
  static const char* d = "0123456789abcdef";
  String s;
  s.reserve(n * 2);
  for (size_t i = 0; i < n; i++) {
    s += d[b[i] >> 4];
    s += d[b[i] & 15];
  }
  return s;
}

static bool unhex(const char* s, uint8_t* out, size_t n) {
  if (!s) return false;
  if (s[0] == '0' && (s[1] == 'x' || s[1] == 'X')) s += 2;
  if (strlen(s) != n * 2) return false;
  for (size_t i = 0; i < n; i++) {
    auto v = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return c - 'a' + 10;
      if (c >= 'A' && c <= 'F') return c - 'A' + 10;
      return -1;
    };
    int hi = v(s[2 * i]), lo = v(s[2 * i + 1]);
    if (hi < 0 || lo < 0) return false;
    out[i] = (hi << 4) | lo;
  }
  return true;
}

static String shortHex(const String& h, int head, int tail) {
  String s = h.startsWith("0x") ? h.substring(2) : h;
  if ((int)s.length() <= head + tail) return "0x" + s;
  return "0x" + s.substring(0, head) + ".." + s.substring(s.length() - tail);
}

static String dollars(double v) {
  char b[24];
  if (v >= 10000) snprintf(b, sizeof b, "$%.0f", v);
  else if (v == (long)v) snprintf(b, sizeof b, "$%ld", (long)v);
  else snprintf(b, sizeof b, "$%.2f", v);
  return String(b);
}

static void send(JsonDocument& doc) {
  serializeJson(doc, Serial);
  Serial.print('\n');
}

static void buzz(int times = 3) {
  for (int i = 0; i < times; i++) {
    M5.Speaker.tone(2600, 90);
    delay(150);
  }
}

static void chirp() { M5.Speaker.tone(1800, 40); }

// ---- storage --------------------------------------------------------------

static void loadShare() {
  prefs.begin("leash", true);
  paired = prefs.getBytes("share", share, 32) == 32 && prefs.getBytes("gk", groupKey, 32) == 32;
  prefs.end();
}

static void saveShare() {
  prefs.begin("leash", false);
  prefs.putBytes("share", share, 32);
  prefs.putBytes("gk", groupKey, 32);
  prefs.end();
  paired = true;
}

static void wipeShare() {
  prefs.begin("leash", false);
  prefs.clear();
  prefs.end();
  memset(share, 0, 32);
  memset(groupKey, 0, 32);
  paired = false;
}

// ---- drawing --------------------------------------------------------------

static void bar(int x, int y, int w, int h, double ratio, int cells = 20) {
  int gap = 2;
  int cw = (w - gap * (cells - 1)) / cells;
  int lit = (int)round(std::min(std::max(ratio, 0.0), 1.0) * cells);
  for (int i = 0; i < cells; i++) {
    bool on = i < lit;
    bool past = (double)i / cells >= 0.8;
    uint16_t c = !on ? C_CELL : ratio >= 1 ? C_RED : past ? C_AMBER : C_TEXT;
    canvas.fillRoundRect(x + i * (cw + gap), y, cw, h, 1, c);
  }
  int mx = x + (int)(0.8 * cells) * (cw + gap) - 1;
  canvas.drawFastVLine(mx, y - 3, h + 6, C_AMBER);
}

static void header(const char* left, uint16_t leftColor) {
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(leftColor);
  canvas.drawString(left, 8, 6);
  // Link and wear status, top right.
  bool phoneUp = millis() - lastPhone < 8000;
  canvas.setFont(&fonts::Font0);
  canvas.setTextDatum(top_right);
  canvas.setTextColor(phoneUp ? C_MUTED : C_RED);
  String s = String(phoneUp ? "phone" : "no phone") + "  " + String(M5.Power.getBatteryLevel()) + "%";
  canvas.drawString(s, W - 8, 10);
}

static void draw() {
  canvas.fillSprite(C_BG);

  if (!onArm && mode != Mode::Unpaired && mode != Mode::Pairing) {
    header("Leash", C_FAINT);
    canvas.setFont(&fonts::FreeSansBold12pt7b);
    canvas.setTextDatum(middle_left);
    canvas.setTextColor(C_MUTED);
    canvas.drawString("Shard asleep", 8, 62);
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextColor(C_FAINT);
    canvas.drawString("Off the arm. Move to wake.", 8, 94);
    canvas.pushSprite(0, 0);
    return;
  }

  switch (mode) {
    case Mode::Unpaired: {
      header("Leash", C_TEXT);
      canvas.setFont(&fonts::FreeSansBold12pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_TEXT);
      canvas.drawString("Not paired", 8, 42);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextColor(C_MUTED);
      canvas.drawString("Open Leash on your phone", 8, 78);
      canvas.drawString("and create a wallet.", 8, 98);
      break;
    }
    case Mode::Pairing: {
      header("Pairing", C_AMBER);
      canvas.setFont(&fonts::FreeMonoBold18pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_AMBER);
      canvas.drawString(pairCode, 8, 36);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextColor(C_TEXT);
      canvas.drawString(pairWaitingPhone ? "Now confirm on the phone" : "Same code on the phone?", 8, 84);
      canvas.setTextColor(C_MUTED);
      canvas.drawString(pairWaitingPhone ? "" : (paired ? "A: yes, replace wallet   B: no" : "A: yes    B: no"), 8, 108);
      break;
    }
    case Mode::Home: {
      bool hot = expCap > 0 && expSpent / expCap >= 0.8;
      header("Leash", C_TEXT);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_MUTED);
      canvas.drawString(expCap > 0 ? "Agents can still spend" : "No live keys", 8, 30);
      canvas.setFont(&fonts::FreeMonoBold18pt7b);
      canvas.setTextColor(expCap == 0 ? C_FAINT : hot ? C_AMBER : C_TEXT);
      canvas.drawString(dollars(expCap > 0 ? expLeft : 0), 8, 52);
      bar(8, 96, W - 16, 10, expCap > 0 ? expSpent / expCap : 0);
      canvas.setFont(&fonts::Font0);
      canvas.setTextColor(C_MUTED);
      canvas.setTextDatum(top_left);
      canvas.drawString(String(expKeys) + (expKeys == 1 ? " key" : " keys"), 8, 116);
      canvas.setTextDatum(top_right);
      canvas.drawString("hold B to revoke all", W - 8, 116);
      break;
    }
    case Mode::Prompt: {
      header(prompt.title.c_str(), C_AMBER);
      canvas.setFont(&fonts::FreeMonoBold18pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_AMBER);
      canvas.drawString(prompt.amount, 8, 28);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextColor(C_TEXT);
      canvas.drawString(prompt.line1, 8, 68);
      canvas.setTextColor(C_MUTED);
      canvas.drawString(prompt.line2, 8, 88);
      canvas.setTextColor(C_TEXT);
      canvas.drawString("A: sign", 8, 112);
      canvas.setTextDatum(top_right);
      canvas.setTextColor(C_MUTED);
      canvas.drawString("B: reject", W - 8, 112);
      break;
    }
    case Mode::Result: {
      header("Leash", C_TEXT);
      canvas.setFont(&fonts::FreeSansBold12pt7b);
      canvas.setTextDatum(middle_left);
      canvas.setTextColor(resultColor);
      canvas.drawString(resultText, 8, 70);
      break;
    }
    case Mode::Revoked: {
      header("Leash", C_RED);
      canvas.setFont(&fonts::FreeSansBold12pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_RED);
      canvas.drawString("All keys revoked", 8, 40);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextColor(C_MUTED);
      canvas.drawString("No agent can spend until", 8, 78);
      canvas.drawString("you issue a new key.", 8, 98);
      break;
    }
  }
  canvas.pushSprite(0, 0);
}

static void showResult(const String& text, uint16_t color, uint32_t ms = 1800) {
  resultText = text;
  resultColor = color;
  resultUntil = millis() + ms;
  mode = Mode::Result;
  dirty = true;
}

static Mode restingMode() { return paired ? Mode::Home : Mode::Unpaired; }

// ---- protocol -------------------------------------------------------------

static void sendHello() {
  JsonDocument d;
  d["t"] = "hello";
  d["id"] = deviceId;
  d["fw"] = FW;
  d["paired"] = paired;
  if (paired) d["groupKey"] = hex(groupKey, 32);
  d["battery"] = M5.Power.getBatteryLevel();
  d["onArm"] = onArm;
  send(d);
}

static void sendStatus() {
  JsonDocument d;
  d["t"] = "status";
  d["battery"] = M5.Power.getBatteryLevel();
  d["onArm"] = onArm;
  d["paired"] = paired;
  send(d);
}

static void reject(const String& id, const char* reason) {
  JsonDocument d;
  d["t"] = "sign_reject";
  d["id"] = id;
  d["reason"] = reason;
  send(d);
}

static void approvePrompt();

static void onPair(JsonDocument& in) {
  uint8_t pn[16], wn[16];
  if (!unhex(in["nonce"] | "", pn, 16)) return;
  esp_fill_random(wn, 16);
  // Pairing code: sha256("LEASH/pair" || phoneNonce || wristNonce), first 4 bytes.
  uint8_t buf[10 + 32];
  memcpy(buf, "LEASH/pair", 10);
  memcpy(buf + 10, pn, 16);
  memcpy(buf + 26, wn, 16);
  uint8_t h[32];
  frost::sha256(buf, sizeof buf, h);
  String c = hex(h, 4);
  c.toUpperCase();
  pairCode = c.substring(0, 4) + " " + c.substring(4, 8);
  pairWaitingPhone = false;
  mode = Mode::Pairing;
  dirty = true;
  chirp();
  JsonDocument d;
  d["t"] = "pair";
  d["nonce"] = hex(wn, 16);
  send(d);
#ifdef LEASH_AUTO_APPROVE
  pairWaitingPhone = true;
  JsonDocument ok;
  ok["t"] = "pair_ok";
  send(ok);
#endif
}

static void onDkg(JsonDocument& in) {
  if (mode != Mode::Pairing || !pairWaitingPhone) {
    JsonDocument d;
    d["t"] = "dkg_error";
    d["reason"] = "not_confirmed";
    send(d);
    return;
  }
  uint8_t X1[65], R1[65], s1[32], X2[65], R2[65], s2[32];
  bool ok = unhex(in["X"] | "", X1, 65) && unhex(in["pop"]["R"] | "", R1, 65) && unhex(in["pop"]["s"] | "", s1, 32);
  uint8_t newShare[32], newGk[32];
  ok = ok && frost::dkg(X1, R1, s1, X2, R2, s2, newShare, newGk);
  if (!ok) {
    JsonDocument d;
    d["t"] = "dkg_error";
    d["reason"] = "bad_proof";
    send(d);
    showResult("Pairing failed", C_RED);
    return;
  }
  memcpy(share, newShare, 32);
  memcpy(groupKey, newGk, 32);
  memset(newShare, 0, 32);
  saveShare();
  expLeft = expCap = expSpent = 0;
  expKeys = 0;
  JsonDocument d;
  d["t"] = "dkg";
  d["X"] = hex(X2, 65);
  d["pop"]["R"] = hex(R2, 65);
  d["pop"]["s"] = hex(s2, 32);
  d["groupKey"] = hex(groupKey, 32);
  send(d);
  String gk = hex(groupKey, 32);
  showResult("Key " + gk.substring(0, 4) + ".." + gk.substring(60), C_TEXT, 4000);
}

static bool decodeTx(const String& to, const String& calldata, Prompt& p) {
  // Render from the bytes, not from anything the phone or agent claims.
  String cd = calldata;
  cd.toLowerCase();
  if (cd.startsWith("0x")) cd = cd.substring(2);
  if (cd.length() < 8) return false;
  String sel = cd.substring(0, 8);
  p.amount = "?";
  p.line2 = "contract " + shortHex(to, 4, 4);
  if ((sel == "a9059cbb" || sel == "095ea7b3") && cd.length() >= 8 + 128) {
    String who = cd.substring(8 + 24, 8 + 64);
    String amt = cd.substring(8 + 64, 8 + 128);
    // Amounts are 6 decimal USDC units. Anything that does not fit in 64 bits is shown as huge.
    bool huge = false;
    for (int i = 0; i < 48; i++)
      if (amt[i] != '0') huge = true;
    uint64_t units = strtoull(amt.substring(48).c_str(), nullptr, 16);
    p.amount = huge ? String("UNLIMITED") : dollars(units / 1e6);
    p.line1 = String(sel == "a9059cbb" ? "Send to " : "Allow ") + shortHex(who, 4, 4);
    return true;
  }
  p.line1 = "Call " + sel;
  return true;
}

static void onSign(JsonDocument& in) {
  String id = in["id"] | "";
  if (!paired) return reject(id, "not_paired");
  if (!onArm) return reject(id, "off_arm");
  if (mode == Mode::Prompt) return reject(id, "busy");

  Prompt p;
  p.id = id;
  p.kind = in["kind"] | "";
  if (!unhex(in["D"] | "", p.D1, 65) || !unhex(in["E"] | "", p.E1, 65)) return reject(id, "bad_request");

  // The wrist rebuilds the message itself from what it is about to display.
  String canonical;
  String agent = in["agent"] | "agent";
  if (p.kind == "tx") {
    String to = in["to"] | "";
    String calldata = in["calldata"] | "";
    to.toLowerCase();
    calldata.toLowerCase();
    canonical = "tx|" + to + "|" + calldata;
    p.title = agent + " over cap";
    if (!decodeTx(to, calldata, p)) return reject(id, "bad_calldata");
  } else if (p.kind == "grant") {
    String pubkey = in["pubkey"] | "";
    String capMicro = in["capMicro"] | "";
    int hours = in["hours"] | 0;
    pubkey.toLowerCase();
    canonical = "grant|" + agent + "|" + pubkey + "|" + capMicro + "|" + String(hours);
    p.title = "New key";
    p.amount = dollars(strtoull(capMicro.c_str(), nullptr, 10) / 1e6);
    p.line1 = "for " + agent + ", " + String(hours) + "h";
    p.line2 = "agent key " + shortHex(pubkey, 4, 4);
  } else {
    return reject(id, "bad_kind");
  }
  frost::sha256((const uint8_t*)canonical.c_str(), canonical.length(), p.msg);
  p.shownAt = millis();
  prompt = p;
  mode = Mode::Prompt;
  dirty = true;
  draw();
  buzz();
#ifdef LEASH_AUTO_APPROVE
  approvePrompt();
#endif
}

static void approvePrompt() {
  uint8_t D2[65], E2[65], z2[32];
  if (!frost::sign(share, groupKey, prompt.msg, prompt.D1, prompt.E1, D2, E2, z2)) {
    reject(prompt.id, "sign_failed");
    showResult("Signing failed", C_RED);
    return;
  }
  JsonDocument d;
  d["t"] = "sig_share";
  d["id"] = prompt.id;
  d["D"] = hex(D2, 65);
  d["E"] = hex(E2, 65);
  d["z"] = hex(z2, 32);
  send(d);
  memset(z2, 0, 32);
  showResult("Signed", C_TEXT);
}

static void onExposure(JsonDocument& in) {
  expLeft = in["left"] | 0.0;
  expCap = in["cap"] | 0.0;
  expSpent = in["spent"] | 0.0;
  expKeys = in["keys"] | 0;
  bool hot = expCap > 0 && expSpent / expCap >= 0.8;
  if (hot && !warned80) {
    warned80 = true;
    if (mode == Mode::Home) buzz(2);
  }
  if (!hot) warned80 = false;
  if (mode == Mode::Revoked && expKeys > 0) mode = Mode::Home;
  dirty = true;
}

static void handle(const String& line) {
  JsonDocument in;
  if (deserializeJson(in, line)) return;
  String t = in["t"] | "";
  lastPhone = millis();
  if (t == "hello?") sendHello();
  else if (t == "ping") {
  } else if (t == "pair") onPair(in);
  else if (t == "pair_cancel") {
    if (mode == Mode::Pairing) mode = restingMode();
  } else if (t == "dkg") onDkg(in);
  else if (t == "sign") onSign(in);
  else if (t == "sign_cancel") {
    if (mode == Mode::Prompt && prompt.id == String(in["id"] | "")) mode = restingMode();
  } else if (t == "exposure") onExposure(in);
  else if (t == "revoked") {
    mode = paired ? Mode::Revoked : Mode::Unpaired;
    expLeft = expCap = expSpent = 0;
    expKeys = 0;
  } else if (t == "wipe") {
    wipeShare();
    mode = Mode::Unpaired;
    sendHello();
  }
  dirty = true;
}

// ---- sensors --------------------------------------------------------------

static void pollImu() {
  float a[3];
  if (!M5.Imu.getAccel(&a[0], &a[1], &a[2])) return;
  float d = fabsf(a[0] - lastA[0]) + fabsf(a[1] - lastA[1]) + fabsf(a[2] - lastA[2]);
  memcpy(lastA, a, sizeof a);
  uint32_t now = millis();
  if (d > 0.06f) {
    lastMotion = now;
    if (!onArm) {
      onArm = true;
      dirty = true;
      sendStatus();
    }
  } else if (onArm && now - lastMotion > STILL_MS) {
    onArm = false;
    if (mode == Mode::Prompt) {
      reject(prompt.id, "off_arm");
      mode = restingMode();
    }
    dirty = true;
    sendStatus();
  }
}

// ---- main -----------------------------------------------------------------

void setup() {
  auto cfg = M5.config();
  cfg.serial_baudrate = 115200;
  M5.begin(cfg);
  Serial.setRxBufferSize(4096);
  M5.Display.setRotation(1);
  M5.Display.setBrightness(110);
  M5.Speaker.setVolume(140);
  canvas.setColorDepth(16);
  canvas.createSprite(W, H);

  C_BG = M5.Display.color565(0, 0, 0);
  C_TEXT = M5.Display.color565(236, 233, 225);
  C_MUTED = M5.Display.color565(142, 147, 155);
  C_FAINT = M5.Display.color565(88, 93, 101);
  C_AMBER = M5.Display.color565(255, 177, 59);
  C_RED = M5.Display.color565(255, 90, 78);
  C_CELL = M5.Display.color565(38, 41, 47);

  uint8_t mac[6];
  esp_efuse_mac_get_default(mac);
  char id[16];
  snprintf(id, sizeof id, "wrist-%02X%02X", mac[4], mac[5]);
  deviceId = id;

  frost::init();
  loadShare();
  mode = restingMode();
  lastMotion = millis();
  draw();
  sendHello();
}

void loop() {
  M5.update();

  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n') {
      if (rx.length()) handle(rx);
      rx = "";
    } else if (c != '\r' && rx.length() < 4000) {
      rx += c;
    }
  }

  static uint32_t lastImu = 0;
  if (millis() - lastImu > 100) {
    lastImu = millis();
    pollImu();
  }

  // Buttons.
  if (mode == Mode::Pairing && !pairWaitingPhone) {
    if (M5.BtnA.wasPressed()) {
      pairWaitingPhone = true;
      chirp();
      JsonDocument d;
      d["t"] = "pair_ok";
      send(d);
      dirty = true;
    } else if (M5.BtnB.wasPressed()) {
      JsonDocument d;
      d["t"] = "pair_reject";
      send(d);
      mode = restingMode();
      dirty = true;
    }
  } else if (mode == Mode::Prompt) {
    if (M5.BtnA.wasPressed()) {
      approvePrompt();
    } else if (M5.BtnB.wasPressed()) {
      reject(prompt.id, "user");
      showResult("Rejected", C_MUTED);
    } else if (millis() - prompt.shownAt > 60000) {
      reject(prompt.id, "timeout");
      showResult("Timed out", C_MUTED);
    }
  } else if ((mode == Mode::Home || mode == Mode::Revoked) && paired && M5.BtnB.pressedFor(2000)) {
    static uint32_t lastRevoke = 0;
    if (millis() - lastRevoke > 3000) {
      lastRevoke = millis();
      JsonDocument d;
      d["t"] = "revoke_all";
      send(d);
      buzz(1);
      mode = Mode::Revoked;
      expLeft = expCap = expSpent = 0;
      expKeys = 0;
      dirty = true;
    }
  }

  if (mode == Mode::Result && millis() > resultUntil) {
    mode = restingMode();
    dirty = true;
  }

  if (millis() - lastStatus > 3000) {
    lastStatus = millis();
    sendStatus();
    dirty = true;  // refresh link indicator and battery
  }

  if (dirty) {
    dirty = false;
    draw();
  }
  delay(5);
}

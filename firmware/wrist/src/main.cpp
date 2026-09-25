// Leash wrist shard, M5StickS3.
//
// Talks newline-delimited JSON to the hub on the laptop, which relays to the phone app.
// Over WiFi the wrist dials out to the hub (it never listens). USB serial still works as
// a fallback. The wrist never initiates anything except a revoke and status reports.
//
// Buttons: A (front) approves, B (side) rejects. Hold B for 2 seconds to revoke every key.

#include <Arduino.h>
#include <algorithm>
#include <vector>
#include <time.h>
#include <ArduinoJson.h>
#include <M5Unified.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <WebSocketsClient.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_mac.h>
#include <esp_system.h>
#include <lwip/dns.h>
#include <bootloader_random.h>

#include "frost.h"
#include "ir.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

static const char* FW = "0.1.0";

// ---- look -----------------------------------------------------------------

static uint16_t C_BG, C_TEXT, C_MUTED, C_FAINT, C_AMBER, C_RED, C_CELL;
static M5Canvas canvas(&M5.Display);
static const int W = 240, H = 135;

// ---- state ----------------------------------------------------------------

enum class Mode { Unpaired, Pairing, Home, Prompt, Result, Revoked, ConfirmWipe, ConfirmWifi };

struct Prompt {
  String id;
  String kind;  // tx, grant, evm, evm_grant, root_dkg, root_reshare, root_sign, vault_sign
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
static uint32_t autoAt = 0;
static bool irQuiet = false;  // bench: stop IMU and display updates  // test firmware only: when to press A by itself
static String rx;     // USB serial line buffer
static String rxTcp;  // WiFi line buffer

// WiFi link to the hub.
static WiFiClient tcp;
static bool mdnsUp = false;
static IPAddress hubIp;
static uint32_t lastDial = 0;
static uint32_t lastTcpRx = 0;

// Relay through the public tunnel: works from any network with internet.
static WebSocketsClient relay;
static bool relayUp = false;
static bool relayStarted = false;
static String relayUrl;  // wss://host/wrist?token=..., learned from the hub

static bool tcpUp() { return tcp.connected() || relayUp; }
static int wifiReason = 0;  // last disconnect reason from the WiFi driver

// Saved networks. Added from the phone and confirmed on the wrist, kept in flash.
struct Net {
  String ssid, pass, hub;  // hub: last hub address that worked on this network
};
static const int MAX_NETS = 6;
static Net nets[MAX_NETS];
static int netCount = 0;
static int netIdx = -1;  // network we are on or trying
static uint32_t benchedUntil[MAX_NETS];  // joined fine but no hub there; skip for a while

enum class WState { Scan, Trying, Up, Backoff };
static WState wstate = WState::Scan;
static int candidates[MAX_NETS];
static int candCount = 0, candPos = 0;
static bool strictWpa2 = false;  // second attempt on a network: WPA2 without PMF
static uint32_t wstateAt = 0;
static int dialStep = 0;          // which hub address to try next
static String hintHost;           // hub address the phone told us about

// A network the phone asked to add, waiting for a press of A.
static Net pendingNet;

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

// Root key state (see the root key section further down).
static bool isVault = false;
static char lastSource = 'u';  // 'u' USB serial, 'n' network: where the current message came from

// Wrist side of the root key.
static uint8_t rshare[32], rgk[32], rX2new[32];
static int rparties = 0;  // 0 none, 2 phone + wrist, 3 with the vault
static uint8_t pendX[65], pendR[65], pendS[32], pendVaultPub[33];

struct RootJob {
  bool active = false;
  char type = 'G';  // 'G' root grant (72-byte compact), 'E' plain transaction (64-byte compact)
  String id;
  uint8_t msg[32];
  uint8_t compact[72];
  uint8_t D[3][33], E[3][33];
  frost::Nonce n;
  uint32_t sentAt = 0;
};
static RootJob rjob;

// Vault side.
static uint8_t vdevPriv[32], vdevPub[33], vshare[32], vgk[32];
static bool vJoined = false;
static uint32_t windowUntil = 0;
static bool havePiece[2] = {false, false};
static uint8_t piece[2][32];
static RootJob vjob;

static bool windowOpen() { return isVault && windowUntil && millis() < windowUntil; }

static String fingerprint(const uint8_t* pub33) {
  uint8_t h[32];
  frost::sha256(pub33, 33, h);
  String f = hex(h, 4);
  f.toUpperCase();
  return f.substring(0, 4) + " " + f.substring(4, 8);
}


// Replies go to WiFi when the hub is reachable there, otherwise to USB. With neither
// (the wrist unplugged and between networks) they wait in a small outbox.
static std::vector<String> outbox;
static void sendLine(const String& line) {
  String l = line;  // the WebSocket library takes a non-const String
  if (relayUp) relay.sendTXT(l);
  else if (tcp.connected()) tcp.print(line);
  else if (Serial) Serial.print(line);
  else if (outbox.size() < 6) outbox.push_back(line);
}
static void send(JsonDocument& doc) {
  String line;
  serializeJson(doc, line);
  line += '\n';
  sendLine(line);
}
static void flushOutbox() {
  if (outbox.empty() || !(relayUp || tcp.connected() || Serial)) return;
  std::vector<String> q;
  q.swap(outbox);
  for (auto& l : q) sendLine(l);
}

// The speaker amp has to be off for the IR receiver to work, so it is on only while beeping.
static void beep(int freq, int ms) {
  // The amp needs a moment to power up, and the tone plays from a background task:
  // wait for it to finish before switching the amp back off.
  if (!M5.Speaker.isEnabled()) M5.Speaker.begin();
  M5.Speaker.setVolume(200);
  delay(30);
  M5.Speaker.tone(freq, ms);
  uint32_t t0 = millis();
  delay(ms);
  while (M5.Speaker.isPlaying() && millis() - t0 < (uint32_t)ms + 300) delay(5);
  delay(30);
  M5.Speaker.end();
}

static void buzz(int times = 3) {
  for (int i = 0; i < times; i++) {
    beep(2600, 90);
    delay(60);
  }
}

static void chirp() { beep(1800, 40); }

// ---- storage --------------------------------------------------------------

static void loadShare() {
  prefs.begin("leash", true);
  paired = prefs.isKey("share") && prefs.isKey("gk") && prefs.getBytes("share", share, 32) == 32 &&
           prefs.getBytes("gk", groupKey, 32) == 32;
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
  const char* via = relayUp ? "relay" : tcp.connected() ? "wifi" : WiFi.status() == WL_CONNECTED ? "no hub" : "no wifi";
  String s = String(phoneUp ? via : (tcpUp() ? "no phone" : via)) + "  " + String(M5.Power.getBatteryLevel()) + "%";
  canvas.drawString(s, W - 8, 10);
}

static void drawVault();
static bool isVaultRole();
static void draw() {
  canvas.fillSprite(C_BG);
  if (isVaultRole() && (mode == Mode::Home || mode == Mode::Unpaired)) {
    drawVault();
    canvas.pushSprite(0, 0);
    return;
  }

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
    case Mode::ConfirmWipe: {
      header("Wipe", C_RED);
      canvas.setFont(&fonts::FreeSansBold12pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_RED);
      canvas.drawString("Erase this shard?", 8, 40);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextColor(C_MUTED);
      canvas.drawString("The wallet can't sign again.", 8, 78);
      canvas.setTextColor(C_TEXT);
      canvas.drawString("A: erase", 8, 108);
      canvas.setTextDatum(top_right);
      canvas.setTextColor(C_MUTED);
      canvas.drawString("B: keep", W - 8, 108);
      break;
    }
    case Mode::ConfirmWifi: {
      header("WiFi", C_AMBER);
      canvas.setFont(&fonts::FreeSansBold12pt7b);
      canvas.setTextDatum(top_left);
      canvas.setTextColor(C_AMBER);
      canvas.drawString("Join network?", 8, 32);
      canvas.setFont(&fonts::FreeSans9pt7b);
      canvas.setTextColor(C_TEXT);
      canvas.drawString(pendingNet.ssid.substring(0, 22), 8, 66);
      canvas.drawString("A: save", 8, 108);
      canvas.setTextDatum(top_right);
      canvas.setTextColor(C_MUTED);
      canvas.drawString("B: ignore", W - 8, 108);
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

static bool isVaultRole();
static Mode restingMode() { return (paired || isVaultRole()) ? Mode::Home : Mode::Unpaired; }

// ---- protocol -------------------------------------------------------------

static void sendHello() {
  JsonDocument d;
  d["t"] = "hello";
  d["id"] = deviceId;
  d["fw"] = FW;
  d["reset"] = (int)esp_reset_reason();  // 1 power-on, 3 software, 4 panic, 5-7 watchdog, 9 brownout
  d["uptime"] = millis() / 1000;
  d["via"] = relayUp ? "relay" : tcp.connected() ? "wifi" : "usb";
  d["role"] = isVault ? "vault" : "wrist";
  if (isVault) {
    d["devPub"] = hex(vdevPub, 33);
    d["fingerprint"] = fingerprint(vdevPub);
    d["joined"] = vJoined;
    if (vJoined) d["rootKey"] = hex(vgk, 32);
    d["window"] = windowOpen() ? (int)((windowUntil - millis()) / 1000) : 0;
  } else {
    d["paired"] = paired;
    if (paired) d["groupKey"] = hex(groupKey, 32);
    d["rootParties"] = rparties;
    if (rparties) d["rootKey"] = hex(rgk, 32);
  }
  d["battery"] = M5.Power.getBatteryLevel();
  d["onArm"] = onArm;
  send(d);
}

static void sendStatus() {
  JsonDocument d;
  d["t"] = "status";
  d["wifi"] = WiFi.status() == WL_CONNECTED ? WiFi.localIP().toString() : String("down ") + String((int)WiFi.status());
  d["hubIp"] = hubIp.toString();
  if (WiFi.status() == WL_CONNECTED) d["ssid"] = WiFi.SSID();
  else d["reason"] = wifiReason;
  d["networks"] = netCount;
  d["via"] = relayUp ? "relay" : tcp.connected() ? "wifi" : "usb";
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
static void startWifi();
static void saveNets();
static void wifiRestart();
static bool isIp(const String& s);

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
  autoAt = millis() + 3000;  // show the code, then confirm
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
  showResult("Key " + gk.substring(0, 4) + ".." + gk.substring(60), C_AMBER, 15000);
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
  } else if (p.kind == "evm_grant") {
    // A session key grant on the Leash account. Rebuild the contract's preimage:
    // "LEASH/grant" || chainid || account || nonce || agent || cap || expiry
    String chain = String(in["chainId"] | "");
    String account = in["account"] | "";
    String nonceS = in["nonce"] | "";
    String agentAddr = in["agentAddress"] | "";
    String capS = in["cap"] | "";
    String expS = in["expiry"] | "";
    uint8_t pre[11 + 32 + 20 + 32 + 20 + 32 + 32];
    memcpy(pre, "LEASH/grant", 11);
    if (!frost::u256FromDecimal(chain.c_str(), pre + 11) || !unhex(account.c_str(), pre + 43, 20) ||
        !frost::u256FromDecimal(nonceS.c_str(), pre + 63) || !unhex(agentAddr.c_str(), pre + 95, 20) ||
        !frost::u256FromDecimal(capS.c_str(), pre + 115) || !frost::u256FromDecimal(expS.c_str(), pre + 147))
      return reject(id, "bad_request");
    frost::sha256(pre, sizeof pre, p.msg);
    p.title = "New key " + String(chain == "11155111" ? "Sepolia" : "chain " + chain);
    char eth[32];
    snprintf(eth, sizeof eth, "%.6f ETH", strtod(capS.c_str(), nullptr) / 1e18);
    p.amount = eth;
    p.line1 = agent + " " + shortHex(agentAddr, 4, 4);
    // How long it lasts, from the signed expiry and the wrist's own clock.
    time_t now = time(nullptr);
    long long exp = atoll(expS.c_str());
    if (now > 1700000000) {
      long long mins = (exp - (long long)now) / 60;
      p.line2 = mins <= 0 ? String("already expired") : mins < 120 ? "lasts " + String((long)mins) + " min" : "lasts " + String((long)(mins / 60)) + " h";
    } else {
      p.line2 = "expiry " + expS;
    }
    prompt = p;
    prompt.shownAt = millis();
    mode = Mode::Prompt;
    dirty = true;
    draw();
    buzz();
#ifdef LEASH_AUTO_APPROVE
    autoAt = millis() + 3000;  // long enough to read the prompt
#endif
    return;
  } else if (p.kind == "evm") {
    // A call through the Leash smart account. Rebuild the contract's preimage:
    // "LEASH/evm" || chainid || account || nonce || to || value || data
    String chain = String(in["chainId"] | "");
    String account = in["account"] | "";
    String nonceS = in["nonce"] | "";
    String to = in["to"] | "";
    String valueS = in["value"] | "";
    String data = in["data"] | "0x";
    uint8_t chainB[32], accB[20], nonceB[32], toB[20], valB[32];
    String dataHex = data.startsWith("0x") ? data.substring(2) : data;
    size_t dlen = dataHex.length() / 2;
    if (!frost::u256FromDecimal(chain.c_str(), chainB) || !unhex(account.c_str(), accB, 20) ||
        !frost::u256FromDecimal(nonceS.c_str(), nonceB) || !unhex(to.c_str(), toB, 20) ||
        !frost::u256FromDecimal(valueS.c_str(), valB) || dataHex.length() % 2 != 0 || dlen > 1024)
      return reject(id, "bad_request");
    std::vector<uint8_t> pre(9 + 32 + 20 + 32 + 20 + 32 + dlen);
    uint8_t* w = pre.data();
    memcpy(w, "LEASH/evm", 9);
    memcpy(w + 9, chainB, 32);
    memcpy(w + 41, accB, 20);
    memcpy(w + 61, nonceB, 32);
    memcpy(w + 93, toB, 20);
    memcpy(w + 113, valB, 32);
    if (dlen && !unhex(dataHex.c_str(), w + 145, dlen)) return reject(id, "bad_request");
    frost::sha256(pre.data(), pre.size(), p.msg);
    String net = chain == "11155111" ? "Sepolia" : chain == "1" ? "MAINNET" : "chain " + chain;
    p.title = net + " tx";
    char eth[32];
    snprintf(eth, sizeof eth, "%.6f ETH", strtod(valueS.c_str(), nullptr) / 1e18);
    p.amount = eth;
    p.line1 = "to " + shortHex(to, 4, 4);
    p.line2 = dlen ? "with " + String((int)dlen) + " bytes of data, nonce " + nonceS : "nonce " + nonceS;
    // Token calls: show what the data does rather than a byte count.
    Prompt dec;
    if (dlen >= 4 && decodeTx(to, data, dec) && dec.amount != "?") {
      p.line1 = dec.line1;
      p.line2 = "token " + shortHex(to, 4, 4) + ", " + dec.amount;
    }
    prompt = p;
    prompt.shownAt = millis();
    mode = Mode::Prompt;
    dirty = true;
    draw();
    buzz();
#ifdef LEASH_AUTO_APPROVE
    autoAt = millis() + 3000;  // long enough to read the prompt
#endif
    return;
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
  autoAt = millis() + 3000;  // long enough to read the prompt
#endif
}

static void approveRoot();
static void approvePrompt() {
  if (prompt.kind.startsWith("root") || prompt.kind == "vault_sign") return approveRoot();
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


// ---- root key: 3-of-3 with the vault --------------------------------------------------
//
// The same firmware runs on the wrist and on the vault; NVS "role" picks which.
// Wrist: holds share 2 of the root key. Root signing goes phone -> wrist -> IR -> vault.
// Vault: radio off except for a 2-minute window opened by holding A for 2 s, used only for the
// reshare. It signs root actions over IR only, after a press of A on the vault itself.

static void loadRoot() {
  Preferences p;
  p.begin("root", false);
  isVault = p.getString("role", "wrist") == "vault";
  if (isVault) {
    if (p.getBytes("vdev", vdevPriv, 32) != 32) {
      frost::keypair(vdevPriv, vdevPub);
      p.putBytes("vdev", vdevPriv, 32);
    }
    frost::pubOf(vdevPriv, vdevPub);
    vJoined = p.getBytes("vshare", vshare, 32) == 32 && p.getBytes("vgk", vgk, 32) == 32;
  } else {
    rparties = p.getUChar("rparties", 0);
    if (rparties && (p.getBytes("rshare", rshare, 32) != 32 || p.getBytes("rgk", rgk, 32) != 32)) rparties = 0;
  }
  p.end();
}

static void saveRoot() {
  Preferences p;
  p.begin("root", false);
  if (isVault) {
    if (vJoined) {
      p.putBytes("vshare", vshare, 32);
      p.putBytes("vgk", vgk, 32);
    }
  } else {
    p.putUChar("rparties", rparties);
    if (rparties) {
      p.putBytes("rshare", rshare, 32);
      p.putBytes("rgk", rgk, 32);
    }
  }
  p.end();
}

// Compact root action for IR: chainId u32 | account 20 | nonce u32 | agent 20 | cap u128 | expiry u64
static bool tailOf(const char* dec, uint8_t* out, size_t n) {
  uint8_t full[32];
  if (!frost::u256FromDecimal(dec, full)) return false;
  for (size_t i = 0; i < 32 - n; i++)
    if (full[i]) return false;  // too big for the compact field
  memcpy(out, full + 32 - n, n);
  return true;
}

static size_t compactLen(char type) { return type == 'E' ? 64 : 72; }

// 'E': sha256("LEASH/evm" || chainid || account || nonce || to || value), the call format the
// root treasury contract checks. Compact: chainId u32 | account 20 | nonce u32 | to 20 | value u128
static void rootEvmMsg(const uint8_t c[64], uint8_t out[32]) {
  uint8_t pre[9 + 32 + 20 + 32 + 20 + 32];
  memset(pre, 0, sizeof pre);
  memcpy(pre, "LEASH/evm", 9);
  memcpy(pre + 9 + 28, c, 4);         // chainid
  memcpy(pre + 41, c + 4, 20);        // account
  memcpy(pre + 61 + 28, c + 24, 4);   // nonce
  memcpy(pre + 93, c + 28, 20);       // to
  memcpy(pre + 113 + 16, c + 48, 16); // value
  frost::sha256(pre, sizeof pre, out);
}

static void rootMsgGrant(const uint8_t c[72], uint8_t out[32]);
static void rootMsg(char type, const uint8_t* c, uint8_t out[32]) {
  if (type == 'E') rootEvmMsg(c, out);
  else rootMsgGrant(c, out);
}

// sha256("LEASH/rootgrant" || chainid || account || nonce || agent || cap || expiry), 32-byte fields
static void rootMsgGrant(const uint8_t c[72], uint8_t out[32]) {
  uint8_t pre[15 + 32 + 20 + 32 + 20 + 32 + 32];
  memset(pre, 0, sizeof pre);
  memcpy(pre, "LEASH/rootgrant", 15);
  memcpy(pre + 15 + 28, c, 4);          // chainid
  memcpy(pre + 47, c + 4, 20);          // account
  memcpy(pre + 67 + 28, c + 24, 4);     // nonce
  memcpy(pre + 99, c + 28, 20);         // agent
  memcpy(pre + 119 + 16, c + 48, 16);   // cap
  memcpy(pre + 151 + 24, c + 64, 8);    // expiry
  frost::sha256(pre, sizeof pre, out);
}

static void describeRoot(char type, const uint8_t* c, Prompt& p) {
  if (type == 'E') {
    double v = 0;
    for (int i = 0; i < 16; i++) v = v * 256 + c[48 + i];
    char eth[32];
    snprintf(eth, sizeof eth, "%.6f ETH", v / 1e18);
    p.title = isVault ? "VAULT: send" : "ROOT send";
    p.amount = eth;
    p.line1 = "to " + shortHex(hex(c + 28, 20), 4, 4);
    p.line2 = isVault ? "A: sign as vault  B: no" : "from the root treasury";
    return;
  }
  double cap = 0;
  for (int i = 0; i < 16; i++) cap = cap * 256 + c[48 + i];
  char eth[32];
  snprintf(eth, sizeof eth, "%.6f ETH", cap / 1e18);
  p.amount = eth;
  p.line1 = "raise cap, agent " + shortHex(hex(c + 28, 20), 4, 4);
  p.line2 = isVault ? "A: sign as vault  B: no" : "needs the vault next";
}

static void showPrompt(Prompt& p) {
  p.shownAt = millis();
  prompt = p;
  mode = Mode::Prompt;
  dirty = true;
  draw();
  buzz(2);
#ifdef LEASH_AUTO_APPROVE
  autoAt = millis() + 3000;
#endif
}

static void onRootDkg(JsonDocument& in) {
  Prompt p;
  p.id = "root_dkg";
  p.kind = "root_dkg";
  if (!unhex(in["X"] | "", pendX, 65) || !unhex(in["pop"]["R"] | "", pendR, 65) || !unhex(in["pop"]["s"] | "", pendS, 32))
    return reject("root_dkg", "bad_request");
  p.title = "Root key";
  p.amount = "Create";
  p.line1 = "a second key with the phone";
  p.line2 = rparties ? "replaces the old root key" : "for root actions only";
  showPrompt(p);
}

static void onRootReshare(JsonDocument& in) {
  if (rparties != 2) return reject("root_reshare", rparties == 3 ? "already_3_of_3" : "no_root_key");
  if (!unhex(in["vaultPub"] | "", pendVaultPub, 33)) return reject("root_reshare", "bad_request");
  Prompt p;
  p.id = "root_reshare";
  p.kind = "root_reshare";
  p.title = "Add vault";
  p.amount = fingerprint(pendVaultPub);
  p.line1 = "same code on the vault?";
  p.line2 = "root key becomes 3 of 3";
  showPrompt(p);
}

static void onRootSign(JsonDocument& in) {
  String id = in["id"] | "";
  if (rparties != 3) return reject(id, "root_not_3_of_3");
  if (rjob.active) return reject(id, "busy");
  Prompt p;
  p.id = id;
  p.kind = "root_sign";
  uint8_t* c = rjob.compact;
  rjob.type = String(in["kind"] | "grant") == "evm" ? 'E' : 'G';
  bool ok = tailOf(String(in["chainId"] | "").c_str(), c, 4) && unhex(in["account"] | "", c + 4, 20) &&
            tailOf(String(in["nonce"] | "").c_str(), c + 24, 4) && unhex(in["D"] | "", rjob.D[0], 33) &&
            unhex(in["E"] | "", rjob.E[0], 33);
  if (rjob.type == 'E')
    ok = ok && unhex(in["to"] | "", c + 28, 20) && tailOf(String(in["value"] | "").c_str(), c + 48, 16);
  else
    ok = ok && unhex(in["agent"] | "", c + 28, 20) && tailOf(String(in["cap"] | "").c_str(), c + 48, 16) &&
         tailOf(String(in["expiry"] | "").c_str(), c + 64, 8);
  if (!ok) return reject(id, "bad_request");
  rootMsg(rjob.type, c, rjob.msg);
  memcpy(p.msg, rjob.msg, 32);
  rjob.id = id;
  p.title = "ROOT action";
  describeRoot(rjob.type, c, p);
  showPrompt(p);
}

static void irShowWaiting(const char* text) {
  resultText = text;
  resultColor = C_AMBER;
  resultUntil = millis() + 600000;
  mode = Mode::Result;
  draw();
}

// Wrist: after A, commit our nonces and send the whole request to the vault over IR.
static void rootSignToVault() {
  frost::commit(rjob.n, rjob.D[1], rjob.E[1]);
  // 'S' | type | compact | D1 E1 D2 E2
  size_t cl = compactLen(rjob.type);
  uint8_t pkt[2 + 72 + 4 * 33];
  pkt[0] = 'S';
  pkt[1] = rjob.type;
  memcpy(pkt + 2, rjob.compact, cl);
  uint8_t* q = pkt + 2 + cl;
  memcpy(q, rjob.D[0], 33);
  memcpy(q + 33, rjob.E[0], 33);
  memcpy(q + 66, rjob.D[1], 33);
  memcpy(q + 99, rjob.E[1], 33);
  size_t pktLen = 2 + cl + 132;
  irShowWaiting("Point at the vault");
  JsonDocument st;
  st["t"] = "root_progress";
  st["id"] = rjob.id;
  st["step"] = "ir_to_vault";
  send(st);
  if (!ir::send(pkt, pktLen, 60000)) {
    frost::wipe(rjob.n);
    reject(rjob.id, "ir_failed");
    showResult("Vault not in sight", C_RED, 4000);
    return;
  }
  rjob.active = true;
  rjob.sentAt = millis();
  irShowWaiting("Vault: press A");
  JsonDocument d;
  d["t"] = "root_progress";
  d["id"] = rjob.id;
  d["step"] = "vault_prompted";
  send(d);
}

// Wrist: the vault answered over IR.
static void rootFromVault(const std::vector<uint8_t>& m) {
  if (!rjob.active) return;
  rjob.active = false;
  if (m[0] == 'R' || m.size() < 1 + 33 + 33 + 32) {
    frost::wipe(rjob.n);
    reject(rjob.id, "vault_rejected");
    showResult("Vault said no", C_MUTED, 3000);
    return;
  }
  memcpy(rjob.D[2], m.data() + 1, 33);
  memcpy(rjob.E[2], m.data() + 34, 33);
  const uint8_t* z3 = m.data() + 67;
  uint8_t ids[3] = {1, 2, 3};
  uint8_t z2[32];
  if (!frost::respond(rshare, rgk, rjob.msg, 3, ids, rjob.D, rjob.E, 2, rjob.n, z2)) {
    reject(rjob.id, "sign_failed");
    showResult("Signing failed", C_RED);
    return;
  }
  JsonDocument d;
  d["t"] = "root_share";
  d["id"] = rjob.id;
  d["D2"] = hex(rjob.D[1], 33);
  d["E2"] = hex(rjob.E[1], 33);
  d["z2"] = hex(z2, 32);
  d["D3"] = hex(rjob.D[2], 33);
  d["E3"] = hex(rjob.E[2], 33);
  d["z3"] = hex(z3, 32);
  send(d);
  showResult("Root signed, 3 of 3", C_TEXT, 3000);
}

// Vault: a root request arrived over IR.
static void vaultRequest(const std::vector<uint8_t>& m) {
  if (m.size() < 2) return;
  char type = (char)m[1];
  size_t cl = compactLen(type);
  if ((type != 'E' && type != 'G') || m.size() != 2 + cl + 4 * 33) return;
  if (!vJoined) {
    uint8_t r[2] = {'R', 1};
    ir::send(r, 2, 8000);
    return;
  }
  vjob.type = type;
  memcpy(vjob.compact, m.data() + 2, cl);
  const uint8_t* q = m.data() + 2 + cl;
  memcpy(vjob.D[0], q, 33);
  memcpy(vjob.E[0], q + 33, 33);
  memcpy(vjob.D[1], q + 66, 33);
  memcpy(vjob.E[1], q + 99, 33);
  rootMsg(type, vjob.compact, vjob.msg);
  Prompt p;
  p.id = "vault";
  p.kind = "vault_sign";
  p.title = "VAULT";
  describeRoot(type, vjob.compact, p);
  showPrompt(p);
}

static void vaultApprove() {
  frost::commit(vjob.n, vjob.D[2], vjob.E[2]);
  uint8_t ids[3] = {1, 2, 3};
  uint8_t z3[32];
  if (!frost::respond(vshare, vgk, vjob.msg, 3, ids, vjob.D, vjob.E, 3, vjob.n, z3)) {
    showResult("Signing failed", C_RED);
    return;
  }
  uint8_t pkt[1 + 33 + 33 + 32];
  pkt[0] = 'Z';
  memcpy(pkt + 1, vjob.D[2], 33);
  memcpy(pkt + 34, vjob.E[2], 33);
  memcpy(pkt + 67, z3, 32);
  irShowWaiting("Sending to wrist");
  bool ok = ir::send(pkt, sizeof pkt, 60000);
  showResult(ok ? "Signed" : "Wrist not in sight", ok ? C_TEXT : C_RED, 3000);
}

static void vaultReject() {
  uint8_t r[2] = {'R', 0};
  ir::send(r, 2, 8000);
  showResult("Rejected", C_MUTED);
}

// Vault: a reshare piece, sealed to our device key, relayed by the hub.
static void onResharePiece(JsonDocument& in) {
  if (!isVault) return;
  JsonDocument d;
  if (!windowOpen()) {
    d["t"] = "reshare_error";
    d["reason"] = "window_closed";
    send(d);
    return;
  }
  // The reshare happens over the 2-minute WiFi window only, never over the USB cable.
  if (lastSource != 'n') {
    d["t"] = "reshare_error";
    d["reason"] = "not_over_wifi";
    send(d);
    return;
  }
  String from = in["from"] | "";
  int k = from == "phone" ? 0 : from == "wrist" ? 1 : -1;
  String ctHex = in["ct"] | "";
  std::vector<uint8_t> ct(ctHex.length() / 2);
  size_t outLen = 0;
  if (k < 0 || ct.size() < 61 || !unhex(ctHex.c_str(), ct.data(), ct.size()) ||
      !frost::open(vdevPriv, ct.data(), ct.size(), piece[k], &outLen) || outLen != 32) {
    d["t"] = "reshare_error";
    d["reason"] = "bad_piece";
    send(d);
    return;
  }
  if (k == 0 && !unhex(in["groupKey"] | "", vgk, 32)) return;
  havePiece[k] = true;
  if (havePiece[0] && havePiece[1]) {
    frost::addMod(piece[0], piece[1], vshare);
    memset(piece, 0, sizeof piece);
    havePiece[0] = havePiece[1] = false;
    vJoined = true;
    saveRoot();
    uint8_t X3[33];
    frost::pubOf(vshare, X3);
    d["t"] = "reshare_vault";
    d["X3"] = hex(X3, 33);
    send(d);
    showResult("Joined: root 3 of 3", C_TEXT, 5000);
    windowUntil = millis() + 5000;  // radio goes off shortly
  } else {
    d["t"] = "reshare_progress";
    d["have"] = from;
    send(d);
  }
}

static void openWindow() {
  windowUntil = millis() + 120000;
  havePiece[0] = havePiece[1] = false;
  startWifi();
  buzz(1);
  dirty = true;
}

static void closeWindow() {
  windowUntil = 0;
  relay.disconnect();
  relayUp = relayStarted = false;
  tcp.stop();
  WiFi.disconnect(true, false);
  WiFi.mode(WIFI_OFF);
  dirty = true;
}

static bool isVaultRole() { return isVault; }

static void drawVault() {
  bool win = windowOpen();
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(win ? C_AMBER : C_TEXT);
  canvas.drawString(win ? "Vault: window open" : "Vault", 8, 6);
  canvas.setFont(&fonts::Font0);
  canvas.setTextDatum(top_right);
  canvas.setTextColor(C_MUTED);
  canvas.drawString(String(win ? (tcpUp() ? "hub" : "wifi...") : "radio off") + "  " + String(M5.Power.getBatteryLevel()) + "%", W - 8, 10);
  canvas.setTextDatum(top_left);
  canvas.setFont(&fonts::FreeSansBold12pt7b);
  canvas.setTextColor(vJoined ? C_TEXT : C_MUTED);
  canvas.drawString(vJoined ? "Root 3 of 3" : "Not joined", 8, 34);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_MUTED);
  if (win) {
    canvas.drawString("Code " + fingerprint(vdevPub), 8, 72);
    canvas.drawString(String((windowUntil - millis()) / 1000) + " s left", 8, 96);
  } else {
    canvas.drawString(vJoined ? "Signs only by IR." : "Hold A to join.", 8, 72);
    canvas.drawString("Code " + fingerprint(vdevPub), 8, 96);
  }
}

static void approveRoot() {
  if (prompt.kind == "root_dkg") {
    uint8_t X2[65], R2[65], s2[32], ns[32], ng[32];
    if (!frost::dkg(pendX, pendR, pendS, X2, R2, s2, ns, ng)) {
      reject("root_dkg", "bad_proof");
      showResult("Root key failed", C_RED);
      return;
    }
    memcpy(rshare, ns, 32);
    memcpy(rgk, ng, 32);
    memset(ns, 0, 32);
    rparties = 2;
    saveRoot();
    JsonDocument d;
    d["t"] = "root_dkg";
    d["X"] = hex(X2, 65);
    d["pop"]["R"] = hex(R2, 65);
    d["pop"]["s"] = hex(s2, 32);
    d["groupKey"] = hex(rgk, 32);
    send(d);
    showResult("Root key 2 of 2", C_TEXT, 3000);
  } else if (prompt.kind == "root_reshare") {
    uint8_t r2[32], X2[33];
    frost::randomScalar32(r2);
    frost::subMod(rshare, r2, rX2new);
    frost::pubOf(rX2new, X2);
    uint8_t ct[61 + 32];
    size_t ctLen = 0;
    bool ok = frost::seal(pendVaultPub, r2, 32, ct, &ctLen);
    memset(r2, 0, 32);
    if (!ok) {
      reject("root_reshare", "seal_failed");
      return;
    }
    JsonDocument pc;
    pc["t"] = "reshare_piece";
    pc["to"] = "vault";
    pc["from"] = "wrist";
    pc["ct"] = hex(ct, ctLen);
    send(pc);
    JsonDocument d;
    d["t"] = "root_reshare";
    d["X2"] = hex(X2, 33);
    send(d);
    showResult("Sent to the vault", C_TEXT, 3000);
  } else if (prompt.kind == "root_sign") {
    rootSignToVault();
  } else if (prompt.kind == "vault_sign") {
    vaultApprove();
  }
}

static void handle(const String& line) {
  JsonDocument in;
  if (deserializeJson(in, line)) return;
  String t = in["t"] | "";
  if (t == "hub_ping") return;  // keeps the WiFi socket alive, says nothing about the phone
  lastPhone = millis();
  if (t == "hello?") sendHello();
  else if (t == "ping") {
  } else if (t == "pair") onPair(in);
  else if (t == "pair_cancel") {
    if (mode == Mode::Pairing) mode = restingMode();
  } else if (t == "dkg") onDkg(in);
  else if (t == "root_dkg") onRootDkg(in);
  else if (t == "root_reshare") onRootReshare(in);
  else if (t == "root_commit") {
    if (rparties == 2) {
      memcpy(rshare, rX2new, 32);
      memset(rX2new, 0, 32);
      rparties = 3;
      saveRoot();
      showResult("Root is 3 of 3", C_TEXT, 4000);
    }
    JsonDocument d;
    d["t"] = "root_committed";
    d["parties"] = rparties;
    send(d);
  } else if (t == "root_sign") onRootSign(in);
  else if (t == "reshare_piece") onResharePiece(in);
  else if (t == "open_window") {
    // Over the USB cable only: plugging in is physical presence, like holding A.
    if (lastSource == 'u' && isVault && !windowOpen()) openWindow();
  } else if (t == "set_role") {
    // Only over the USB cable, never over the network.
    if (lastSource == 'u') {
      Preferences p;
      p.begin("root", false);
      p.putString("role", String(in["role"] | "wrist") == "vault" ? "vault" : "wrist");
      p.end();
      delay(100);
      ESP.restart();
    }
  }
  else if (t == "sign") onSign(in);
  else if (t == "sign_cancel") {
    if (mode == Mode::Prompt && prompt.id == String(in["id"] | "")) mode = restingMode();
  } else if (t == "exposure") onExposure(in);
  else if (t == "revoked") {
    mode = paired ? Mode::Revoked : Mode::Unpaired;
    expLeft = expCap = expSpent = 0;
    expKeys = 0;
  } else if (t == "hub_hint") {
    // The phone knows which laptop served it. Remember that address for this network.
    String r = in["relay"] | "";
    if (r.startsWith("wss://") && r != relayUrl) {
      relayUrl = r;
      Preferences p;
      p.begin("wifi", false);
      p.putString("relay", relayUrl);
      p.end();
      relayStarted = false;  // reconnect to the new address
      relay.disconnect();
      relayUp = false;
    }
    String h = in["host"] | "";
    if (isIp(h)) {
      hintHost = h;
      if (netIdx >= 0 && WiFi.status() == WL_CONNECTED && nets[netIdx].hub != h) {
        nets[netIdx].hub = h;
        saveNets();
      }
    }
  } else if (t == "wifi_add") {
    String ssid = in["ssid"] | "";
    String pass = in["pass"] | "";
    if (ssid.length() == 0 || ssid.length() > 32 || pass.length() > 63) {
      JsonDocument d;
      d["t"] = "wifi_add_reject";
      d["reason"] = "bad_network";
      send(d);
    } else {
      pendingNet = {ssid, pass, String(in["hub"] | "")};
      mode = Mode::ConfirmWifi;
      buzz(1);
    }
  } else if (t == "wifi_scan?") {
    // Nearby networks, strongest first, so the phone can offer a pick list.
    JsonDocument d;
    d["t"] = "wifi_scan";
    JsonArray a = d["networks"].to<JsonArray>();
    if (mode != Mode::Prompt) {
      int n = WiFi.scanNetworks();
      for (int i = 0; i < n && i < 20; i++) {
        if (WiFi.SSID(i).length() == 0) continue;
        JsonObject o = a.add<JsonObject>();
        o["ssid"] = WiFi.SSID(i);
        o["rssi"] = WiFi.RSSI(i);
        o["open"] = WiFi.encryptionType(i) == WIFI_AUTH_OPEN;
      }
      WiFi.scanDelete();
    }
    send(d);
  } else if (t == "ir_loop") {
    delay(100);
    JsonDocument d;
    d["t"] = "ir_loop";
    d["pins"] = ir::pinInfo();
    d["heard"] = ir::loopback();
    d["board"] = (int)M5.getBoard();
    d["pmic"] = (int)M5.Power.getType();
    send(d);
  } else if (t == "beep") {
    // Find which stick is which: it beeps and flashes its name.
    buzz(2);
    showResult(isVault ? "This is the vault" : "This is the wrist", C_AMBER, 3000);
  } else if (t == "ir_rate") {
    ir::rateTest(in["frames"] | 30, in["gap"] | 40);
    JsonDocument d;
    d["t"] = "ir_rate_done";
    send(d);
  } else if (t == "ir_stats") {
    if (in["reset"] | false) ir::resetStats();
    if (in["ack"].is<int>()) ir::setAck((int)in["ack"] != 0);
    auto st = ir::stats();
    JsonDocument d;
    d["t"] = "ir_stats";
    d["ok"] = st.framesOk;
    d["bad"] = st.framesBad;
    send(d);
  } else if (t == "ir_env") {
    // Bench switches to find what disturbs the IR receiver.
    if (in["wifi"].is<int>() && (int)in["wifi"] == 0) {
      relay.disconnect();
      tcp.stop();
      WiFi.mode(WIFI_OFF);
    }
    if (in["bl"].is<int>()) M5.Display.setBrightness((int)in["bl"]);
    if (in["imu"].is<int>()) irQuiet = (int)in["imu"] == 0;
    JsonDocument d;
    d["t"] = "ir_env";
    d["ok"] = true;
    send(d);
  } else if (t == "ir_blast") {
    ir::blast(in["ms"] | 20000);
  } else if (t == "ir_dump") {
    JsonDocument d;
    d["t"] = "ir_dump";
    d["raw"] = ir::dumpRaw();
    send(d);
  } else if (t == "ir_test") {
    // Bench test of the IR link: send n bytes to the other stick and report how it went.
    int n = in["n"] | 64;
    std::vector<uint8_t> buf(std::min(n, 1024));
    for (size_t i = 0; i < buf.size(); i++) buf[i] = (uint8_t)(i * 7 + 3);
    uint32_t t0 = millis();
    bool ok = ir::send(buf.data(), buf.size());
    auto s = ir::stats();
    JsonDocument d;
    d["t"] = "ir_test_result";
    d["ok"] = ok;
    d["bytes"] = (int)buf.size();
    d["ms"] = millis() - t0;
    d["retries"] = s.retries;
    d["framesOk"] = s.framesOk;
    d["framesBad"] = s.framesBad;
    send(d);
  } else if (t == "wifi_list?") {
    JsonDocument d;
    d["t"] = "wifi_list";
    JsonArray a = d["networks"].to<JsonArray>();
    for (int i = 0; i < netCount; i++) a.add(nets[i].ssid);
    d["current"] = WiFi.status() == WL_CONNECTED ? WiFi.SSID() : String("");
    send(d);
  } else if (t == "wipe") {
    // Anyone on the network can ask, so erasing needs a press on the wrist.
    if (paired) {
      mode = Mode::ConfirmWipe;
      buzz(1);
#ifdef LEASH_AUTO_APPROVE
      wipeShare();
      mode = Mode::Unpaired;
      sendHello();
#endif
    } else {
      sendHello();
    }
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

// ---- wifi -----------------------------------------------------------------
//
// The wrist knows up to six networks. It scans, tries the known ones it can see from
// strongest to weakest, and on each one tries WPA3 first and WPA2 without PMF second
// (phone hotspots in WPA2/WPA3 transition mode need the second). Once on a network it
// dials the hub: the address last seen working there, the phone's hint, mDNS, then the
// build-time fallback.

static bool isIp(const String& s) {
  IPAddress ip;
  return s.length() >= 7 && ip.fromString(s);
}

static void loadNets() {
  Preferences p;
  p.begin("wifi", true);
  relayUrl = p.getString("relay", "");
  netCount = std::min((int)p.getUChar("n", 0), MAX_NETS);
  for (int i = 0; i < netCount; i++) {
    nets[i].ssid = p.getString(("s" + String(i)).c_str(), "");
    nets[i].pass = p.getString(("p" + String(i)).c_str(), "");
    nets[i].hub = p.getString(("h" + String(i)).c_str(), "");
  }
  p.end();
#ifdef WIFI_SSID
  // Seed with the build-time network the first time only.
  if (netCount == 0 && strlen(WIFI_SSID) > 0) {
    nets[0] = {WIFI_SSID, WIFI_PASS, HUB_IP};
    netCount = 1;
    saveNets();
  }
#endif
}

static void saveNets() {
  Preferences p;
  p.begin("wifi", false);
  p.clear();
  if (relayUrl.length()) p.putString("relay", relayUrl);
  p.putUChar("n", netCount);
  for (int i = 0; i < netCount; i++) {
    p.putString(("s" + String(i)).c_str(), nets[i].ssid);
    p.putString(("p" + String(i)).c_str(), nets[i].pass);
    p.putString(("h" + String(i)).c_str(), nets[i].hub);
  }
  p.end();
}

static void setWState(WState st) {
  wstate = st;
  wstateAt = millis();
  dirty = true;
}

static void wifiRestart() {
  tcp.stop();
  if (relayStarted) relay.disconnect();
  relayStarted = false;
  relayUp = false;
  WiFi.disconnect(false, false);
  setWState(WState::Scan);
}

static void beginNet(int i, bool wpa2Only) {
  netIdx = i;
  strictWpa2 = wpa2Only;
  WiFi.disconnect(false, false);
  WiFi.begin(nets[i].ssid.c_str(), nets[i].pass.c_str());
  if (wpa2Only) {
    esp_wifi_disconnect();
    wifi_config_t conf;
    esp_wifi_get_config(WIFI_IF_STA, &conf);
    conf.sta.pmf_cfg.capable = false;
    conf.sta.pmf_cfg.required = false;
    conf.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    esp_wifi_set_config(WIFI_IF_STA, &conf);
    esp_wifi_connect();
  }
  setWState(WState::Trying);
}

static void scanAndPick() {
  candCount = candPos = 0;
  if (netCount == 0) {
    setWState(WState::Backoff);
    return;
  }
  // Scans run in the background so the loop (buttons, IR acks) never stalls on them.
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_RUNNING) return;
  if (n < 0) {
    WiFi.scanNetworks(true);
    return;
  }
  int best[MAX_NETS];
  int rssi[MAX_NETS];
  for (int k = 0; k < netCount; k++) {
    rssi[k] = -1000;
    for (int i = 0; i < n; i++)
      if (WiFi.SSID(i) == nets[k].ssid) rssi[k] = std::max(rssi[k], (int)WiFi.RSSI(i));
  }
  WiFi.scanDelete();
  uint32_t now = millis();
  for (int k = 0; k < netCount; k++)
    if (rssi[k] > -1000 && (int32_t)(benchedUntil[k] - now) <= 0) best[candCount++] = k;
  // Everything in range is benched: try them anyway rather than sit idle.
  if (candCount == 0)
    for (int k = 0; k < netCount; k++)
      if (rssi[k] > -1000) best[candCount++] = k;
  std::sort(best, best + candCount, [&](int a, int b) { return rssi[a] > rssi[b]; });
  memcpy(candidates, best, sizeof(int) * candCount);
  if (candCount == 0) setWState(WState::Backoff);
  else beginNet(candidates[0], false);
}

static void startWifi() {
  // The ADC entropy source and the radio can't run together. With the radio on,
  // the hardware RNG is fed by RF noise instead.
  bootloader_random_disable();
  WiFi.mode(WIFI_STA);
  WiFi.onEvent([](WiFiEvent_t, WiFiEventInfo_t info) { wifiReason = info.wifi_sta_disconnected.reason; },
               ARDUINO_EVENT_WIFI_STA_DISCONNECTED);
  // Some hotspots hand out a DNS server that doesn't answer. Keep the network's own
  // server first and add public ones behind it, so the relay name still resolves.
  WiFi.onEvent(
      [](WiFiEvent_t, WiFiEventInfo_t) {
        ip_addr_t d1, d2;
        IP_ADDR4(&d1, 1, 1, 1, 1);
        IP_ADDR4(&d2, 8, 8, 8, 8);
        const ip_addr_t* own = dns_getserver(0);
        if (own == nullptr || ip_addr_isany(own)) dns_setserver(0, &d1);
        dns_setserver(1, &d2);
      },
      ARDUINO_EVENT_WIFI_STA_GOT_IP);
  WiFi.setHostname(deviceId.c_str());
  WiFi.setAutoReconnect(false);  // we pick the network ourselves
  WiFi.setSleep(true);
  loadNets();
  setWState(WState::Scan);
}

static void stepWifi() {
  uint32_t now = millis();
  bool up = WiFi.status() == WL_CONNECTED;
  switch (wstate) {
    case WState::Scan:
      // Plugged into the laptop, the hub is already reachable over USB: retry WiFi gently.
      if (Serial && now - wstateAt < 30000 && netIdx >= 0) break;
      scanAndPick();
      break;
    case WState::Trying:
      if (up) {
        configTime(0, 0, "pool.ntp.org", "time.google.com");
        setWState(WState::Up);
        dialStep = 0;
        lastDial = 0;
      } else if (now - wstateAt > 12000) {
        if (!strictWpa2) beginNet(netIdx, true);  // same network, WPA2 only
        else if (++candPos < candCount) beginNet(candidates[candPos], false);
        else setWState(WState::Backoff);
      }
      break;
    case WState::Up:
      if (!up) {
        tcp.stop();
        if (relayStarted) relay.disconnect();
        relayStarted = relayUp = false;
        setWState(WState::Scan);
      } else if (!tcpUp() && now - wstateAt > 30000 && netCount > 1) {
        // On a network but no hub here. Bench it for a minute and look again.
        benchedUntil[netIdx] = now + 60000;
        wifiRestart();
      }
      break;
    case WState::Backoff:
      if (now - wstateAt > 15000) setWState(WState::Scan);
      break;
  }
}

static IPAddress nextHubAddress() {
  // Rotate through every way we know of finding the hub.
  for (int tries = 0; tries < 4; tries++) {
    int step = dialStep++ % 4;
    IPAddress ip;
    if (step == 0 && netIdx >= 0 && isIp(nets[netIdx].hub)) ip.fromString(nets[netIdx].hub);
    if (step == 1 && isIp(hintHost)) ip.fromString(hintHost);
    if (step == 2) {
      if (!mdnsUp) mdnsUp = MDNS.begin(deviceId.c_str());
      if (mdnsUp) ip = MDNS.queryHost(HUB_MDNS, 1500);
    }
    if (step == 3) ip.fromString(HUB_IP);
    if (ip != IPAddress(0, 0, 0, 0)) return ip;
  }
  return IPAddress(0, 0, 0, 0);
}

static void startRelay() {
  // wss://host[:port]/path?query
  String u = relayUrl.substring(6);
  int slash = u.indexOf('/');
  String hostPort = slash < 0 ? u : u.substring(0, slash);
  String path = slash < 0 ? "/" : u.substring(slash);
  int colon = hostPort.indexOf(':');
  String host = colon < 0 ? hostPort : hostPort.substring(0, colon);
  uint16_t port = colon < 0 ? 443 : hostPort.substring(colon + 1).toInt();
  relay.beginSSL(host.c_str(), port, path.c_str());
  relay.setReconnectInterval(20000);  // a failing DNS lookup blocks, so retry rarely
  relay.enableHeartbeat(10000, 4000, 2);
  relay.onEvent([](WStype_t type, uint8_t* payload, size_t len) {
    switch (type) {
      case WStype_CONNECTED:
        relayUp = true;
        wstateAt = millis();
        dirty = true;
        sendHello();
        break;
      case WStype_DISCONNECTED:
        if (relayUp) dirty = true;
        relayUp = false;
        break;
      case WStype_TEXT: {
        String msg((const char*)payload, len);
        int start = 0;
        while (start < (int)msg.length()) {
          int nl = msg.indexOf('\n', start);
          if (nl < 0) nl = msg.length();
          String line = msg.substring(start, nl);
          line.trim();
          lastSource = 'n';
          if (line.length()) handle(line);
          start = nl + 1;
        }
        break;
      }
      default:
        break;
    }
  });
  relayStarted = true;
}

static void pollWifi() {
  uint32_t now = millis();
  stepWifi();
  // With a relay address, use it: it works from any network with internet.
  if (relayUrl.length() && wstate == WState::Up) {
    if (!relayStarted) startRelay();
    relay.loop();
    if (relayUp) {
      if (tcp.connected()) tcp.stop();
      return;
    }
  }
  if (tcpUp()) {
    while (tcp.available()) {
      char c = (char)tcp.read();
      lastTcpRx = now;
      if (c == '\n') {
        lastSource = 'n';
        if (rxTcp.length()) handle(rxTcp);
        rxTcp = "";
      } else if (c != '\r' && rxTcp.length() < 4000) {
        rxTcp += c;
      }
    }
    // The hub pings every few seconds. Silence means a dead socket.
    if (now - lastTcpRx > 20000) {
      tcp.stop();
      dirty = true;
    }
    return;
  }
  if (wstate != WState::Up || now - lastDial < 2000) return;
  lastDial = now;
  IPAddress ip = nextHubAddress();
  if (ip == IPAddress(0, 0, 0, 0)) return;
  hubIp = ip;
  tcp.setTimeout(3);
  if (tcp.connect(ip, HUB_PORT, 1500)) {
    wstateAt = now;
    tcp.setNoDelay(true);
    lastTcpRx = now;
    rxTcp = "";
    dirty = true;
    // Remember what worked on this network.
    if (netIdx >= 0 && nets[netIdx].hub != ip.toString()) {
      nets[netIdx].hub = ip.toString();
      saveNets();
    }
    sendHello();
  }
}

// ---- main -----------------------------------------------------------------

void setup() {
  // Size the USB serial buffers before the port starts, and never block on writes when
  // nobody on the laptop is reading: on core 3 a full TX buffer otherwise wedges the link.
  Serial.setRxBufferSize(4096);
  Serial.setTxBufferSize(4096);
  Serial.setTxTimeoutMs(0);
  Serial.begin(115200);
  auto cfg = M5.config();
  cfg.serial_baudrate = 0;  // already started above
  M5.begin(cfg);
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
  M5.Speaker.end();
  // The IR LED runs off the stick's external power rail, which M5Unified leaves off.
  // Known-good power state: LDO on (IR needs it), L3B rail on via M5PM1 GPIO2 driven high
  // (the display needs it), 5V rail on. The M5PM1 remembers its state across ESP resets,
  // so set all of it on every boot.
  auto& pm1 = M5.Power.M5pm1;
  pm1.setLDOOutput(true);
  pm1.setGPIOFunction(m5::M5PM1_Class::gpio2, m5::M5PM1_Class::gpio);
  pm1.setGPIOMode(m5::M5PM1_Class::gpio2, m5::M5PM1_Class::output);
  pm1.setGPIOOutput(m5::M5PM1_Class::gpio2, true);
  M5.Power.setExtOutput(true, m5::ext_none);
  delay(50);
  ir::begin();
  loadShare();
  loadRoot();
#ifndef LEASH_NO_WIFI
  if (!isVault) startWifi();  // the vault keeps its radio off except during the reshare window
#endif
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
      lastSource = 'u';
      if (rx.length()) handle(rx);
      rx = "";
    } else if (c != '\r' && rx.length() < 4000) {
      rx += c;
    }
  }

#ifndef LEASH_NO_WIFI
  // WiFi scanning and dialing block the loop for seconds, which makes IR acks late.
  // While a root request is out with the vault, leave WiFi alone.
  if ((!isVault || windowOpen()) && !rjob.active) pollWifi();
  if (isVault && windowUntil && millis() >= windowUntil) closeWindow();
#endif

  // IR: report whole messages that arrive (the vault protocol builds on this).
  static std::vector<uint8_t> irMsg;
  bool irGot = ir::poll(irMsg);
  if (irGot && !irMsg.empty() && (irMsg[0] == 'S' || irMsg[0] == 'Z' || irMsg[0] == 'R')) {
    if (isVault && irMsg[0] == 'S') vaultRequest(irMsg);
    else if (!isVault && (irMsg[0] == 'Z' || irMsg[0] == 'R')) rootFromVault(irMsg);
  } else if (irGot) {
    bool pattern = true;
    for (size_t i = 0; i < irMsg.size(); i++)
      if (irMsg[i] != (uint8_t)(i * 7 + 3)) pattern = false;
    JsonDocument d;
    d["t"] = "ir_rx";
    d["bytes"] = (int)irMsg.size();
    d["pattern"] = pattern;
    auto s = ir::stats();
    d["framesOk"] = s.framesOk;
    d["framesBad"] = s.framesBad;
    send(d);
  }

  flushOutbox();

  static uint32_t lastImu = 0;
  if (!irQuiet && millis() - lastImu > 100) {
    lastImu = millis();
    pollImu();
  }

#ifdef LEASH_AUTO_APPROVE
  // Test firmware: press A by itself once the prompt has been on screen for a moment.
  if (autoAt && millis() > autoAt) {
    autoAt = 0;
    if (mode == Mode::Prompt) approvePrompt();
    else if (mode == Mode::Pairing && !pairWaitingPhone) {
      pairWaitingPhone = true;
      chirp();
      JsonDocument ok;
      ok["t"] = "pair_ok";
      send(ok);
      dirty = true;
    }
  }
#endif

  // Vault: hold A for 2 seconds on the home screen to open the 2-minute reshare window.
  if (isVault && !windowUntil && mode == Mode::Home && M5.BtnA.pressedFor(2000)) openWindow();
  // Wrist: the vault has two minutes to answer a root request.
  if (rjob.active && millis() - rjob.sentAt > 120000) {
    rjob.active = false;
    frost::wipe(rjob.n);
    reject(rjob.id, "vault_timeout");
    showResult("Vault timed out", C_MUTED, 3000);
  }

  // Buttons.
  if (mode == Mode::ConfirmWifi) {
    if (M5.BtnA.wasPressed()) {
      // Replace a network with the same name, otherwise add it, dropping the oldest if full.
      int at = -1;
      for (int i = 0; i < netCount; i++)
        if (nets[i].ssid == pendingNet.ssid) at = i;
      if (at < 0) {
        if (netCount == MAX_NETS) {
          for (int i = 1; i < MAX_NETS; i++) nets[i - 1] = nets[i];
          netCount--;
        }
        at = netCount++;
      }
      nets[at] = pendingNet;
      saveNets();
      JsonDocument d;
      d["t"] = "wifi_added";
      d["ssid"] = pendingNet.ssid;
      send(d);
      showResult("Saved " + pendingNet.ssid.substring(0, 14), C_TEXT);
      if (!tcpUp()) wifiRestart();
    } else if (M5.BtnB.wasPressed()) {
      JsonDocument d;
      d["t"] = "wifi_add_reject";
      d["reason"] = "user";
      send(d);
      mode = restingMode();
      dirty = true;
    }
  } else if (mode == Mode::ConfirmWipe) {
    if (M5.BtnA.wasPressed()) {
      wipeShare();
      mode = Mode::Unpaired;
      showResult("Shard erased", C_MUTED);
      sendHello();
    } else if (M5.BtnB.wasPressed()) {
      mode = restingMode();
      dirty = true;
    }
  } else if (mode == Mode::Pairing && !pairWaitingPhone) {
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
      if (prompt.kind == "vault_sign") vaultReject();
      else {
        reject(prompt.id, "user");
        showResult("Rejected", C_MUTED);
      }
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

  if (dirty && !irQuiet) {
    dirty = false;
    draw();
  }
  delay(5);
}

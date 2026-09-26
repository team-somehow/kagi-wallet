// Kagi wrist shard, M5StickS3.
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
#include "ble.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

static const char* FW = "0.3.3";

// ---- look -----------------------------------------------------------------

static uint16_t C_BG, C_TEXT, C_MUTED, C_FAINT, C_ACCENT, C_RED, C_CELL, C_PANEL;
static M5Canvas canvas(&M5.Display);
static const int W = 240, H = 135;

// ---- state ----------------------------------------------------------------

enum class Mode { Unpaired, Pairing, Home, Prompt, Result, Revoked, ConfirmWipe, ConfirmWifi, Beam };

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
static String expUnit = "USD";  // "ETH" for a real on-chain session
static int expKeys = 0;
static bool warned80 = false;

// Wear detection.
static bool onArm = true;
static uint32_t lastMotion = 0;
static float lastA[3] = {0, 0, 0};
// Wear detection: off unless built with KAGI_WEAR_DETECT. On stage "shard asleep" only confuses.
#ifdef KAGI_WEAR_DETECT
static const uint32_t STILL_MS = 120000;
#else
static const uint32_t STILL_MS = 0xFFFFFFFF;
#endif

static uint32_t lastStatus = 0;
static uint32_t autoAt = 0;
// UI animation state.
static uint32_t modeSince = 0;      // when the current screen appeared
static Mode lastDrawnMode = Mode::Unpaired;
static uint32_t holdStart = 0;      // A held since
static float holdProgress = 0;      // 0..1 of the hold
static bool waitRelease = false;    // a hold just completed; ignore A until it is let go
enum class Fx { None, Burst, Shake };
static Fx resultFx = Fx::None;
// Which edge of the screen the A button sits next to, for the arrows.
static const bool A_ON_RIGHT = true;
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

// ETH with no trailing zeros: 0.000020 -> "0.00002 ETH".
static String ethStr(double eth) {
  char b[32];
  bool micro = eth < 0.01;
  if (eth > 0 && eth < 0.0000000001) return "<0.0001 uETH";
  snprintf(b, sizeof b, micro ? "%.4f" : "%.6f", micro ? eth * 1000000 : eth);
  String s(b);
  while (s.endsWith("0")) s.remove(s.length() - 1);
  if (s.endsWith(".")) s.remove(s.length() - 1);
  return s + (micro ? " uETH" : " ETH");
}

static String minutesLeft(const String& expS) {
  time_t now = time(nullptr);
  if (now < 1700000000) return "";
  long long mins = (atoll(expS.c_str()) - (long long)now) / 60;
  return mins <= 0 ? String("expired") : mins < 120 ? String((long)mins) + " min left" : String((long)(mins / 60)) + " h left";
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
// One atomic NVS record survives power loss before/after committing a reshare.
struct JoinRecord {
  uint32_t version = 0;
  uint8_t share[32] = {}, group[32] = {}, vault[33] = {};
  char id[33] = {};
  bool committed = false;
};
static JoinRecord joinRecord;
static String proposedJoinId;
static bool soundsEnabled = true;
static int rparties = 0;  // 0 none, 2 phone + wrist, 3 with the vault
// The wallet key itself went through the reshare: after the commit it is 3 of 3, the old
// 2-of-2 share is gone, and every approval goes phone -> wrist -> IR -> second stick.
static bool rootIsManager = false;
static bool mgr3 = false;

// The infrared screen: what is moving, how far along, and whether frames are getting lost.
struct IrUi {
  String label;
  bool sending = true;
  size_t done = 0, total = 0;
  uint32_t lastBad = 0, lastBeep = 0, lastDraw = 0, lastRecv = 0;
  int bad = 0;
};
static IrUi irui;
// Bench: pretend a message is expected, so the receive screen behaves as in a real signature.
static bool benchInbound = false;
// Redraw the screen while receiving. Off by default: display updates disturb the IR receiver,
// and with a weak sender that is the difference between a clean transfer and a lost one.
static bool irRxAnimate = false;
static uint8_t pendX[65], pendR[65], pendS[32], pendVaultPub[33];

struct RootJob {
  bool active = false;
  char type = 'G';  // 'G' root grant, 'A' agent key and 'L' limit raise on the wallet, 'E' plain send
  String id;
  uint8_t msg[32];
  uint8_t compact[88];
  uint8_t D[3][33], E[3][33];
  frost::Nonce n;
  uint32_t sentAt = 0;
  // Approved on the wrist, nonces committed, but the second stick has not answered yet: the
  // same request can be sent again (the wrist signs its part only once, when the answer comes).
  bool held = false;
  uint32_t heldSince = 0;
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
  // Bluetooth to the phone first; WiFi (relay, then local network) and USB are fallbacks.
  if (ble::send(l)) return;
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
  if (outbox.empty() || !(ble::connected() || relayUp || tcp.connected() || Serial)) return;
  std::vector<String> q;
  q.swap(outbox);
  for (auto& l : q) sendLine(l);
}

// The speaker amp has to be off for the IR receiver to work, so it is on only while beeping.
static void beep(int freq, int ms) {
  if (!soundsEnabled) return;
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

// The StickS3's small speaker only carries well around 1.5-3 kHz. Below 1 kHz a buzz you
// need to notice (an approval waiting) is close to silent, so keep these high.
static void buzz(int times = 3) {
  for (int i = 0; i < times; i++) {
    beep(2600, 90);
    delay(60);
  }
}

static void chirp() { beep(1800, 40); }
static void chime() {
  beep(1320, 70);
  beep(1760, 70);
  beep(2640, 120);
}

// ---- storage --------------------------------------------------------------

static void loadShare() {
  prefs.begin("kagi", true);
  paired = prefs.isKey("share") && prefs.isKey("gk") && prefs.getBytes("share", share, 32) == 32 &&
           prefs.getBytes("gk", groupKey, 32) == 32;
  mgr3 = paired && prefs.getBool("three", false);
  prefs.end();
}

static void saveShare() {
  prefs.begin("kagi", false);
  prefs.putBytes("share", share, 32);
  prefs.putBytes("gk", groupKey, 32);
  prefs.putBool("three", mgr3);
  prefs.end();
  paired = true;
}

static void wipeShare() {
  prefs.begin("kagi", false);
  prefs.clear();
  prefs.end();
  memset(share, 0, 32);
  memset(groupKey, 0, 32);
  paired = false;
  mgr3 = false;
  // A root key made from the wallet key goes with it.
  if (rootIsManager) {
    Preferences p;
    p.begin("root", false);
    p.remove("rparties");
    p.remove("rshare");
    p.remove("rgk");
    p.remove("radopt");
    p.end();
    rparties = 0;
    rootIsManager = false;
    memset(rshare, 0, 32);
  }
}

// ---- drawing --------------------------------------------------------------

// A shallow lit surface keeps the tiny screen readable while giving it depth.
static uint16_t themeGlow(uint8_t amount) {
  return isVault ? M5.Display.color565(amount, amount * 105 / 255, amount * 126 / 255)
                 : M5.Display.color565(amount * 90 / 255, amount * 190 / 255, amount);
}
static void drawSurface() {
  for (int y = 0; y < H; y++) {
    int glow = 27 * (H - y) / H;
    canvas.drawFastHLine(0, y, W, isVault ? M5.Display.color565(18 + glow, 10 + glow / 3, 18 + glow / 2)
                                        : M5.Display.color565(8 + glow / 3, 17 + glow / 2, 29 + glow));
  }
  canvas.drawRoundRect(1, 1, W - 2, H - 2, 9, themeGlow(70));
  canvas.drawFastHLine(12, 2, W - 24, themeGlow(110));
  canvas.drawFastHLine(12, H - 3, W - 24, C_BG);
}
static void deviceModel(int x, int y, bool red) {
  uint16_t light = M5.Display.color565(red ? 197 : 80, red ? 101 : 150, red ? 115 : 210);
  uint16_t body = M5.Display.color565(red ? 110 : 32, red ? 36 : 79, red ? 52 : 127);
  canvas.fillRoundRect(x + 2, y + 4, 49, 32, 5, C_BG);
  canvas.fillRoundRect(x, y, 49, 32, 5, body);
  canvas.drawRoundRect(x, y, 49, 32, 5, light);
  canvas.fillRoundRect(x + 5, y + 6, 28, 20, 2, C_BG);
  canvas.drawFastHLine(x + 8, y + 11, 17, light);
  canvas.drawFastHLine(x + 8, y + 16, 12, C_MUTED);
  canvas.fillCircle(x + 41, y + 17, 5, C_BG);
  canvas.fillCircle(x + 40, y + 15, 5, light);
  canvas.drawCircle(x + 40, y + 15, 5, C_TEXT);
}

static void bar(int x, int y, int w, int h, double ratio, int cells = 20) {
  int gap = 2;
  int cw = (w - gap * (cells - 1)) / cells;
  int lit = (int)round(std::min(std::max(ratio, 0.0), 1.0) * cells);
  for (int i = 0; i < cells; i++) {
    bool on = i < lit;
    bool past = (double)i / cells >= 0.8;
    uint16_t c = !on ? C_CELL : ratio >= 1 ? C_RED : past ? C_ACCENT : C_TEXT;
    canvas.fillRoundRect(x + i * (cw + gap), y, cw, h, 1, c);
  }
  int mx = x + (int)(0.8 * cells) * (cw + gap) - 1;
  canvas.drawFastVLine(mx, y - 3, h + 6, C_ACCENT);
}


// ---- look: animation helpers ---------------------------------------------------

static float t01(uint32_t period) { return (float)(millis() % period) / (float)period; }
static float since(uint32_t ms) { return std::min(1.0f, (float)(millis() - modeSince) / (float)ms); }
static float easeOut(float x) { return 1 - (1 - x) * (1 - x) * (1 - x); }

// A thick arc from start to end angle (degrees, 0 = up, clockwise).
static void arcRing(int cx, int cy, int r, int thick, float from, float to, uint16_t color) {
  canvas.fillArc(cx, cy, r, r - thick, from - 90, to - 90, color);
}

// Chevrons sliding toward the A button, with a label.
static void arrowsToA(int y, const char* label) {
  float t = t01(900);
  int dir = A_ON_RIGHT ? 1 : -1;
  int edge = A_ON_RIGHT ? W - 6 : 6;
  for (int i = 0; i < 3; i++) {
    float ph = fmodf(t + i / 3.0f, 1.0f);
    int x = edge - dir * (int)(46 - ph * 40);
    uint8_t a = (uint8_t)(255 * (0.25f + 0.75f * ph));
    uint16_t c = themeGlow(a);
    for (int k = 0; k < 3; k++) {
      canvas.drawLine(x - dir * 7 + k * dir, y - 9, x + k * dir, y, c);
      canvas.drawLine(x - dir * 7 + k * dir, y + 9, x + k * dir, y, c);
    }
  }
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextColor(C_ACCENT);
  canvas.setTextDatum(A_ON_RIGHT ? middle_right : middle_left);
  canvas.drawString(label, A_ON_RIGHT ? W - 58 : 58, y);
}

// The ring that fills while A is held, with an "A" in the middle.
static void holdRing(int cx, int cy, int r) {
  canvas.fillCircle(cx + 2, cy + 4, r + 1, C_BG);
  canvas.fillCircle(cx, cy, r - 1, C_PANEL);
  canvas.drawCircle(cx, cy, r, C_CELL);
  canvas.drawCircle(cx, cy, r - 1, C_CELL);
  if (holdProgress > 0) arcRing(cx, cy, r, 6, 0, 360 * holdProgress, C_ACCENT);
  canvas.setFont(&fonts::FreeSansBold12pt7b);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(holdProgress > 0 ? C_ACCENT : C_TEXT);
  canvas.drawString("A", cx, cy + 1);
}

// Tiny link and battery icons, top right. No words.
static void statusIcons() {
  int x = W - 10;
  int lvl = M5.Power.getBatteryLevel();
  canvas.drawRect(x - 18, 6, 18, 9, C_MUTED);
  canvas.fillRect(x, 8, 2, 5, C_MUTED);
  if (lvl > 0) canvas.fillRect(x - 16, 8, std::max(1, 14 * std::min(lvl, 100) / 100), 5, lvl < 20 ? C_RED : C_TEXT);
  bool up = ble::connected() || tcpUp();
  canvas.fillCircle(x - 28, 10, 3, up ? C_TEXT : C_RED);
}

static void title(const char* t, uint16_t c, int y = 8) {
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(c);
  canvas.drawString(t, 10, y);
}

static void drawIdle() {
  // Waiting for a phone: the name, and rings pulsing out like a signal.
  canvas.setFont(&fonts::FreeSansBold18pt7b);
  canvas.setTextDatum(middle_left);
  canvas.setTextColor(C_TEXT);
  canvas.drawString("Kagi", 12, 52);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_MUTED);
  canvas.drawString("Open the app and", 12, 92);
  canvas.drawString("tap Create wallet", 12, 112);
  int cx = 196, cy = 60;
  for (int i = 0; i < 3; i++) {
    float ph = fmodf(t01(2400) + i / 3.0f, 1.0f);
    int r = 6 + (int)(ph * 34);
    uint8_t a = (uint8_t)(200 * (1 - ph));
    canvas.drawCircle(cx, cy, r, M5.Display.color565(a, a, a));
  }
  canvas.fillCircle(cx, cy, 5, C_ACCENT);
  statusIcons();
}

static void drawPairHold() {
  title("Pair with this phone?", C_TEXT);
  holdRing(A_ON_RIGHT ? 48 : W - 48, 74, 30);
  arrowsToA(74, "Hold A");
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(bottom_left);
  canvas.setTextColor(C_FAINT);
  canvas.drawString(paired ? "Replaces this stick's wallet" : "B to cancel", 10, H - 6);
}

// Phone on the left, stick on the right, a chain of dots running between them.
static void drawKeygen() {
  title("Creating your key", C_TEXT);
  int y = 76;
  canvas.drawRoundRect(22, y - 26, 30, 52, 5, C_TEXT);
  canvas.fillRect(27, y - 20, 20, 32, C_CELL);
  canvas.drawRoundRect(W - 58, y - 18, 40, 36, 5, C_TEXT);
  canvas.fillRect(W - 52, y - 12, 28, 18, C_CELL);
  int x0 = 58, x1 = W - 64;
  for (int x = x0; x <= x1; x += 8) canvas.drawPixel(x, y, C_FAINT);
  float t = t01(1100);
  for (int i = 0; i < 4; i++) {
    float ph = fmodf(t + i / 4.0f, 1.0f);
    int x = x0 + (int)((x1 - x0) * ph);
    int yy = y - (int)(10 * sinf(ph * 3.14159f));
    canvas.fillCircle(x, yy, 3, C_ACCENT);
    float ph2 = fmodf(t + i / 4.0f + 0.5f, 1.0f);
    int xb = x1 - (int)((x1 - x0) * ph2);
    int yb = y + (int)(10 * sinf(ph2 * 3.14159f));
    canvas.fillCircle(xb, yb, 2, C_TEXT);
  }
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(bottom_center);
  canvas.setTextColor(C_MUTED);
  canvas.drawString("Neither side holds the whole key", W / 2, H - 6);
}

static void drawHome() {
  bool hot = expCap > 0 && expSpent / expCap >= 0.8;
  int cx = 52, cy = 72, r = 40;
  canvas.fillCircle(cx + 2, cy + 4, r + 1, C_BG);
  canvas.fillCircle(cx, cy, r - 1, C_PANEL);
  canvas.drawCircle(cx, cy, r, C_CELL);
  canvas.drawCircle(cx, cy, r - 7, C_CELL);
  if (expCap > 0) {
    float left = std::max(0.0, std::min(1.0, expLeft / expCap));
    // The ring sweeps in when the screen appears.
    float shown = left * easeOut(since(700));
    arcRing(cx, cy, r, 8, 0, 360 * shown, hot ? C_ACCENT : C_TEXT);
  }
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(expCap > 0 ? (hot ? C_ACCENT : C_TEXT) : C_FAINT);
  canvas.drawString(expCap > 0 ? String((int)round(100 * expLeft / expCap)) + "%" : "-", cx, cy);
  int x = 106;
  title("ESP32 / WRIST", C_ACCENT);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(C_MUTED);
  canvas.drawString(expCap > 0 ? "Remaining" : "No keys yet", x, 38);
  canvas.setFont(&fonts::FreeSansBold12pt7b);
  canvas.setTextColor(expCap == 0 ? C_FAINT : hot ? C_ACCENT : C_TEXT);
  canvas.drawString(expUnit == "ETH" ? ethStr(expCap > 0 ? expLeft : 0) : dollars(expCap > 0 ? expLeft : 0), x, 60);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_FAINT);
  canvas.drawString(expCap > 0 ? String(expKeys) + (expKeys == 1 ? " live key" : " live keys") : "Issue one in the app", x, 94);
  statusIcons();
}

static void drawPrompt() {
  // The card slides in from the right.
  int off = (int)((1 - easeOut(since(260))) * W);
  canvas.fillRoundRect(6 + off, 7, W - 8, H - 8, 8, C_BG);
  canvas.fillRoundRect(4 + off, 4, W - 10, H - 11, 8, C_PANEL);
  canvas.drawFastHLine(14 + off, 6, W - 32, themeGlow(170));
  canvas.drawRoundRect(4 + off, 4, W - 8, H - 8, 8, C_ACCENT);
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(C_ACCENT);
  if (canvas.textWidth(prompt.title) > W - 28) canvas.setFont(&fonts::Font0);
  canvas.drawString(prompt.title, 14 + off, 12);
  canvas.setFont(&fonts::FreeSansBold18pt7b);
  canvas.setTextColor(C_TEXT);
  if (canvas.textWidth(prompt.amount) > W - 28) canvas.setFont(&fonts::FreeSansBold12pt7b);
  if (canvas.textWidth(prompt.amount) > W - 28) canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.drawString(prompt.amount, 14 + off, 34);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_MUTED);
  if (canvas.textWidth(prompt.line1) > W - 28) canvas.setFont(&fonts::Font0);
  canvas.drawString(prompt.line1, 14 + off, 70);
  if (prompt.line2.length()) {
    canvas.setFont(&fonts::Font0);
    canvas.setTextColor(C_FAINT);
    canvas.drawString(prompt.line2, 14 + off, 90);
  }
  if (off == 0) {
    int ringX = A_ON_RIGHT ? W - 34 : 34;
    canvas.drawCircle(ringX, 108, 14, C_CELL);
    if (holdProgress > 0) arcRing(ringX, 108, 14, 4, 0, 360 * holdProgress, C_ACCENT);
    canvas.setFont(&fonts::FreeSansBold9pt7b);
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(C_ACCENT);
    canvas.drawString("A", ringX, 109);
    canvas.setTextDatum(A_ON_RIGHT ? middle_right : middle_left);
    float bob = 3 * sinf(t01(700) * 6.283f);
    canvas.drawString("Hold to approve", (A_ON_RIGHT ? ringX - 20 : ringX + 20) + (int)(bob * (A_ON_RIGHT ? 1 : -1)), 109);
    canvas.setFont(&fonts::Font0);
    canvas.setTextDatum(middle_left);
    canvas.setTextColor(C_FAINT);
    if (A_ON_RIGHT) canvas.drawString("B: no", 14, 109);
  }
}

static void drawResult() {
  float p = since(900);
  int cx = W / 2, cy = 56;
  int dx = 0;
  if (resultFx == Fx::Burst) {
    float e = easeOut(p);
    for (int i = 0; i < 12; i++) {
      float ang = i * 3.14159f / 6;
      int r0 = (int)(10 + 30 * e), r1 = (int)(18 + 42 * e);
      uint8_t a = (uint8_t)(255 * (1 - p));
      canvas.drawLine(cx + cosf(ang) * r0, cy + sinf(ang) * r0, cx + cosf(ang) * r1, cy + sinf(ang) * r1,
                      themeGlow(a));
    }
    canvas.fillCircle(cx, cy, (int)(14 * e), resultColor);
    canvas.fillCircle(cx, cy, (int)(9 * e), C_BG);
    // a check mark once the burst lands
    if (p > 0.4f) {
      canvas.drawLine(cx - 5, cy, cx - 1, cy + 4, resultColor);
      canvas.drawLine(cx - 1, cy + 4, cx + 6, cy - 4, resultColor);
      canvas.drawLine(cx - 5, cy + 1, cx - 1, cy + 5, resultColor);
      canvas.drawLine(cx - 1, cy + 5, cx + 6, cy - 3, resultColor);
    }
  } else if (resultFx == Fx::Shake) {
    dx = (int)(10 * sinf(p * 6.283f * 4) * (1 - p));
  }
  canvas.setFont(&fonts::FreeSansBold12pt7b);
  canvas.setTextDatum(resultFx == Fx::Burst ? middle_center : middle_center);
  canvas.setTextColor(resultColor);
  canvas.drawString(resultText, cx + dx, resultFx == Fx::Burst ? 108 : 68);
}

static void drawRevoked() {
  title("ESP32 / WRIST", C_ACCENT);
  canvas.setFont(&fonts::FreeSansBold12pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(C_RED);
  canvas.drawString("Stopping agents", 12, 42);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_MUTED);
  canvas.drawString("Phone is confirming...", 12, 78);
  canvas.drawString("Check the app for the result.", 12, 98);
  statusIcons();
}

static void drawConfirm(const char* t, const String& line, const char* hold) {
  title(t, C_ACCENT);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(C_TEXT);
  canvas.drawString(line, 12, 36);
  holdRing(A_ON_RIGHT ? 40 : W - 40, 92, 22);
  arrowsToA(92, hold);
}

// Two sticks facing each other, pulses of light between them, and how much has crossed.
static void drawBeam() {
  bool bad = irui.lastBad && millis() - irui.lastBad < 900;
  uint16_t beam = bad ? C_RED : C_ACCENT;
  title(irui.label.c_str(), C_TEXT);
  int y = 62;
  // this stick on the left, the other on the right; the light flows from the sender
  deviceModel(10, y - 16, isVault);
  deviceModel(W - 60, y - 16, !isVault);
  int x0 = 67, x1 = W - 67;
  float t = t01(bad ? 1400 : 700);
  for (int i = 0; i < 5; i++) {
    float ph = fmodf(t + i / 5.0f, 1.0f);
    float at = irui.sending ? ph : 1 - ph;
    int x = x0 + (int)((x1 - x0) * at);
    int r = 6 + (int)(10 * sinf(ph * 3.14159f));
    // arcs open toward where the light is going
    if (irui.sending) canvas.drawArc(x, y, r, r - 2, 300, 60, beam);
    else canvas.drawArc(x, y, r, r - 2, 120, 240, beam);
  }
  // progress
  int bx = 22, bw = W - 44, by = 100;
  canvas.drawRoundRect(bx, by, bw, 8, 4, C_FAINT);
  float frac = irui.total ? (float)irui.done / (float)irui.total : 0;
  if (!irui.total) frac = fmodf(t, 1.0f);  // receiving: length unknown until the end
  int fw = std::max(6, (int)((bw - 4) * std::min(1.0f, frac)));
  if (irui.total) canvas.fillRoundRect(bx + 2, by + 2, fw, 4, 2, beam);
  else canvas.fillRoundRect(bx + 2 + (int)((bw - 30) * frac), by + 2, 26, 4, 2, beam);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextDatum(bottom_center);
  canvas.setTextColor(bad ? C_RED : C_MUTED);
  String foot = bad ? "Can't read. Face the sticks." : irui.total ? String((int)(frac * 100)) + "%  keep them facing" : String((int)irui.done) + " bytes in";
  canvas.drawString(foot, W / 2, H - 4);
}

static void drawVault();
static bool isVaultRole();
static void draw() {
  if (mode != lastDrawnMode) {
    lastDrawnMode = mode;
    modeSince = millis();
  }
  drawSurface();
  if (isVaultRole() && (mode == Mode::Home || mode == Mode::Unpaired)) {
    drawVault();
    canvas.pushSprite(0, 0);
    return;
  }
  switch (mode) {
    case Mode::Unpaired: drawIdle(); break;
    case Mode::Pairing: pairWaitingPhone ? drawKeygen() : drawPairHold(); break;
    case Mode::Home: drawHome(); break;
    case Mode::Prompt: drawPrompt(); break;
    case Mode::Result: drawResult(); break;
    case Mode::Revoked: drawRevoked(); break;
    case Mode::ConfirmWipe: drawConfirm("Erase this stick?", "The wallet here can't sign again.", "Hold A"); break;
    case Mode::ConfirmWifi: drawConfirm("Join network?", pendingNet.ssid.substring(0, 24), "Hold A"); break;
    case Mode::Beam: drawBeam(); break;
  }
  canvas.pushSprite(0, 0);
}

// A frame did not get through: a low buzz, at most once a second, so it reads as a warning.
static void rootProgress(const char* step) {
  if (isVault || !rjob.id.length()) return;
  JsonDocument d;
  d["t"] = "root_progress";
  d["id"] = rjob.id;
  d["step"] = step;
  send(d);
}

static void irMiss() {
  irui.lastBad = millis();
  irui.bad++;
  if (millis() - irui.lastBeep > 1000) {
    irui.lastBeep = millis();
    beep(330, 70);
    rootProgress("ir_miss");  // the phone shows it too
  }
}

static void irSending(const char* label) {
  irui = IrUi{};
  irui.label = label;
  irui.sending = true;
  mode = Mode::Beam;
  draw();
}

// Called by the IR layer between frames while we send.
static void irOnSend(size_t done, size_t total, bool retry) {
  if (mode != Mode::Beam) return;
  irui.done = done;
  irui.total = total;
  if (retry) irMiss();
  if (millis() - irui.lastDraw > 60 || done == total) {
    irui.lastDraw = millis();
    draw();
  }
}

// Called by the IR layer as frames arrive. A message starting to arrive shows the beam.
static void irOnRecv(size_t bytes, bool bad) {
  bool inbound = benchInbound || (isVault ? (mode != Mode::Prompt) : (rjob.active || rjob.held));
  if (!inbound) return;
  if (mode != Mode::Beam) {
    if (bad) return;  // stray infrared, a TV remote say: not ours to warn about
    irui = IrUi{};
    irui.label = isVault ? "From your wrist" : "From your 2nd stick";
    irui.sending = false;
    mode = Mode::Beam;
    draw();  // one still frame; the screen stays quiet until the message is in
    irui.lastDraw = millis();
    rootProgress("ir_from_vault");
  }
  irui.done = bytes;
  irui.lastRecv = millis();
  if (bad) {
    // No beep here: the speaker amp must stay off while receiving. The sender beeps instead.
    irui.lastBad = millis();
    irui.bad++;
  }
  if (irRxAnimate && millis() - irui.lastDraw > 60) {
    irui.lastDraw = millis();
    draw();
  }
}

// Screens that move redraw on their own.
static bool animating() {
  if (mode == Mode::Beam) return irui.sending || irRxAnimate;  // receiving: hold still
  if (mode == Mode::Unpaired || mode == Mode::Pairing || mode == Mode::Prompt) return true;
  if (mode == Mode::ConfirmWipe || mode == Mode::ConfirmWifi) return true;
  if (mode == Mode::Result) return millis() - modeSince < 1000;
  if (mode == Mode::Home && isVault) return windowOpen() || (!vJoined && M5.BtnA.isPressed()) || millis() - modeSince < 800;
  if (mode == Mode::Home) return millis() - modeSince < 800;
  return false;
}

// Hold A for `need` ms. true once, when the hold completes. Letting go early resets.
static bool heldA(uint32_t need = 1000) {
  if (waitRelease) {
    if (!M5.BtnA.isPressed()) waitRelease = false;
    holdProgress = 0;
    return false;
  }
  if (!M5.BtnA.isPressed()) {
    holdStart = 0;
    holdProgress = 0;
    return false;
  }
  if (!holdStart) holdStart = millis();
  holdProgress = std::min(1.0f, (float)(millis() - holdStart) / need);
  if (millis() - holdStart >= need) {
    holdStart = 0;
    holdProgress = 0;
    waitRelease = true;
    return true;
  }
  return false;
}

static void showResult(const String& text, uint16_t color, uint32_t ms = 1800, Fx fx = Fx::None) {
  resultFx = fx;
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
  d["uiTheme"] = isVault ? "esp32-red-3d" : "esp32-blue-3d";
  d["reset"] = (int)esp_reset_reason();  // 1 power-on, 3 software, 4 panic, 5-7 watchdog, 9 brownout
  d["uptime"] = millis() / 1000;
  d["via"] = ble::connected() ? "ble" : relayUp ? "relay" : tcp.connected() ? "wifi" : "usb";
  d["role"] = isVault ? "vault" : "wrist";
  if (!isVault) d["threeOfThree"] = mgr3;
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
  d["via"] = ble::connected() ? "ble" : relayUp ? "relay" : tcp.connected() ? "wifi" : "usb";
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
  // Pairing code: sha256("KAGI/pair" || phoneNonce || wristNonce), first 4 bytes.
  static const char TAG[] = "KAGI/pair";
  const size_t T = sizeof TAG - 1;
  uint8_t buf[sizeof TAG - 1 + 32];
  memcpy(buf, TAG, T);
  memcpy(buf + T, pn, 16);
  memcpy(buf + T + 16, wn, 16);
  uint8_t h[32];
  frost::sha256(buf, sizeof buf, h);
  String c = hex(h, 4);
  c.toUpperCase();
  pairCode = c.substring(0, 4) + " " + c.substring(4, 8);
  pairWaitingPhone = false;
  mode = Mode::Pairing;
  waitRelease = M5.BtnA.isPressed();
  dirty = true;
  buzz(2);
  JsonDocument d;
  d["t"] = "pair";
  d["nonce"] = hex(wn, 16);
  send(d);
#ifdef KAGI_AUTO_APPROVE
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
  showResult("Wallet ready", C_TEXT, 2600, Fx::Burst);
  chime();
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
  // Once the wallet key is 3 of 3, the old 2-of-2 path is gone: the phone must use root_sign.
  if (mgr3 && p.kind.startsWith("evm")) return reject(id, "needs_second_stick");
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
  } else if (p.kind == "evm_limit") {
    // Raising a session key's total allowance. Rebuild the contract's preimage:
    // "KAGI/limit" || chainid || account || nonce || agent || oldCap || newCap || expiry
    String chain = String(in["chainId"] | "");
    String account = in["account"] | "";
    String nonceS = in["nonce"] | "";
    String agentAddr = in["agentAddress"] | "";
    String oldS = in["oldCap"] | "";
    String newS = in["newCap"] | "";
    String expS = in["expiry"] | "";
    static const char TAG[] = "KAGI/limit";
    const size_t T = sizeof TAG - 1;
    uint8_t pre[sizeof TAG - 1 + 32 + 20 + 32 + 20 + 32 + 32 + 32];
    memcpy(pre, TAG, T);
    if (!frost::u256FromDecimal(chain.c_str(), pre + T) || !unhex(account.c_str(), pre + T + 32, 20) ||
        !frost::u256FromDecimal(nonceS.c_str(), pre + T + 52) || !unhex(agentAddr.c_str(), pre + T + 84, 20) ||
        !frost::u256FromDecimal(oldS.c_str(), pre + T + 104) || !frost::u256FromDecimal(newS.c_str(), pre + T + 136) ||
        !frost::u256FromDecimal(expS.c_str(), pre + T + 168))
      return reject(id, "bad_request");
    frost::sha256(pre, sizeof pre, p.msg);
    p.title = "Raise " + agent + "'s total";
    p.amount = ethStr(strtod(newS.c_str(), nullptr) / 1e18);
    p.line1 = "was " + ethStr(strtod(oldS.c_str(), nullptr) / 1e18);
    String left = minutesLeft(expS);
    p.line2 = "same expiry" + (left.length() ? ", " + left : String(""));
    prompt = p;
    prompt.shownAt = millis();
    mode = Mode::Prompt;
    dirty = true;
    draw();
    buzz(2);
#ifdef KAGI_AUTO_APPROVE
    autoAt = millis() + 3000;  // long enough to read the prompt
#endif
    return;
  } else if (p.kind == "evm_grant") {
    // A session key grant on the Kagi account. Rebuild the contract's preimage:
    // "KAGI/grant" || chainid || account || nonce || agent || cap || expiry
    String chain = String(in["chainId"] | "");
    String account = in["account"] | "";
    String nonceS = in["nonce"] | "";
    String agentAddr = in["agentAddress"] | "";
    String capS = in["cap"] | "";
    String expS = in["expiry"] | "";
    static const char TAG[] = "KAGI/grant";
    const size_t T = sizeof TAG - 1;
    uint8_t pre[sizeof TAG - 1 + 32 + 20 + 32 + 20 + 32 + 32];
    memcpy(pre, TAG, T);
    if (!frost::u256FromDecimal(chain.c_str(), pre + T) || !unhex(account.c_str(), pre + T + 32, 20) ||
        !frost::u256FromDecimal(nonceS.c_str(), pre + T + 52) || !unhex(agentAddr.c_str(), pre + T + 84, 20) ||
        !frost::u256FromDecimal(capS.c_str(), pre + T + 104) || !frost::u256FromDecimal(expS.c_str(), pre + T + 136))
      return reject(id, "bad_request");
    frost::sha256(pre, sizeof pre, p.msg);
    p.title = "New key for " + agent;
    p.amount = ethStr(strtod(capS.c_str(), nullptr) / 1e18);
    p.line1 = "total allowance, key " + shortHex(agentAddr, 4, 4);
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
#ifdef KAGI_AUTO_APPROVE
    autoAt = millis() + 3000;  // long enough to read the prompt
#endif
    return;
  } else if (p.kind == "evm") {
    // A call through the Kagi smart account. Rebuild the contract's preimage:
    // "KAGI/evm" || chainid || account || nonce || to || value || data
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
    static const char TAG[] = "KAGI/evm";
    const size_t T = sizeof TAG - 1;
    std::vector<uint8_t> pre(T + 32 + 20 + 32 + 20 + 32 + dlen);
    uint8_t* w = pre.data();
    memcpy(w, TAG, T);
    memcpy(w + T, chainB, 32);
    memcpy(w + T + 32, accB, 20);
    memcpy(w + T + 52, nonceB, 32);
    memcpy(w + T + 84, toB, 20);
    memcpy(w + T + 104, valB, 32);
    if (dlen && !unhex(dataHex.c_str(), w + T + 136, dlen)) return reject(id, "bad_request");
    frost::sha256(pre.data(), pre.size(), p.msg);
    String net = chain == "11155111" ? "TESTNET" : chain == "1" ? "MAINNET" : "chain " + chain;
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
#ifdef KAGI_AUTO_APPROVE
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
#ifdef KAGI_AUTO_APPROVE
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
  showResult("Approved", C_TEXT, 1800, Fx::Burst);
  chirp();
}

static void onExposure(JsonDocument& in) {
  expUnit = String(in["unit"] | "USD");
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

static void saveRoot();
static bool persistJoin() {
  Preferences p;
  p.begin("root", false);
  bool ok = p.putBytes("join", &joinRecord, sizeof joinRecord) == sizeof joinRecord;
  p.end();
  return ok;
}
static void applyJoinedShares() {
  memcpy(rshare, joinRecord.share, 32);
  memcpy(rgk, joinRecord.group, 32);
  rparties = 3;
  rootIsManager = true;
  memcpy(share, rshare, 32);
  mgr3 = true;
  saveShare();
  saveRoot();
}

static void loadRoot() {
  Preferences p;
  p.begin("root", false);
  isVault = p.getString("role", "wrist") == "vault";
  soundsEnabled = p.getBool("sound", true);
  if (p.getBytes("join", &joinRecord, sizeof joinRecord) != sizeof joinRecord) joinRecord = JoinRecord{};
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
    rootIsManager = rparties && p.getBool("radopt", false);
  }
  p.end();
  // Committing the single journal record is the durable decision. Complete its writes on boot.
  if (!isVault && paired && joinRecord.version == 1 && joinRecord.committed &&
      memcmp(joinRecord.group, groupKey, 32) == 0) applyJoinedShares();
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
    p.putBool("radopt", rootIsManager);
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

static size_t compactLen(char type) { return type == 'E' ? 64 : type == 'L' ? 88 : 72; }

// 'E': sha256("KAGI/evm" || chainid || account || nonce || to || value), the call format the
// root treasury contract checks. Compact: chainId u32 | account 20 | nonce u32 | to 20 | value u128
static void rootEvmMsg(const uint8_t c[64], uint8_t out[32]) {
  static const char TAG[] = "KAGI/evm";
  const size_t T = sizeof TAG - 1;
  uint8_t pre[sizeof TAG - 1 + 32 + 20 + 32 + 20 + 32];
  memset(pre, 0, sizeof pre);
  memcpy(pre, TAG, T);
  memcpy(pre + T + 28, c, 4);             // chainid
  memcpy(pre + T + 32, c + 4, 20);        // account
  memcpy(pre + T + 52 + 28, c + 24, 4);   // nonce
  memcpy(pre + T + 84, c + 28, 20);       // to
  memcpy(pre + T + 104 + 16, c + 48, 16); // value
  frost::sha256(pre, sizeof pre, out);
}

static void rootMsgGrant(const char* tag, const uint8_t c[72], uint8_t out[32]);
static void rootMsgLimit(const uint8_t c[88], uint8_t out[32]);
static void rootMsg(char type, const uint8_t* c, uint8_t out[32]) {
  if (type == 'E') rootEvmMsg(c, out);
  else if (type == 'L') rootMsgLimit(c, out);
  else rootMsgGrant(type == 'A' ? "KAGI/grant" : "KAGI/rootgrant", c, out);
}

// sha256(tag || chainid || account || nonce || agent || cap || expiry), 32-byte fields.
// 'G' uses "KAGI/rootgrant" (root treasury), 'A' uses "KAGI/grant" (a new agent key on the wallet).
static void rootMsgGrant(const char* tag, const uint8_t c[72], uint8_t out[32]) {
  const size_t T = strlen(tag);
  uint8_t pre[32 + 32 + 20 + 32 + 20 + 32 + 32];
  memset(pre, 0, sizeof pre);
  memcpy(pre, tag, T);
  memcpy(pre + T + 28, c, 4);             // chainid
  memcpy(pre + T + 32, c + 4, 20);        // account
  memcpy(pre + T + 52 + 28, c + 24, 4);   // nonce
  memcpy(pre + T + 84, c + 28, 20);       // agent
  memcpy(pre + T + 104 + 16, c + 48, 16); // cap
  memcpy(pre + T + 136 + 24, c + 64, 8);  // expiry
  frost::sha256(pre, T + 168, out);
}

// sha256("KAGI/limit" || chainid || account || nonce || agent || oldCap || newCap || expiry).
// Compact: chainId u32 | account 20 | nonce u32 | agent 20 | oldCap u128 | newCap u128 | expiry u64
static void rootMsgLimit(const uint8_t c[88], uint8_t out[32]) {
  static const char TAG[] = "KAGI/limit";
  const size_t T = sizeof TAG - 1;
  uint8_t pre[sizeof TAG - 1 + 32 + 20 + 32 + 20 + 32 + 32 + 32];
  memset(pre, 0, sizeof pre);
  memcpy(pre, TAG, T);
  memcpy(pre + T + 28, c, 4);             // chainid
  memcpy(pre + T + 32, c + 4, 20);        // account
  memcpy(pre + T + 52 + 28, c + 24, 4);   // nonce
  memcpy(pre + T + 84, c + 28, 20);       // agent
  memcpy(pre + T + 104 + 16, c + 48, 16); // oldCap
  memcpy(pre + T + 136 + 16, c + 64, 16); // newCap
  memcpy(pre + T + 168 + 24, c + 80, 8);  // expiry
  frost::sha256(pre, sizeof pre, out);
}

static double u128(const uint8_t* b) {
  double v = 0;
  for (int i = 0; i < 16; i++) v = v * 256 + b[i];
  return v;
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
  if (type == 'A') {
    p.title = isVault ? "2nd stick: new key" : "New agent key";
    p.amount = ethStr(u128(c + 48) / 1e18);
    p.line1 = "total allowance, key " + shortHex(hex(c + 28, 20), 4, 4);
    p.line2 = isVault ? "A: sign  B: no" : "then the second stick";
    return;
  }
  if (type == 'L') {
    p.title = isVault ? "2nd stick: raise" : "Raise the total";
    p.amount = ethStr(u128(c + 64) / 1e18);
    p.line1 = "was " + ethStr(u128(c + 48) / 1e18) + ", key " + shortHex(hex(c + 28, 20), 4, 4);
    p.line2 = isVault ? "A: sign  B: no" : "then the second stick";
    return;
  }
  p.amount = ethStr(u128(c + 48) / 1e18);
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
#ifdef KAGI_AUTO_APPROVE
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
  uint8_t operation[16];
  String id = in["id"] | "";
  if (!rootIsManager || id.length() != 32 || !unhex(id.c_str(), operation, 16)) return reject("root_reshare", "bad_request");
  if (mode == Mode::Prompt || rjob.active || rjob.held) return reject("root_reshare", "busy");
  proposedJoinId = id;
  if (rparties != 2) return reject("root_reshare", rparties == 3 ? "already_3_of_3" : "no_root_key");
  if (!unhex(in["vaultPub"] | "", pendVaultPub, 33)) return reject("root_reshare", "bad_request");
  Prompt p;
  p.id = "root_reshare";
  p.kind = "root_reshare";
  p.title = rootIsManager ? "Add second stick" : "Add vault";
  p.amount = fingerprint(pendVaultPub);
  p.line1 = rootIsManager ? "same code on the other stick?" : "same code on the vault?";
  p.line2 = rootIsManager ? "then every approval needs both" : "root key becomes 3 of 3";
  showPrompt(p);
}

static void rootDrop();
static void onRootSign(JsonDocument& in) {
  String id = in["id"] | "";
  if (rparties != 3) return reject(id, "root_not_3_of_3");
  if (rjob.active) return reject(id, "busy");
  if (rjob.held) rootDrop();  // a paused request the phone gave up on
  Prompt p;
  p.id = id;
  p.kind = "root_sign";
  uint8_t* c = rjob.compact;
  String kind = in["kind"] | "grant";
  rjob.type = kind == "evm" ? 'E' : kind == "evm_grant" ? 'A' : kind == "evm_limit" ? 'L' : 'G';
  bool ok = tailOf(String(in["chainId"] | "").c_str(), c, 4) && unhex(in["account"] | "", c + 4, 20) &&
            tailOf(String(in["nonce"] | "").c_str(), c + 24, 4) && unhex(in["D"] | "", rjob.D[0], 33) &&
            unhex(in["E"] | "", rjob.E[0], 33);
  if (rjob.type == 'E')
    ok = ok && unhex(in["to"] | "", c + 28, 20) && tailOf(String(in["value"] | "").c_str(), c + 48, 16);
  else if (rjob.type == 'L')
    ok = ok && unhex(in["agentAddress"] | "", c + 28, 20) && tailOf(String(in["oldCap"] | "").c_str(), c + 48, 16) &&
         tailOf(String(in["newCap"] | "").c_str(), c + 64, 16) && tailOf(String(in["expiry"] | "").c_str(), c + 80, 8);
  else if (rjob.type == 'A')
    ok = ok && unhex(in["agentAddress"] | "", c + 28, 20) && tailOf(String(in["cap"] | "").c_str(), c + 48, 16) &&
         tailOf(String(in["expiry"] | "").c_str(), c + 64, 8);
  else
    ok = ok && unhex(in["agent"] | "", c + 28, 20) && tailOf(String(in["cap"] | "").c_str(), c + 48, 16) &&
         tailOf(String(in["expiry"] | "").c_str(), c + 64, 8);
  if (!ok) return reject(id, "bad_request");
  rootMsg(rjob.type, c, rjob.msg);
  memcpy(p.msg, rjob.msg, 32);
  rjob.id = id;
  p.title = "ROOT action";
  describeRoot(rjob.type, c, p);
  // The phone knows the agent's name; the compact form only has its address.
  String agentName = in["agent"] | "";
  if (rjob.type == 'A' && agentName.length() && !agentName.startsWith("0x")) p.title = "New key for " + agentName;
  if (rjob.type == 'L' && agentName.length() && !agentName.startsWith("0x")) p.title = "Raise " + agentName + "'s total";
  showPrompt(p);
}

static void irShowWaiting(const char* text) {
  resultText = text;
  resultColor = C_ACCENT;
  resultUntil = millis() + 600000;
  mode = Mode::Result;
  draw();
}

// Wrist: the job is paused, not lost. The phone can ask to send it again.
static void rootStall(const char* reason) {
  rjob.active = false;
  rjob.held = true;
  rjob.heldSince = millis();
  JsonDocument d;
  d["t"] = "root_stalled";
  d["id"] = rjob.id;
  d["reason"] = reason;
  send(d);
}

static void rootDrop() {
  frost::wipe(rjob.n);
  rjob.active = rjob.held = false;
  rjob.id = "";
}

// Wrist: send the request to the second stick over IR. Used for the first try and for retries.
static void rootSendToVault() {
  // 'S' | type | compact | D1 E1 D2 E2
  size_t cl = compactLen(rjob.type);
  uint8_t pkt[2 + 88 + 4 * 33];
  pkt[0] = 'S';
  pkt[1] = rjob.type;
  memcpy(pkt + 2, rjob.compact, cl);
  uint8_t* q = pkt + 2 + cl;
  memcpy(q, rjob.D[0], 33);
  memcpy(q + 33, rjob.E[0], 33);
  memcpy(q + 66, rjob.D[1], 33);
  memcpy(q + 99, rjob.E[1], 33);
  size_t pktLen = 2 + cl + 132;
  rjob.held = false;
  irSending(rootIsManager ? "To your 2nd stick" : "To the vault");
  JsonDocument st;
  st["t"] = "root_progress";
  st["id"] = rjob.id;
  st["step"] = "ir_to_vault";
  send(st);
  if (!ir::send(pkt, pktLen, 45000)) {
    rootStall("ir_failed");
    buzz(3);
    showResult(rootIsManager ? "2nd stick not in sight" : "Vault not in sight", C_RED, 4000, Fx::Shake);
    return;
  }
  rjob.active = true;
  rjob.sentAt = millis();
  chirp();
  irShowWaiting(rootIsManager ? "2nd stick: hold A" : "Vault: press A");
  JsonDocument d;
  d["t"] = "root_progress";
  d["id"] = rjob.id;
  d["step"] = "vault_prompted";
  send(d);
}

// Wrist: after A, commit our nonces once, then send.
static void rootSignToVault() {
  frost::commit(rjob.n, rjob.D[1], rjob.E[1]);
  rootSendToVault();
}

// Wrist: the vault answered over IR.
static void rootFromVault(const std::vector<uint8_t>& m) {
  // A late answer, after a timeout paused the job, still counts.
  if (!rjob.active && !rjob.held) return;
  rjob.active = rjob.held = false;
  if (m[0] == 'R' || m.size() < 1 + 33 + 33 + 32) {
    String id = rjob.id;
    rootDrop();
    reject(id, "vault_rejected");
    showResult("Vault said no", C_MUTED, 3000);
    return;
  }
  memcpy(rjob.D[2], m.data() + 1, 33);
  memcpy(rjob.E[2], m.data() + 34, 33);
  const uint8_t* z3 = m.data() + 67;
  uint8_t ids[3] = {1, 2, 3};
  uint8_t z2[32];
  bool signedOk = frost::respond(rshare, rgk, rjob.msg, 3, ids, rjob.D, rjob.E, 2, rjob.n, z2);
  // Our nonces are used now, whatever happens: never again for this job.
  frost::wipe(rjob.n);
  if (!signedOk) {
    reject(rjob.id, "sign_failed");
    rjob.id = "";
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
  rjob.id = "";  // finished: nothing left to retry
  showResult(rootIsManager ? "Signed by both sticks" : "Root signed", C_TEXT, 2600, Fx::Burst);
  chime();
}

// Vault: a root request arrived over IR.
static void vaultRequest(const std::vector<uint8_t>& m) {
  if (m.size() < 2) return;
  char type = (char)m[1];
  size_t cl = compactLen(type);
  if ((type != 'E' && type != 'G' && type != 'A' && type != 'L') || m.size() != 2 + cl + 4 * 33) return;
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
  // The hand that just held A is usually over the stick. Wait for it to let go and give it a
  // moment to settle, so the reply goes out with the window clear and pointing at the wrist.
  irSending("Let go, aim at the wrist");
  uint32_t t0 = millis();
  while (M5.BtnA.isPressed() && millis() - t0 < 4000) {
    M5.update();
    delay(20);
  }
  uint32_t t1 = millis();
  while (millis() - t1 < 700) {
    if (millis() - irui.lastDraw > 60) {
      irui.lastDraw = millis();
      draw();
    }
    delay(20);
  }
  irui.label = "Back to your wrist";
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
  bool ok = ir::send(pkt, sizeof pkt, 60000);
  if (!ok) buzz(3);
  showResult(ok ? "Signed" : "Wrist not in sight", ok ? C_TEXT : C_RED, 2600, ok ? Fx::Burst : Fx::Shake);
}

static void vaultReject() {
  uint8_t r[2] = {'R', 0};
  ir::send(r, 2, 8000);
  showResult("Rejected", C_MUTED, 1500, Fx::Shake);
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
  // The reshare happens over the 2-minute window, by Bluetooth or WiFi, never over the USB cable.
  if (lastSource != 'n' && lastSource != 'b') {
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
    showResult("Joined. 3 of 3", C_TEXT, 5000, Fx::Burst);
    chime();
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
  ble::setAdvertising(true);
  startWifi();
  buzz(1);
  dirty = true;
}

static void closeWindow() {
  windowUntil = 0;
  ble::setAdvertising(false);
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
  int lvl = M5.Power.getBatteryLevel();
  // battery, top right, the same as the wrist
  {
    int x = W - 10;
    canvas.drawRect(x - 18, 6, 18, 9, C_MUTED);
    canvas.fillRect(x, 8, 2, 5, C_MUTED);
    if (lvl > 0) canvas.fillRect(x - 16, 8, std::max(1, 14 * std::min(lvl, 100) / 100), 5, lvl < 20 ? C_RED : C_TEXT);
  }

  if (win) {
    // Pairing: radio pulses on the left, the code to compare, and the time left.
    title("PAIRING", C_ACCENT);
    canvas.fillCircle(W - 38, 10, 3, ble::connected() ? C_TEXT : C_ACCENT);
    int cx = 34, cy = 70;
    for (int i = 0; i < 3; i++) {
      float ph = fmodf(t01(1800) + i / 3.0f, 1.0f);
      int r = 5 + (int)(ph * 24);
      uint8_t a = (uint8_t)(230 * (1 - ph));
      canvas.drawCircle(cx, cy, r, themeGlow(a));
    }
    canvas.fillCircle(cx, cy, 4, C_ACCENT);
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextDatum(top_left);
    canvas.setTextColor(C_MUTED);
    canvas.drawString(ble::connected() ? "Phone connected. Code:" : "Same code on the phone?", 70, 34);
    String code = fingerprint(vdevPub);
    canvas.setFont(&fonts::FreeSansBold12pt7b);
    canvas.setTextColor(C_TEXT);
    canvas.drawString(code.substring(0, 4), 70, 56);
    canvas.drawString(code.length() > 5 ? code.substring(5) : String(""), 150, 56);
    // countdown
    uint32_t left = windowUntil > millis() ? windowUntil - millis() : 0;
    float frac = std::min(1.0f, left / 120000.0f);
    int bx = 12, bw = W - 24, by = 104;
    canvas.drawRoundRect(bx, by, bw, 8, 4, C_FAINT);
    canvas.fillRoundRect(bx + 2, by + 2, std::max(4, (int)((bw - 4) * frac)), 4, 2, frac < 0.2f ? C_RED : C_ACCENT);
    canvas.setFont(&fonts::Font0);
    canvas.setTextDatum(bottom_left);
    canvas.setTextColor(C_FAINT);
    canvas.drawString("In the app: + Device", 12, H - 4);
    canvas.setTextDatum(bottom_right);
    canvas.drawString(String(left / 1000) + " s", W - 12, H - 4);
    return;
  }

  if (!vJoined) {
    // Waiting to be added: hold A for 2 s, with the ring filling as you hold.
    title("ESP32 / SECOND", C_ACCENT);
    static uint32_t pressAt = 0;
    if (M5.BtnA.isPressed()) {
      if (!pressAt) pressAt = millis();
    } else {
      pressAt = 0;
    }
    float hp = pressAt ? std::min(1.0f, (millis() - pressAt) / 2000.0f) : 0.0f;
    int rx = A_ON_RIGHT ? 44 : W - 44, ry = 72, rr = 28;
    canvas.drawCircle(rx, ry, rr, C_CELL);
    canvas.drawCircle(rx, ry, rr - 1, C_CELL);
    if (hp > 0) arcRing(rx, ry, rr, 6, 0, 360 * hp, C_ACCENT);
    canvas.setFont(&fonts::FreeSansBold12pt7b);
    canvas.setTextDatum(middle_center);
    canvas.setTextColor(hp > 0 ? C_ACCENT : C_TEXT);
    canvas.drawString("A", rx, ry + 1);
    arrowsToA(56, "Hold A");
    canvas.setFont(&fonts::FreeSans9pt7b);
    canvas.setTextDatum(top_left);
    canvas.setTextColor(C_MUTED);
    canvas.drawString("to join a wallet", 90, 80);
    canvas.setTextColor(C_FAINT);
    canvas.drawString("then + Device in the app", 90, 100);
    return;
  }

  // Joined: a closed ring, and what it is for. Held still: it is listening for the wrist.
  title("ESP32 / SECOND", C_ACCENT);
  int cx = 50, cy = 72, r = 38;
  float sweep = easeOut(since(700));
  canvas.fillCircle(cx + 2, cy + 4, r + 1, C_BG);
  canvas.fillCircle(cx, cy, r - 1, C_PANEL);
  canvas.drawCircle(cx, cy, r, C_CELL);
  canvas.drawCircle(cx, cy, r - 7, C_CELL);
  arcRing(cx, cy, r, 7, 0, 360 * sweep, C_ACCENT);
  canvas.setFont(&fonts::FreeSansBold12pt7b);
  canvas.setTextDatum(middle_center);
  canvas.setTextColor(C_TEXT);
  canvas.drawString("3", cx, cy - 8);
  canvas.setFont(&fonts::Font0);
  canvas.setTextColor(C_MUTED);
  canvas.drawString("of 3", cx, cy + 12);
  int x = 102;
  canvas.setFont(&fonts::FreeSansBold9pt7b);
  canvas.setTextDatum(top_left);
  canvas.setTextColor(C_TEXT);
  canvas.drawString("Guarding your", x, 34);
  canvas.drawString("wallet", x, 54);
  canvas.setFont(&fonts::FreeSans9pt7b);
  canvas.setTextColor(C_MUTED);
  canvas.drawString("Signs only by IR", x, 80);
  // IR ready: a small beam mark pointing out toward the wrist
  int iy = 108;
  canvas.fillCircle(x + 4, iy, 3, C_ACCENT);
  for (int i = 1; i <= 3; i++) canvas.drawArc(x + 4, iy, 4 + i * 5, 3 + i * 5, 300, 60, i == 1 ? C_ACCENT : C_FAINT);
  canvas.setTextColor(C_FAINT);
  canvas.drawString("Align", x + 30, iy - 8);
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
    JoinRecord previous = joinRecord;
    joinRecord = JoinRecord{};
    joinRecord.version = 1;
    memcpy(joinRecord.share, rX2new, 32);
    memcpy(joinRecord.group, rgk, 32);
    memcpy(joinRecord.vault, pendVaultPub, 33);
    proposedJoinId.toCharArray(joinRecord.id, sizeof joinRecord.id);
    if (!persistJoin()) { joinRecord = previous; reject("root_reshare", "storage_failed"); return; }
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
  if (t == "ui_snapshot" && lastSource == 'u' && !rjob.active && !rjob.held && !vjob.active && mode != Mode::Beam && mode != Mode::Prompt) {
    Serial.printf("{\"t\":\"ui_snapshot\",\"width\":240,\"height\":135,\"bytes\":97200}\n");
    for (int y = 0; y < H; y++) {
      uint8_t row[W * 3];
      for (int x = 0; x < W; x++) {
        uint16_t rgb = canvas.readPixel(x, y);
        row[x * 3] = ((rgb >> 11) & 31) * 255 / 31; row[x * 3 + 1] = ((rgb >> 5) & 63) * 255 / 63; row[x * 3 + 2] = (rgb & 31) * 255 / 31;
      }
      size_t sent = 0; uint32_t started = millis();
      while (sent < sizeof row) { if (!Serial || millis() - started > 1000) return; size_t n = Serial.write(row + sent, sizeof row - sent); if (!n) delay(1); sent += n; }
    }
    return;
  } else if (t == "alert") {
    // The phone saw something that needs the owner (a limit request, or a payment Intercepta
    // flagged) while it may be in a pocket: buzz, and say what on the home screen. Never
    // interrupts a prompt the owner is already looking at.
    bool red = String(in["level"] | "amber") == "red";
    buzz(red ? 3 : 2);
    if (mode == Mode::Home || mode == Mode::Revoked || mode == Mode::Result)
      showResult(String(in["text"] | "Check your phone"), red ? C_RED : C_ACCENT, 4000, red ? Fx::Shake : Fx::None);
  } else if (t == "sound") {
    soundsEnabled = in["enabled"] | true;
    Preferences p; p.begin("root", false); p.putBool("sound", soundsEnabled); p.end();
  } else if (t == "hello?") sendHello();
  else if (t == "ping") {
  } else if (t == "pair") onPair(in);
  else if (t == "pair_cancel") {
    if (mode == Mode::Pairing) mode = restingMode();
  } else if (t == "dkg") onDkg(in);
  else if (t == "root_dkg") onRootDkg(in);
  else if (t == "root_reshare") onRootReshare(in);
  else if (t == "root_adopt") {
    // Start the reshare from the wallet key itself, so the account's key stays the same.
    JsonDocument d;
    d["t"] = "root_adopted";
    d["joinProtocol"] = 1;
    if (!paired) d["error"] = "not_paired";
    else if (mgr3) d["error"] = "already_3_of_3";
    else {
      memcpy(rshare, share, 32);
      memcpy(rgk, groupKey, 32);
      rparties = 2;
      rootIsManager = true;
      saveRoot();
      d["parties"] = 2;
      d["groupKey"] = hex(rgk, 32);
    }
    send(d);
  } else if (t == "root_commit") {
    String id = in["id"] | "";
    uint8_t expectedGroup[32], expectedPublic[33], actualPublic[33];
    bool valid = !isVault && paired && joinRecord.version == 1 && id == String(joinRecord.id) &&
      unhex(in["groupKey"] | "", expectedGroup, 32) && unhex(in["X2"] | "", expectedPublic, 33) &&
      memcmp(expectedGroup, joinRecord.group, 32) == 0 && memcmp(groupKey, joinRecord.group, 32) == 0;
    if (valid) { frost::pubOf(joinRecord.share, actualPublic); valid = memcmp(expectedPublic, actualPublic, 33) == 0; }
    JsonDocument d;
    d["t"] = "root_committed";
    d["id"] = id;
    if (!valid) d["error"] = "no_matching_staged_join";
    else {
      bool wasCommitted = joinRecord.committed;
      joinRecord.committed = true;
      if (!persistJoin()) { joinRecord.committed = wasCommitted; d["error"] = "storage_failed"; }
      else {
        applyJoinedShares();
        memset(rX2new, 0, 32);
        d["groupKey"] = hex(rgk, 32);
        showResult("Now 3 of 3", C_TEXT, 4000, Fx::Burst);
        if (!wasCommitted) chime();
      }
    }
    d["parties"] = rparties;
    send(d);
  } else if (t == "root_sign") onRootSign(in);
  else if (t == "root_retry") {
    // Send the paused request again. No new approval: the wrist already said yes to this.
    String id = in["id"] | "";
    if (rjob.held && rjob.id == id) rootSendToVault();
    else reject(id, "nothing_to_retry");
  } else if (t == "root_cancel") {
    String id = in["id"] | "";
    if ((rjob.held || rjob.active) && rjob.id == id) {
      rootDrop();
      mode = restingMode();
    }
  }
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
    showResult(isVault ? "This is the vault" : "This is the wrist", C_ACCENT, 3000);
  } else if (t == "ir_bench_rx") {
    benchInbound = in["inbound"] | false;
    irRxAnimate = in["animate"] | false;
    if (!benchInbound && mode == Mode::Beam) mode = restingMode();
    JsonDocument d;
    d["t"] = "ir_bench_rx";
    d["inbound"] = benchInbound;
    d["animate"] = irRxAnimate;
    send(d);
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
#ifdef KAGI_AUTO_APPROVE
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
  C_ACCENT = M5.Display.color565(255, 177, 59);
  C_RED = M5.Display.color565(255, 90, 78);
  C_CELL = M5.Display.color565(38, 41, 47);
  C_PANEL = M5.Display.color565(17, 19, 22);

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
  ir::onSendProgress(irOnSend);
  ir::onRecvProgress(irOnRecv);
  loadShare();
  loadRoot();
  C_BG = M5.Display.color565(7, 10, 16);
  C_ACCENT = isVault ? M5.Display.color565(255, 132, 146) : M5.Display.color565(131, 214, 235);
  C_PANEL = isVault ? M5.Display.color565(43, 22, 30) : M5.Display.color565(19, 37, 56);
  C_CELL = isVault ? M5.Display.color565(82, 44, 53) : M5.Display.color565(41, 67, 90);
  // The wrist advertises all the time; the vault only while its window is open.
  ble::begin(String(isVault ? "Kagi vault-" : "Kagi wrist-") + deviceId.substring(6), !isVault);
#ifndef KAGI_NO_WIFI
  if (!isVault) startWifi();  // the vault keeps its radio off except during the reshare window
#endif
  mode = restingMode();
  lastMotion = millis();
  draw();
  sendHello();
}

void loop() {
  M5.update();

  for (auto& line : ble::poll()) {
    lastSource = 'b';
    if (line.length()) handle(line);
  }

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

#ifndef KAGI_NO_WIFI
  // WiFi scanning and dialing block the loop for seconds, which makes IR acks late.
  // While a root request is out with the vault, leave WiFi alone.
  // With Bluetooth up the phone is right here: skip WiFi entirely (scans and dials stall the UI).
  if ((!isVault || windowOpen()) && !rjob.active && (!ble::connected() || isVault)) pollWifi();
  if (isVault && windowUntil && millis() >= windowUntil) closeWindow();
#endif

  // IR: report whole messages that arrive (the vault protocol builds on this).
  static std::vector<uint8_t> irMsg;
  bool irGot = ir::poll(irMsg);
  // A message that started arriving and then stopped: say so, and go back.
  if (mode == Mode::Beam && !irui.sending && !irGot && irui.lastRecv && millis() - irui.lastRecv > 15000) {
    buzz(2);
    showResult("Lost the other stick", C_RED, 3000, Fx::Shake);
  }
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

#ifdef KAGI_AUTO_APPROVE
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
  if (rjob.active && millis() - rjob.sentAt > 90000) {
    rootStall("vault_timeout");
    buzz(2);
    showResult(rootIsManager ? "No answer: retry on phone" : "Vault timed out", C_MUTED, 3000);
  }
  // A paused request nobody retried within five minutes is dropped.
  if (rjob.held && millis() - rjob.heldSince > 300000) {
    String id = rjob.id;
    rootDrop();
    reject(id, "expired");
  }

  // Buttons.
  if (mode == Mode::ConfirmWifi) {
    if (heldA()) {
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
    if (heldA()) {
      wipeShare();
      mode = Mode::Unpaired;
      showResult("Shard erased", C_MUTED);
      sendHello();
    } else if (M5.BtnB.wasPressed()) {
      mode = restingMode();
      dirty = true;
    }
  } else if (mode == Mode::Pairing && !pairWaitingPhone) {
    if (heldA()) {
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
    if (heldA()) {
      approvePrompt();
    } else if (M5.BtnB.wasPressed()) {
      if (prompt.kind == "vault_sign") vaultReject();
      else {
        reject(prompt.id, "user");
        showResult("Rejected", C_MUTED, 1500, Fx::Shake);
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

  static uint32_t lastFrame = 0;
  if (animating() && millis() - lastFrame > 33) dirty = true;
  if (dirty && !irQuiet) {
    dirty = false;
    lastFrame = millis();
    draw();
  }
  delay(5);
}

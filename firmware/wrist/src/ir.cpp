#include <vector>

#include "ir.h"

#include "driver/rmt_encoder.h"
#include "driver/rmt_rx.h"
#include "driver/rmt_tx.h"
#include "esp_timer.h"

namespace ir {
namespace {

const int PIN_TX = 46;
const int PIN_RX = 42;
// NEC-style timing, which the StickS3 receiver's noise filter lets through reliably:
// 560 us marks, 560 us (0) or 1690 us (1) spaces, and a leader of a mark plus a 4.5 ms gap.
// Long marks get chopped by the receiver, so even the leader mark is short.
// Leader mark is half NEC's 9 ms: long bursts draw a lot from the stick's 5 V rail.
const uint16_t MARK = 560, ZERO = 560, ONE = 1690, LEAD_MARK = 4500, LEAD_SPACE = 4500;
// RX memory holds 192 symbols: 1 leader + 8 per byte + trailer, so 23 bytes per frame.
const size_t MAX_PAYLOAD = 4;  // ~70 ms frames: measured reliable both ways; longer frames fail on this receiver
enum : uint8_t { T_DATA = 0x00, T_ACK = 0x40 };

rmt_channel_handle_t txChan = nullptr, rxChan = nullptr;
rmt_encoder_handle_t copyEnc = nullptr;
rmt_receive_config_t rxCfg = {};
rmt_symbol_word_t rxBuf[192];
volatile size_t rxCount = 0;
volatile bool rxDone = false;
volatile bool txBusy = false;
volatile int64_t rxDoneUs = 0;
int64_t txEndUs = 0;
Stats st{};
std::vector<uint32_t> lastRaw;

std::vector<uint8_t> assembling, done;
bool doneReady = false;
int lastSeqSeen = -1;
volatile int ackSeq = -1;
bool ackEnabled = true;
SendProgress sendCb = nullptr;
RecvProgress recvCb = nullptr;

uint8_t crc8(const uint8_t* d, size_t n) {
  uint8_t c = 0;
  for (size_t i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c & 0x80) ? (c << 1) ^ 0x07 : c << 1;
  }
  return c;
}

bool IRAM_ATTR onRecv(rmt_channel_handle_t, const rmt_rx_done_event_data_t* e, void*) {
  rxDoneUs = esp_timer_get_time();
  rxCount = e->num_symbols;
  rxDone = true;
  return false;
}

void arm() { rmt_receive(rxChan, rxBuf, sizeof(rxBuf), &rxCfg); }

// The receiver is active low: a mark reads as level 0. Work on (mark, space) pairs.
bool decode(const rmt_symbol_word_t* s, size_t n, std::vector<uint8_t>& frame) {
  // (mark, space) pairs. The receiver sometimes drops a very short false mark into the
  // middle of a gap; fold any mark under 170 us, and its space, back into the gap before it.
  std::vector<std::pair<uint16_t, uint32_t>> p;
  p.reserve(n);
  for (size_t i = 0; i < n; i++) {
    uint16_t mark = s[i].duration0;
    uint32_t space = s[i].duration1;
    if (mark < 170 && !p.empty()) {
      p.back().second += mark + space;
      continue;
    }
    // A weak signal can also cut a mark in two with a tiny gap. No real gap is that short
    // (the shortest is 560 us), so join the pieces back into one mark.
    if (!p.empty() && p.back().second < 250) {
      p.back().first += p.back().second + mark;
      p.back().second = space;
      continue;
    }
    p.push_back({mark, space});
  }
  size_t i = 0;
  // Leader: the 4.5 ms gap. Its mark may arrive whole or chopped into pieces.
  while (i < p.size() && !(p[i].second > 3300 && p[i].second < 6500)) i++;
  if (i >= p.size()) return false;
  i++;
  uint8_t cur = 0;
  int bits = 0;
  frame.clear();
  for (; i < p.size(); i++) {
    uint16_t mark = p[i].first;
    uint32_t space = p[i].second;
    if (mark > 1200 || space == 0 || space > 3300) break;  // trailer or idle
    cur = (cur << 1) | (space > 1200 ? 1 : 0);
    if (++bits == 8) {
      frame.push_back(cur);
      bits = 0;
      cur = 0;
    }
  }
  if (frame.size() < 3) return false;
  size_t len = frame[1] & 0x7f;
  if (len > MAX_PAYLOAD || frame.size() < len + 3) return false;
  frame.resize(len + 3);
  return crc8(frame.data(), len + 2) == frame[len + 2];
}

void emit(const uint8_t* f, size_t n) {
  std::vector<rmt_symbol_word_t> sym;
  sym.reserve(n * 8 + 2);
  auto push = [&](uint16_t mark, uint16_t space) {
    rmt_symbol_word_t s;
    s.level0 = 1;
    s.duration0 = mark;
    s.level1 = 0;
    s.duration1 = space;
    sym.push_back(s);
  };
  push(LEAD_MARK, LEAD_SPACE);  // a full NEC leader lets the receiver settle its gain
  for (size_t k = 0; k < n; k++)
    for (int b = 7; b >= 0; b--) push(MARK, (f[k] >> b) & 1 ? ONE : ZERO);
  push(MARK, 0);
  rmt_transmit_config_t tc = {};
  txBusy = true;
  rmt_transmit(txChan, copyEnc, sym.data(), sym.size() * sizeof(rmt_symbol_word_t), &tc);
  rmt_tx_wait_all_done(txChan, 1000);
  txEndUs = esp_timer_get_time();
  txBusy = false;
}

void sendFrame(uint8_t type, uint8_t seq, const uint8_t* p, size_t n, bool last) {
  uint8_t f[MAX_PAYLOAD + 3];
  f[0] = type | (seq & 0x3f);
  f[1] = (last ? 0x80 : 0) | n;
  if (n) memcpy(f + 2, p, n);
  f[n + 2] = crc8(f, n + 2);
  emit(f, n + 3);
}

void handleFrame(const std::vector<uint8_t>& f) {
  uint8_t type = f[0] & 0xc0, seq = f[0] & 0x3f;
  size_t n = f[1] & 0x7f;
  bool last = f[1] & 0x80;
  if (type == T_ACK) {
    ackSeq = seq;
    return;
  }
  if (ackEnabled) {
    delay(10);  // give the sender time to turn around and listen
    sendFrame(T_ACK, seq, nullptr, 0, false);
  }
  if ((int)seq == lastSeqSeen) return;  // our ack was lost and they resent
  if (seq == 0) assembling.clear();
  lastSeqSeen = seq;
  assembling.insert(assembling.end(), f.begin() + 2, f.begin() + 2 + n);
  if (recvCb) recvCb(assembling.size(), false);
  if (last) {
    done = assembling;
    doneReady = true;
    assembling.clear();
    lastSeqSeen = -1;
  }
}

void pump() {
  if (!rxDone) return;
  size_t n = rxCount;
  rxDone = false;
  // Our receiver sits next to our LED and hears everything we send. Anything that
  // finished within 25 ms of our own transmission ending is our echo, not the peer.
  bool ours = txBusy || (rxDoneUs - txEndUs) < 25000;
  std::vector<uint8_t> f;
  bool ok = !ours && decode(rxBuf, n, f);
  lastRaw.clear();
  for (size_t i = 0; i < n; i++) lastRaw.push_back(rxBuf[i].val);
  arm();
  if (ours) return;
  if (ok) {
    st.framesOk++;
    handleFrame(f);
  } else if (n > 4) {
    st.framesBad++;
    if (recvCb) recvCb(assembling.size(), true);
  }
}

}  // namespace

bool begin() {
  rmt_tx_channel_config_t tc = {};
  tc.gpio_num = (gpio_num_t)PIN_TX;
  tc.clk_src = RMT_CLK_SRC_DEFAULT;
  tc.resolution_hz = 1000000;
  tc.mem_block_symbols = 64;
  tc.trans_queue_depth = 4;
  if (rmt_new_tx_channel(&tc, &txChan) != ESP_OK) return false;
  rmt_carrier_config_t cc = {};
  cc.frequency_hz = 38000;
  // 40%: a stronger 38 kHz tone than the 25% this used to run at. A stick with a weaker LED was
  // only just readable at 25% (its marks arrived half length and broken up).
  cc.duty_cycle = 0.40;
  if (rmt_apply_carrier(txChan, &cc) != ESP_OK) return false;
  rmt_copy_encoder_config_t ec = {};
  if (rmt_new_copy_encoder(&ec, &copyEnc) != ESP_OK) return false;
  if (rmt_enable(txChan) != ESP_OK) return false;

  rmt_rx_channel_config_t rc = {};
  rc.gpio_num = (gpio_num_t)PIN_RX;
  rc.clk_src = RMT_CLK_SRC_DEFAULT;
  rc.resolution_hz = 1000000;
  rc.mem_block_symbols = 192;
  if (rmt_new_rx_channel(&rc, &rxChan) != ESP_OK) return false;
  rmt_rx_event_callbacks_t cbs = {};
  cbs.on_recv_done = onRecv;
  rmt_rx_register_event_callbacks(rxChan, &cbs, nullptr);
  if (rmt_enable(rxChan) != ESP_OK) return false;
  rxCfg.signal_range_min_ns = 1000;
  rxCfg.signal_range_max_ns = 7000000;  // 7 ms of silence ends a frame (longer than the leader gap)
  arm();
  return true;
}

bool send(const uint8_t* data, size_t len, uint32_t timeoutMs) {
  uint32_t start = millis();
  size_t off = 0;
  uint8_t seq = 0;
  do {
    size_t n = std::min(MAX_PAYLOAD, len - off);
    bool last = off + n >= len;
    bool acked = false;
    if (sendCb) sendCb(off, len, false);
    // Keep resending this frame until it is acknowledged or the whole send runs out of time:
    // a hand over the window for a few seconds should slow the transfer, not end it.
    for (int attempt = 0; !acked; attempt++) {
      if (attempt) {
        st.retries++;
        if (sendCb) sendCb(off, len, true);
      }
      ackSeq = -1;
      sendFrame(T_DATA, seq, data + off, n, last);
      uint32_t t0 = millis();
      while (millis() - t0 < 320) {
        pump();
        if (ackSeq == seq) {
          acked = true;
          break;
        }
        delay(2);
      }
      if (millis() - start > timeoutMs) return false;
    }
    if (!acked) return false;
    // The receiver re-arms after hearing its own ack; don't start the next frame before that.
    delay(40);
    off += n;
    seq = (seq + 1) & 0x3f;
  } while (off < len);
  if (sendCb) sendCb(len, len, false);
  return true;
}

void onSendProgress(SendProgress fn) { sendCb = fn; }
void onRecvProgress(RecvProgress fn) { recvCb = fn; }

bool poll(std::vector<uint8_t>& out) {
  pump();
  if (!doneReady) return false;
  out = done;
  doneReady = false;
  return true;
}

Stats stats() { return st; }

void setAck(bool on) { ackEnabled = on; }
void resetStats() { st = Stats{}; }

// One-way burst of numbered test frames, no acks, for measuring the raw frame success rate.
void rateTest(int frames, int gapMs) {
  for (int i = 0; i < frames; i++) {
    uint8_t p[4] = {(uint8_t)i, 0xA5, 0x5A, (uint8_t)~i};
    sendFrame(T_DATA, i & 0x3f, p, 4, true);
    delay(gapMs);
  }
}

String dumpRaw() {
  // Every captured symbol as "mark,space" pairs, for offline decoding.
  String o;
  for (size_t i = 0; i < lastRaw.size(); i++) {
    rmt_symbol_word_t s;
    s.val = lastRaw[i];
    o += String(s.duration0) + "," + String(s.duration1) + " ";
  }
  return o;
}

String loopback() { return "n/a on this driver"; }
String pinInfo() { return "gpio42 level " + String(gpio_get_level((gpio_num_t)PIN_RX)); }

void blast(uint32_t ms) {
  uint32_t t0 = millis();
  uint8_t f[3] = {0x3f, 0x00, 0};
  f[2] = crc8(f, 2);
  while (millis() - t0 < ms) {
    emit(f, 3);
    delay(20);
  }
}

}  // namespace ir

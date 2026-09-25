#include <vector>

#include "ir.h"

#include <driver/rmt.h>
#include <freertos/ringbuf.h>

namespace ir {
namespace {

const int PIN_TX = 46;
const int PIN_RX = 42;
const uint16_t LEAD_MARK = 2000, LEAD_SPACE = 1000, MARK = 350, ZERO = 350, ONE = 1050;
const size_t MAX_PAYLOAD = 12;

// Frame: [type|seq] [len] payload... [crc8]
// type: 0 data, 1 ack. seq: 0..63. Last data frame of a message has len bit 7 set.
enum : uint8_t { T_DATA = 0x00, T_ACK = 0x40 };

const rmt_channel_t TX_CH = RMT_CHANNEL_0;  // S3: channels 0-3 transmit, 4-7 receive
const rmt_channel_t RX_CH = RMT_CHANNEL_4;
RingbufHandle_t rxRing = nullptr;
Stats st{};
std::vector<uint32_t> lastRaw;  // last received batch, for debugging timings

uint32_t rxBuf[256];
size_t rxLen = 0;

std::vector<uint8_t> assembling;
std::vector<uint8_t> done;
bool doneReady = false;
int lastSeqSeen = -1;
volatile int ackSeq = -1;

uint8_t crc8(const uint8_t* d, size_t n) {
  uint8_t c = 0;
  for (size_t i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c & 0x80) ? (c << 1) ^ 0x07 : c << 1;
  }
  return c;
}

// Received items are {duration0, level0, duration1, level1}; the receiver is active low,
// so a mark shows as level 0. We only look at durations: mark then space, per bit.
bool decode(std::vector<uint8_t>& frame) {
  std::vector<uint16_t> d;
  for (size_t i = 0; i < rxLen; i++) {
    rmt_item32_t it;
    it.val = rxBuf[i];
    if (it.duration0) d.push_back(it.duration0);
    if (it.duration1) d.push_back(it.duration1);
  }
  // Find the leader.
  size_t i = 0;
  while (i + 1 < d.size() && !(d[i] > 1500 && d[i] < 2600 && d[i + 1] > 700 && d[i + 1] < 1400)) i++;
  if (i + 1 >= d.size()) return false;
  i += 2;
  uint8_t cur = 0;
  int bits = 0;
  frame.clear();
  while (i + 1 < d.size()) {
    uint16_t mark = d[i], space = d[i + 1];
    if (mark < 150 || mark > 700) break;
    int bit;
    if (space > 150 && space < 700) bit = 0;
    else if (space >= 700 && space < 1600) bit = 1;
    else break;
    cur = (cur << 1) | bit;
    if (++bits == 8) {
      frame.push_back(cur);
      bits = 0;
      cur = 0;
    }
    i += 2;
  }
  if (frame.size() < 3) return false;
  size_t n = frame[1] & 0x7f;
  if (frame.size() < n + 3) return false;
  frame.resize(n + 3);
  return crc8(frame.data(), n + 2) == frame[n + 2];
}

void emit(const uint8_t* f, size_t n) {
  std::vector<rmt_item32_t> items;
  items.reserve(n * 8 + 2);
  auto push = [&](uint16_t mark, uint16_t space) {
    rmt_item32_t it;
    it.level0 = 1;
    it.duration0 = mark;
    it.level1 = 0;
    it.duration1 = space;
    items.push_back(it);
  };
  push(LEAD_MARK, LEAD_SPACE);
  for (size_t k = 0; k < n; k++)
    for (int b = 7; b >= 0; b--) push(MARK, (f[k] >> b) & 1 ? ONE : ZERO);
  push(MARK, 0);
  // Don't hear ourselves.
  rmt_rx_stop(RX_CH);
  rmt_write_items(TX_CH, items.data(), items.size(), true);
  delayMicroseconds(800);
  // Throw away anything the receiver caught from our own LED.
  size_t sz;
  void* junk;
  while ((junk = xRingbufferReceive(rxRing, &sz, 0))) vRingbufferReturnItem(rxRing, junk);
  rmt_rx_start(RX_CH, true);
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
  sendFrame(T_ACK, seq, nullptr, 0, false);
  if ((int)seq == lastSeqSeen) return;  // our ack was lost; they resent
  if (seq == 0) assembling.clear();
  lastSeqSeen = seq;
  assembling.insert(assembling.end(), f.begin() + 2, f.begin() + 2 + n);
  if (last) {
    done = assembling;
    doneReady = true;
    assembling.clear();
    lastSeqSeen = -1;
  }
}

void pump() {
  size_t sz = 0;
  auto* items = (rmt_item32_t*)xRingbufferReceive(rxRing, &sz, 0);
  if (!items) return;
  rxLen = std::min(sz / sizeof(rmt_item32_t), sizeof(rxBuf) / sizeof(rxBuf[0]));
  for (size_t i = 0; i < rxLen; i++) rxBuf[i] = items[i].val;
  vRingbufferReturnItem(rxRing, items);
  std::vector<uint8_t> f;
  bool ok = decode(f);
  lastRaw.assign(rxBuf, rxBuf + rxLen);
  if (ok) {
    st.framesOk++;
    handleFrame(f);
  } else {
    st.framesBad++;
  }
}

}  // namespace

bool begin() {
  rmt_config_t t = RMT_DEFAULT_CONFIG_TX((gpio_num_t)PIN_TX, TX_CH);
  t.clk_div = 80;  // 1 us ticks
  t.tx_config.carrier_en = true;
  t.tx_config.carrier_freq_hz = 38000;
  t.tx_config.carrier_duty_percent = 33;
  t.tx_config.carrier_level = RMT_CARRIER_LEVEL_HIGH;
  t.tx_config.idle_output_en = true;
  t.tx_config.idle_level = RMT_IDLE_LEVEL_LOW;
  if (rmt_config(&t) != ESP_OK || rmt_driver_install(TX_CH, 0, 0) != ESP_OK) return false;

  rmt_config_t r = RMT_DEFAULT_CONFIG_RX((gpio_num_t)PIN_RX, RX_CH);
  r.clk_div = 80;
  r.mem_block_num = 4;  // 4 x 48 symbols: a whole frame fits
  r.rx_config.filter_en = true;
  r.rx_config.filter_ticks_thresh = 100;
  r.rx_config.idle_threshold = 3000;  // 3 ms of silence ends a frame
  if (rmt_config(&r) != ESP_OK || rmt_driver_install(RX_CH, 4096, 0) != ESP_OK) return false;
  if (rmt_get_ringbuf_handle(RX_CH, &rxRing) != ESP_OK) return false;
  return rmt_rx_start(RX_CH, true) == ESP_OK;
}

bool send(const uint8_t* data, size_t len, uint32_t timeoutMs) {
  uint32_t start = millis();
  size_t off = 0;
  uint8_t seq = 0;
  do {
    size_t n = std::min(MAX_PAYLOAD, len - off);
    bool last = off + n >= len;
    bool acked = false;
    for (int attempt = 0; attempt < 12 && !acked; attempt++) {
      if (attempt) st.retries++;
      ackSeq = -1;
      sendFrame(T_DATA, seq, data + off, n, last);
      uint32_t t0 = millis();
      while (millis() - t0 < 180) {
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
    off += n;
    seq = (seq + 1) & 0x3f;
  } while (off < len);
  return true;
}

bool poll(std::vector<uint8_t>& out) {
  pump();
  if (!doneReady) return false;
  out = done;
  doneReady = false;
  return true;
}

Stats stats() { return st; }

String loopback() {
  // Transmit with our own receiver listening, to see whether the LED fires at all.
  std::vector<rmt_item32_t> items;
  for (int i = 0; i < 20; i++) {
    rmt_item32_t it;
    it.level0 = 1;
    it.duration0 = 600;
    it.level1 = 0;
    it.duration1 = 600;
    items.push_back(it);
  }
  size_t sz;
  void* junk;
  while ((junk = xRingbufferReceive(rxRing, &sz, 0))) vRingbufferReturnItem(rxRing, junk);
  rmt_write_items(TX_CH, items.data(), items.size(), true);
  delay(20);
  String o;
  auto* got = (rmt_item32_t*)xRingbufferReceive(rxRing, &sz, pdMS_TO_TICKS(50));
  if (!got) return "nothing received";
  for (size_t i = 0; i < sz / sizeof(rmt_item32_t) && i < 30; i++)
    o += String(got[i].level0) + ":" + String(got[i].duration0) + "," + String(got[i].level1) + ":" + String(got[i].duration1) + " ";
  vRingbufferReturnItem(rxRing, got);
  return o;
}

String pinInfo() {
  return "gpio46 level " + String(gpio_get_level((gpio_num_t)PIN_TX)) + ", gpio42 level " + String(gpio_get_level((gpio_num_t)PIN_RX));
}

void blast(uint32_t ms) {
  // A steady stream of leaders, easy to see through a phone camera and to capture.
  uint32_t t0 = millis();
  uint8_t f[3] = {0x3f, 0x00, 0};
  f[2] = crc8(f, 2);
  while (millis() - t0 < ms) {
    emit(f, 3);
    delay(20);
  }
}

String dumpRaw() {
  String o;
  for (size_t i = 0; i < lastRaw.size() && i < 60; i++) {
    rmt_item32_t it;
    it.val = lastRaw[i];
    o += String(it.level0) + ":" + String(it.duration0) + "," + String(it.level1) + ":" + String(it.duration1) + " ";
  }
  return o + " n=" + String(lastRaw.size());
}

}  // namespace ir

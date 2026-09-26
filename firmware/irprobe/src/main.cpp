// ESP32 S3 board IR NEC probe: role TX sends a frame every 500 ms,
// role RX prints the raw symbols it receives.
#include <M5Unified.h>
#include "driver/rmt_rx.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"

// Undo earlier bench experiments: the M5PM1 keeps its own state across ESP resets.
static void restorePmic() {
  auto& pm = M5.Power.M5pm1;
  pm.setLDOOutput(true);
  pm.setGPIOMode(m5::M5PM1_Class::gpio2, m5::M5PM1_Class::input);
  M5.Power.setExtOutput(true, m5::ext_none);
}

#ifdef ROLE_TX
rmt_channel_handle_t tx_chan = NULL;
rmt_encoder_handle_t enc = NULL;
void setup() {
  M5.begin();
  restorePmic();
  Serial.begin(115200);
  rmt_tx_channel_config_t c = {};
  c.gpio_num = (gpio_num_t)46;
  c.clk_src = RMT_CLK_SRC_DEFAULT;
  c.resolution_hz = 1000000;
  c.mem_block_symbols = 64;
  c.trans_queue_depth = 4;
  ESP_ERROR_CHECK(rmt_new_tx_channel(&c, &tx_chan));
  rmt_carrier_config_t cc = {};
  cc.frequency_hz = 38000;
  cc.duty_cycle = 0.33;
  ESP_ERROR_CHECK(rmt_apply_carrier(tx_chan, &cc));
  rmt_copy_encoder_config_t ec = {};
  ESP_ERROR_CHECK(rmt_new_copy_encoder(&ec, &enc));
  ESP_ERROR_CHECK(rmt_enable(tx_chan));
  M5.Power.setExtOutput(true, m5::ext_none);
  M5.Display.setRotation(1);
  M5.Display.drawString("IR probe: TX", 10, 10, 4);
}
void loop() {
  rmt_symbol_word_t s[34];
  int i = 0;
  s[i++] = {9000, 1, 4500, 0};
  uint32_t raw = 0xAA55FF00;
  for (int b = 0; b < 32; b++) s[i++] = {560, 1, (uint16_t)((raw >> b) & 1 ? 1690 : 560), 0};
  s[i++] = {560, 1, 0, 0};
  rmt_transmit_config_t tc = {};
  rmt_transmit(tx_chan, enc, s, i * sizeof(rmt_symbol_word_t), &tc);
  rmt_tx_wait_all_done(tx_chan, 1000);
  Serial.println("sent");
  delay(500);
}
#endif

#ifdef ROLE_RX
rmt_channel_handle_t rx_chan = NULL;
rmt_symbol_word_t buf[128];
volatile bool done = false;
volatile size_t n = 0;
bool IRAM_ATTR cb(rmt_channel_handle_t, const rmt_rx_done_event_data_t* e, void*) {
  n = e->num_symbols;
  done = true;
  return false;
}
rmt_receive_config_t rc = {};
void setup() {
  M5.begin();
  M5.Speaker.end();
  restorePmic();
  Serial.begin(115200);
  rmt_rx_channel_config_t c = {};
  c.gpio_num = (gpio_num_t)42;
  c.clk_src = RMT_CLK_SRC_DEFAULT;
  c.resolution_hz = 1000000;
  c.mem_block_symbols = 128;
  ESP_ERROR_CHECK(rmt_new_rx_channel(&c, &rx_chan));
  rmt_rx_event_callbacks_t cbs = {};
  cbs.on_recv_done = cb;
  ESP_ERROR_CHECK(rmt_rx_register_event_callbacks(rx_chan, &cbs, NULL));
  ESP_ERROR_CHECK(rmt_enable(rx_chan));
  M5.Power.setExtOutput(true, m5::ext_none);
  rc.signal_range_min_ns = 1000;
  rc.signal_range_max_ns = 12000000;
  rmt_receive(rx_chan, buf, sizeof(buf), &rc);
  M5.Display.setRotation(1);
  M5.Display.drawString("IR probe: RX", 10, 10, 4);
}
uint32_t frames = 0;
void loop() {
  if (done) {
    done = false;
    frames++;
    Serial.printf("rx %u symbols:", (unsigned)n);
    for (size_t i = 0; i < n && i < 12; i++) Serial.printf(" %d:%u/%d:%u", buf[i].level0, buf[i].duration0, buf[i].level1, buf[i].duration1);
    Serial.println();
    M5.Display.fillRect(0, 50, 240, 40, TFT_BLACK);
    M5.Display.drawString(String("frames ") + frames + "  syms " + n, 10, 55, 4);
    rmt_receive(rx_chan, buf, sizeof(buf), &rc);
  }
  delay(5);
}
#endif

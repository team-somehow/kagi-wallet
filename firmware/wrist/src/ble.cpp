#include "ble.h"

#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

namespace ble {
namespace {

NimBLEServer* server = nullptr;
NimBLECharacteristic* tx = nullptr;
volatile bool isConnected = false;
bool wantAdvertising = false;
uint16_t mtu = 23;

SemaphoreHandle_t lock = nullptr;
std::string inbox;  // bytes written by the phone, filled from the NimBLE task

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    isConnected = true;
    // Ask for a quick connection interval; messages are small but frequent.
    s->updateConnParams(info.getConnHandle(), 12, 24, 0, 400);
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    isConnected = false;
    mtu = 23;
    if (wantAdvertising) NimBLEDevice::startAdvertising();
  }
  void onMTUChange(uint16_t m, NimBLEConnInfo&) override { mtu = m; }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* c, NimBLEConnInfo&) override {
    const std::string v = c->getValue();
    if (xSemaphoreTake(lock, pdMS_TO_TICKS(50)) == pdTRUE) {
      if (inbox.size() + v.size() < 8192) inbox += v;
      xSemaphoreGive(lock);
    }
  }
};

}  // namespace

void begin(const String& name, bool advertise) {
  lock = xSemaphoreCreateMutex();
  NimBLEDevice::init(name.c_str());
  NimBLEDevice::setMTU(247);
  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());
  NimBLEService* svc = server->createService(SERVICE);
  NimBLECharacteristic* rx = svc->createCharacteristic(RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(new RxCallbacks());
  tx = svc->createCharacteristic(TX, NIMBLE_PROPERTY::NOTIFY);
  svc->start();
  // Flags + a 128-bit service UUID fill most of the 31-byte advertisement, so the name
  // goes in the scan response.
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  NimBLEAdvertisementData ad;
  ad.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  ad.addServiceUUID(NimBLEUUID(SERVICE));
  adv->setAdvertisementData(ad);
  NimBLEAdvertisementData sr;
  sr.setName(name.c_str());
  adv->setScanResponseData(sr);
  adv->enableScanResponse(true);
  setAdvertising(advertise);
}

void setAdvertising(bool on) {
  wantAdvertising = on;
  if (on) {
    if (!isConnected) NimBLEDevice::startAdvertising();
  } else {
    NimBLEDevice::stopAdvertising();
    if (server && isConnected) {
      for (auto h : server->getPeerDevices()) server->disconnect(h);
    }
  }
}

bool connected() { return isConnected; }

bool send(const String& line) {
  if (!isConnected || !tx) return false;
  String l = line;
  if (!l.endsWith("\n")) l += '\n';
  size_t chunk = mtu > 23 ? mtu - 3 : 20;
  for (size_t off = 0; off < l.length(); off += chunk) {
    size_t n = std::min(chunk, (size_t)l.length() - off);
    tx->setValue((const uint8_t*)l.c_str() + off, n);
    if (!tx->notify()) return false;
    if (off + n < l.length()) delay(4);  // let the stack drain between notifications
  }
  return true;
}

std::vector<String> poll() {
  std::vector<String> lines;
  if (!lock || xSemaphoreTake(lock, 0) != pdTRUE) return lines;
  size_t nl;
  while ((nl = inbox.find('\n')) != std::string::npos) {
    lines.emplace_back(inbox.substr(0, nl).c_str());
    inbox.erase(0, nl + 1);
  }
  xSemaphoreGive(lock);
  return lines;
}

}  // namespace ble

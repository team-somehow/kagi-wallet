// Bluetooth LE link to the phone: the main link. WiFi, the relay and USB are fallbacks.
//
// One GATT service with two characteristics:
//   RX  write / write-without-response  phone -> stick
//   TX  notify                          stick -> phone
// Both carry the same newline-terminated JSON lines as every other link, split into chunks
// no bigger than the negotiated MTU allows.
#pragma once
#include <Arduino.h>
#include <vector>

namespace ble {

// UUIDs shared with mobile/src/lib/ble.ts.
constexpr const char* SERVICE = "6b616769-0000-4000-8000-00000000c0de";
constexpr const char* RX = "6b616769-0001-4000-8000-00000000c0de";
constexpr const char* TX = "6b616769-0002-4000-8000-00000000c0de";

void begin(const String& name, bool advertise);
void setAdvertising(bool on);
bool connected();
// Send one line (a trailing newline is added if missing). false if no phone is connected.
bool send(const String& line);
// Whole lines received from the phone since the last call.
std::vector<String> poll();

}  // namespace ble

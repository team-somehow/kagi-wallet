// Infrared link between the wrist and the vault. Presence, not secrecy: everything sent
// here is either public (commitments, partial signatures) or checked by the receiver.
//
// Physical layer: 38 kHz carrier, NEC-style pulse-distance bits, sent with the RMT peripheral.
// Frames carry up to 4 bytes with a sequence number and CRC-8, and are acknowledged.
// Messages are split into frames and reassembled.
#pragma once
#include <Arduino.h>
#include <vector>

namespace ir {

bool begin();
// Blocking send of a whole message, with per-frame acks and retries. false on failure.
bool send(const uint8_t* data, size_t len, uint32_t timeoutMs = 20000);
// Call often. Returns true and fills out when a whole message has arrived.
bool poll(std::vector<uint8_t>& out);
// Progress while sending: bytes acknowledged so far, the total, and whether this call reports
// a frame the other side did not read (it is being sent again).
using SendProgress = void (*)(size_t done, size_t total, bool retry);
void onSendProgress(SendProgress fn);
// Progress while receiving: bytes of the current message so far, or bad = a frame that
// arrived but could not be read.
using RecvProgress = void (*)(size_t bytes, bool bad);
void onRecvProgress(RecvProgress fn);
// Frames seen and dropped, for the status line.
struct Stats {
  uint32_t framesOk, framesBad, retries;
};
Stats stats();
String dumpRaw();
void blast(uint32_t ms);
String loopback();
void setAck(bool on);
void resetStats();
void rateTest(int frames, int gapMs);
String pinInfo();

}  // namespace ir

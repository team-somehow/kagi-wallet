// Infrared link between the wrist and the vault. Presence, not secrecy: everything sent
// here is either public (commitments, partial signatures) or checked by the receiver.
//
// Physical layer: 38 kHz carrier, pulse-distance bits (mark 350 us, space 350 us = 0,
// 1050 us = 1), a 2 ms / 1 ms leader, sent with the RMT peripheral. Roughly 1.3 kbit/s.
// Frames carry up to 12 bytes with a sequence number and CRC-8, and are acknowledged.
// Messages up to 1 KB are split into frames and reassembled.
#pragma once
#include <Arduino.h>
#include <vector>

namespace ir {

bool begin();
// Blocking send of a whole message, with per-frame acks and retries. false on failure.
bool send(const uint8_t* data, size_t len, uint32_t timeoutMs = 20000);
// Call often. Returns true and fills out when a whole message has arrived.
bool poll(std::vector<uint8_t>& out);
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

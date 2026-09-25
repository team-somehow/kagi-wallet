// Wrist half of the Leash two-party Schnorr protocol.
// Must match mobile/src/lib/frost.ts byte for byte. See the comment at the top of that file.
#pragma once
#include <stddef.h>
#include <stdint.h>

namespace frost {

void init();

// SHA-256 of a UTF-8 string, used for the message both sides sign.
void sha256(const uint8_t* data, size_t len, uint8_t out[32]);

// Key generation. Verifies the phone's proof of possession, makes the wrist share,
// and returns the wrist's public share and proof. share and groupKey are parity adjusted.
bool dkg(const uint8_t phoneX[65], const uint8_t phonePopR[65], const uint8_t phonePopS[32],
         uint8_t outX[65], uint8_t outPopR[65], uint8_t outPopS[32],
         uint8_t outShare[32], uint8_t outGroupKey[32]);

// One signing round. Makes fresh nonces, uses them once, wipes them.
bool sign(const uint8_t share[32], const uint8_t groupKey[32], const uint8_t msg[32],
          const uint8_t D1[65], const uint8_t E1[65],
          uint8_t outD2[65], uint8_t outE2[65], uint8_t outZ2[32]);

}  // namespace frost

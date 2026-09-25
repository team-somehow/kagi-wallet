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

// ---- n-party signing, used by the 3-of-3 root key (phone 1, wrist 2, vault 3) ----
// Points are 33-byte compressed here, to keep IR messages short.
//   rho_i = H("LEASH/rhoN" || i || m || D_1 || E_1 || ... || D_n || E_n) mod n
//   R = sum(D_i + rho_i E_i); negate every k_i if R has odd y
//   c = BIP340 challenge(R.x, P.x, m);  z_i = k_i + c x_i
struct Nonce {
  uint8_t d[32], e[32];
};
bool commit(Nonce& n, uint8_t D[33], uint8_t E[33]);
// ids[k] is the participant id of commitment k, sorted ascending. me is our id.
bool respond(const uint8_t share[32], const uint8_t groupKey[32], const uint8_t msg[32], int count,
             const uint8_t* ids, const uint8_t (*D)[33], const uint8_t (*E)[33], int me, Nonce& n,
             uint8_t outZ[32]);
void wipe(Nonce& n);

// ---- keys for the reshare ----
// A fresh keypair: secret 32 bytes, public 33 bytes compressed.
bool keypair(uint8_t priv[32], uint8_t pub[33]);
// share * G, compressed.
bool pubOf(const uint8_t priv[32], uint8_t pub[33]);
// (a - b) mod n and (a + b) mod n, for splitting and joining shares.
void subMod(const uint8_t a[32], const uint8_t b[32], uint8_t out[32]);
void addMod(const uint8_t a[32], const uint8_t b[32], uint8_t out[32]);
void randomScalar32(uint8_t out[32]);

// ECIES to a compressed public key: ephPub(33) || iv(12) || tag(16) || ciphertext.
// key = sha256("LEASH/ecies" || ECDH x), AES-256-GCM, no associated data.
bool seal(const uint8_t pub[33], const uint8_t* msg, size_t len, uint8_t* out, size_t* outLen);
bool open(const uint8_t priv[32], const uint8_t* ct, size_t len, uint8_t* out, size_t* outLen);

// Parse a non-negative decimal string (up to 2^256 - 1) into 32 bytes, big endian.
bool u256FromDecimal(const char* s, uint8_t out[32]);

}  // namespace frost

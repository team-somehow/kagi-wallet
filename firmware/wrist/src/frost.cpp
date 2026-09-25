#include "frost.h"

#include <string.h>

#include <esp_random.h>
#include <mbedtls/bignum.h>
#include <mbedtls/ecp.h>
#include <mbedtls/platform_util.h>
#include <mbedtls/sha256.h>
#include <mbedtls/gcm.h>
#include <mbedtls/version.h>

// mbedTLS 3 hides struct fields behind MBEDTLS_PRIVATE; 2.x has no such macro.
#ifndef MBEDTLS_PRIVATE
#define MBEDTLS_PRIVATE(m) m
#endif
#define PX(p) (p).v.MBEDTLS_PRIVATE(X)
#define PY(p) (p).v.MBEDTLS_PRIVATE(Y)

#if __has_include(<bootloader_random.h>)
#include <bootloader_random.h>
#define LEASH_HAVE_BOOT_RNG 1
#endif

namespace frost {
namespace {

mbedtls_ecp_group grp;
bool ready = false;

int rng(void*, unsigned char* buf, size_t len) {
  esp_fill_random(buf, len);
  return 0;
}

struct Sha {
  mbedtls_sha256_context c;
  Sha() {
    mbedtls_sha256_init(&c);
#if MBEDTLS_VERSION_MAJOR >= 3
    mbedtls_sha256_starts(&c, 0);
#else
    mbedtls_sha256_starts_ret(&c, 0);
#endif
  }
  ~Sha() { mbedtls_sha256_free(&c); }
  void add(const void* p, size_t n) {
#if MBEDTLS_VERSION_MAJOR >= 3
    mbedtls_sha256_update(&c, (const unsigned char*)p, n);
#else
    mbedtls_sha256_update_ret(&c, (const unsigned char*)p, n);
#endif
  }
  void add(const char* s) { add(s, strlen(s)); }
  void done(uint8_t out[32]) {
#if MBEDTLS_VERSION_MAJOR >= 3
    mbedtls_sha256_finish(&c, out);
#else
    mbedtls_sha256_finish_ret(&c, out);
#endif
  }
};

// RAII wrappers keep the error paths short.
struct Mpi {
  mbedtls_mpi v;
  Mpi() { mbedtls_mpi_init(&v); }
  ~Mpi() { mbedtls_mpi_free(&v); }
};
struct Pt {
  mbedtls_ecp_point v;
  Pt() { mbedtls_ecp_point_init(&v); }
  ~Pt() { mbedtls_ecp_point_free(&v); }
};

bool readPoint(Pt& p, const uint8_t b[65]) {
  if (mbedtls_ecp_point_read_binary(&grp, &p.v, b, 65) != 0) return false;
  return mbedtls_ecp_check_pubkey(&grp, &p.v) == 0;
}

void writePoint(const Pt& p, uint8_t out[65]) {
  size_t n = 0;
  mbedtls_ecp_point_write_binary(&grp, &p.v, MBEDTLS_ECP_PF_UNCOMPRESSED, &n, out, 65);
}

void writeScalar(const Mpi& s, uint8_t out[32]) { mbedtls_mpi_write_binary(&s.v, out, 32); }

void xOnly(const Pt& p, uint8_t out[32]) { mbedtls_mpi_write_binary(&PX(p), out, 32); }

bool isOdd(const Pt& p) { return mbedtls_mpi_get_bit(&PY(p), 0) == 1; }

void negate(Pt& p) {
  // y -> p - y. Points here are never at infinity.
  Mpi t;
  mbedtls_mpi_sub_mpi(&t.v, &grp.P, &PY(p));
  mbedtls_mpi_copy(&PY(p), &t.v);
}

void negScalar(Mpi& s) {
  if (mbedtls_mpi_cmp_int(&s.v, 0) == 0) return;
  Mpi t;
  mbedtls_mpi_sub_mpi(&t.v, &grp.N, &s.v);
  mbedtls_mpi_copy(&s.v, &t.v);
}

void modN(Mpi& s) {
  Mpi t;
  mbedtls_mpi_mod_mpi(&t.v, &s.v, &grp.N);
  mbedtls_mpi_copy(&s.v, &t.v);
}

void scalarFromHash(Mpi& s, const uint8_t h[32]) {
  mbedtls_mpi_read_binary(&s.v, h, 32);
  modN(s);
}

void randomScalar(Mpi& s) {
  uint8_t b[32];
  for (;;) {
    esp_fill_random(b, 32);
    mbedtls_mpi_read_binary(&s.v, b, 32);
    if (mbedtls_mpi_cmp_int(&s.v, 0) > 0 && mbedtls_mpi_cmp_mpi(&s.v, &grp.N) < 0) break;
  }
  mbedtls_platform_zeroize(b, sizeof b);
}

// out = k * G, constant time with blinding.
void mulG(Pt& out, const Mpi& k) { mbedtls_ecp_mul(&grp, &out.v, &k.v, &grp.G, rng, nullptr); }

// out = a*A + b*B. Only ever called on public values.
bool mulAdd(Pt& out, const Mpi& a, const Pt& A, const Mpi& b, const Pt& B) {
  return mbedtls_ecp_muladd(&grp, &out.v, &a.v, &A.v, &b.v, &B.v) == 0;
}

bool add(Pt& out, const Pt& A, const Pt& B) {
  Mpi one;
  mbedtls_mpi_lset(&one.v, 1);
  return mulAdd(out, one, A, one, B);
}

void popChallenge(Mpi& c, const uint8_t R[65], const uint8_t X[65]) {
  Sha h;
  h.add("LEASH/pop");
  h.add(R, 65);
  h.add(X, 65);
  uint8_t d[32];
  h.done(d);
  scalarFromHash(c, d);
}

void bip340Challenge(Mpi& c, const uint8_t Rx[32], const uint8_t Px[32], const uint8_t m[32]) {
  uint8_t tag[32];
  {
    Sha t;
    t.add("BIP0340/challenge");
    t.done(tag);
  }
  Sha h;
  h.add(tag, 32);
  h.add(tag, 32);
  h.add(Rx, 32);
  h.add(Px, 32);
  h.add(m, 32);
  uint8_t d[32];
  h.done(d);
  scalarFromHash(c, d);
}

void rho(Mpi& r, uint8_t i, const uint8_t m[32], const uint8_t D1[65], const uint8_t E1[65],
         const uint8_t D2[65], const uint8_t E2[65]) {
  Sha h;
  h.add("LEASH/rho");
  h.add(&i, 1);
  h.add(m, 32);
  h.add(D1, 65);
  h.add(E1, 65);
  h.add(D2, 65);
  h.add(E2, 65);
  uint8_t d[32];
  h.done(d);
  scalarFromHash(r, d);
}

bool popVerify(const uint8_t Xb[65], const uint8_t Rb[65], const uint8_t sb[32]) {
  Pt X, R, lhs, rhs;
  Mpi s, c, one;
  if (!readPoint(X, Xb) || !readPoint(R, Rb)) return false;
  mbedtls_mpi_read_binary(&s.v, sb, 32);
  if (mbedtls_mpi_cmp_int(&s.v, 0) <= 0 || mbedtls_mpi_cmp_mpi(&s.v, &grp.N) >= 0) return false;
  popChallenge(c, Rb, Xb);
  mbedtls_mpi_lset(&one.v, 1);
  mulG(lhs, s);
  if (!mulAdd(rhs, one, R, c, X)) return false;
  return mbedtls_ecp_point_cmp(&lhs.v, &rhs.v) == 0;
}

}  // namespace

void init() {
  if (ready) return;
#ifdef LEASH_HAVE_BOOT_RNG
  // Radio stays off on this firmware, so feed the RNG from the ADC noise source instead.
  bootloader_random_enable();
#endif
  mbedtls_ecp_group_init(&grp);
  ready = mbedtls_ecp_group_load(&grp, MBEDTLS_ECP_DP_SECP256K1) == 0;
}

void sha256(const uint8_t* data, size_t len, uint8_t out[32]) {
  Sha h;
  h.add(data, len);
  h.done(out);
}

bool dkg(const uint8_t phoneX[65], const uint8_t phonePopR[65], const uint8_t phonePopS[32],
         uint8_t outX[65], uint8_t outPopR[65], uint8_t outPopS[32], uint8_t outShare[32],
         uint8_t outGroupKey[32]) {
  if (!ready || !popVerify(phoneX, phonePopR, phonePopS)) return false;
  Mpi x, k, c, s;
  Pt X, R, X1, P;
  randomScalar(x);
  mulG(X, x);
  writePoint(X, outX);
  // Proof of possession for our share.
  randomScalar(k);
  mulG(R, k);
  writePoint(R, outPopR);
  popChallenge(c, outPopR, outX);
  mbedtls_mpi_mul_mpi(&s.v, &c.v, &x.v);
  mbedtls_mpi_add_mpi(&s.v, &s.v, &k.v);
  modN(s);
  writeScalar(s, outPopS);
  // Group key, forced to even y.
  if (!readPoint(X1, phoneX) || !add(P, X1, X)) return false;
  if (isOdd(P)) {
    negScalar(x);
    negate(P);
  }
  writeScalar(x, outShare);
  xOnly(P, outGroupKey);
  mbedtls_mpi_lset(&k.v, 0);
  return true;
}

bool sign(const uint8_t share[32], const uint8_t groupKey[32], const uint8_t msg[32],
          const uint8_t D1b[65], const uint8_t E1b[65], uint8_t outD2[65], uint8_t outE2[65],
          uint8_t outZ2[32]) {
  if (!ready) return false;
  Pt D1, E1, D2, E2, R1, R2, R;
  Mpi d, e, rho1, rho2, k, c, x, z, t, one;
  if (!readPoint(D1, D1b) || !readPoint(E1, E1b)) return false;
  randomScalar(d);
  randomScalar(e);
  mulG(D2, d);
  mulG(E2, e);
  writePoint(D2, outD2);
  writePoint(E2, outE2);

  rho(rho1, 1, msg, D1b, E1b, outD2, outE2);
  rho(rho2, 2, msg, D1b, E1b, outD2, outE2);
  mbedtls_mpi_lset(&one.v, 1);
  if (!mulAdd(R1, one, D1, rho1, E1) || !mulAdd(R2, one, D2, rho2, E2) || !add(R, R1, R2)) return false;

  // k = d + rho2 * e, negated if R has odd y.
  mbedtls_mpi_mul_mpi(&k.v, &rho2.v, &e.v);
  mbedtls_mpi_add_mpi(&k.v, &k.v, &d.v);
  modN(k);
  if (isOdd(R)) negScalar(k);

  uint8_t Rx[32];
  xOnly(R, Rx);
  bip340Challenge(c, Rx, groupKey, msg);

  mbedtls_mpi_read_binary(&x.v, share, 32);
  mbedtls_mpi_mul_mpi(&t.v, &c.v, &x.v);
  mbedtls_mpi_add_mpi(&z.v, &t.v, &k.v);
  modN(z);
  writeScalar(z, outZ2);

  // Nonces are single use. Wipe them before returning.
  mbedtls_mpi_lset(&d.v, 0);
  mbedtls_mpi_lset(&e.v, 0);
  mbedtls_mpi_lset(&k.v, 0);
  mbedtls_mpi_lset(&x.v, 0);
  return true;
}

bool u256FromDecimal(const char* s, uint8_t out[32]) {
  if (!s || !*s) return false;
  for (const char* c = s; *c; c++)
    if (*c < '0' || *c > '9') return false;
  Mpi v;
  if (mbedtls_mpi_read_string(&v.v, 10, s) != 0) return false;
  return mbedtls_mpi_write_binary(&v.v, out, 32) == 0;
}


// ---- compressed points ------------------------------------------------------

namespace {

void writeCompressed(const Pt& p, uint8_t out[33]) {
  out[0] = isOdd(p) ? 0x03 : 0x02;
  mbedtls_mpi_write_binary(&PX(p), out + 1, 32);
}

// y = (x^3 + 7)^((p+1)/4) mod p, then pick the parity the prefix asks for.
bool readCompressed(Pt& p, const uint8_t in[33]) {
  if (in[0] != 0x02 && in[0] != 0x03) return false;
  Mpi x, y, t, e, seven;
  mbedtls_mpi_read_binary(&x.v, in + 1, 32);
  if (mbedtls_mpi_cmp_mpi(&x.v, &grp.P) >= 0) return false;
  mbedtls_mpi_mul_mpi(&t.v, &x.v, &x.v);
  mbedtls_mpi_mod_mpi(&t.v, &t.v, &grp.P);
  mbedtls_mpi_mul_mpi(&t.v, &t.v, &x.v);
  mbedtls_mpi_lset(&seven.v, 7);
  mbedtls_mpi_add_mpi(&t.v, &t.v, &seven.v);
  mbedtls_mpi_mod_mpi(&t.v, &t.v, &grp.P);
  mbedtls_mpi_add_int(&e.v, &grp.P, 1);
  mbedtls_mpi_shift_r(&e.v, 2);
  if (mbedtls_mpi_exp_mod(&y.v, &t.v, &e.v, &grp.P, nullptr) != 0) return false;
  Mpi chk;
  mbedtls_mpi_mul_mpi(&chk.v, &y.v, &y.v);
  mbedtls_mpi_mod_mpi(&chk.v, &chk.v, &grp.P);
  if (mbedtls_mpi_cmp_mpi(&chk.v, &t.v) != 0) return false;  // not on the curve
  if ((int)mbedtls_mpi_get_bit(&y.v, 0) != (in[0] & 1)) mbedtls_mpi_sub_mpi(&y.v, &grp.P, &y.v);
  mbedtls_mpi_copy(&PX(p), &x.v);
  mbedtls_mpi_copy(&PY(p), &y.v);
  mbedtls_mpi_lset(&p.v.MBEDTLS_PRIVATE(Z), 1);
  return mbedtls_ecp_check_pubkey(&grp, &p.v) == 0;
}

void rhoN(Mpi& r, uint8_t i, const uint8_t m[32], int count, const uint8_t (*D)[33], const uint8_t (*E)[33]) {
  Sha h;
  h.add("LEASH/rhoN");
  h.add(&i, 1);
  h.add(m, 32);
  for (int k = 0; k < count; k++) {
    h.add(D[k], 33);
    h.add(E[k], 33);
  }
  uint8_t d[32];
  h.done(d);
  scalarFromHash(r, d);
}

bool gcm(bool enc, const uint8_t key[32], const uint8_t iv[12], const uint8_t* in, size_t len, uint8_t* out,
         uint8_t tag[16]) {
  mbedtls_gcm_context g;
  mbedtls_gcm_init(&g);
  bool ok = mbedtls_gcm_setkey(&g, MBEDTLS_CIPHER_ID_AES, key, 256) == 0;
  if (ok) {
    if (enc) ok = mbedtls_gcm_crypt_and_tag(&g, MBEDTLS_GCM_ENCRYPT, len, iv, 12, nullptr, 0, in, out, 16, tag) == 0;
    else ok = mbedtls_gcm_auth_decrypt(&g, len, iv, 12, nullptr, 0, tag, 16, in, out) == 0;
  }
  mbedtls_gcm_free(&g);
  return ok;
}

void eciesKey(const Pt& shared, uint8_t key[32]) {
  uint8_t x[32];
  mbedtls_mpi_write_binary(&PX(shared), x, 32);
  Sha h;
  h.add("LEASH/ecies");
  h.add(x, 32);
  h.done(key);
  mbedtls_platform_zeroize(x, 32);
}

}  // namespace

bool commit(Nonce& n, uint8_t Dout[33], uint8_t Eout[33]) {
  if (!ready) return false;
  Mpi d, e;
  Pt D, E;
  randomScalar(d);
  randomScalar(e);
  mulG(D, d);
  mulG(E, e);
  writeCompressed(D, Dout);
  writeCompressed(E, Eout);
  mbedtls_mpi_write_binary(&d.v, n.d, 32);
  mbedtls_mpi_write_binary(&e.v, n.e, 32);
  return true;
}

void wipe(Nonce& n) { mbedtls_platform_zeroize(&n, sizeof n); }

bool respond(const uint8_t share[32], const uint8_t groupKey[32], const uint8_t msg[32], int count,
             const uint8_t* ids, const uint8_t (*D)[33], const uint8_t (*E)[33], int me, Nonce& n,
             uint8_t outZ[32]) {
  if (!ready || count < 2) return false;
  Pt R, Ri, Dp, Ep;
  Mpi one, rho, myRho;
  mbedtls_mpi_lset(&one.v, 1);
  bool first = true, found = false;
  for (int k = 0; k < count; k++) {
    if (!readCompressed(Dp, D[k]) || !readCompressed(Ep, E[k])) return false;
    rhoN(rho, ids[k], msg, count, D, E);
    if (!mulAdd(Ri, one, Dp, rho, Ep)) return false;
    if (first) {
      mbedtls_ecp_copy(&R.v, &Ri.v);
      first = false;
    } else {
      Pt sum;
      if (!add(sum, R, Ri)) return false;
      mbedtls_ecp_copy(&R.v, &sum.v);
    }
    if (ids[k] == me) {
      mbedtls_mpi_copy(&myRho.v, &rho.v);
      found = true;
    }
  }
  if (!found) return false;
  Mpi d, e, k, c, x, z, t;
  mbedtls_mpi_read_binary(&d.v, n.d, 32);
  mbedtls_mpi_read_binary(&e.v, n.e, 32);
  mbedtls_mpi_mul_mpi(&k.v, &myRho.v, &e.v);
  mbedtls_mpi_add_mpi(&k.v, &k.v, &d.v);
  modN(k);
  if (isOdd(R)) negScalar(k);
  uint8_t Rx[32];
  xOnly(R, Rx);
  bip340Challenge(c, Rx, groupKey, msg);
  mbedtls_mpi_read_binary(&x.v, share, 32);
  mbedtls_mpi_mul_mpi(&t.v, &c.v, &x.v);
  mbedtls_mpi_add_mpi(&z.v, &t.v, &k.v);
  modN(z);
  writeScalar(z, outZ);
  mbedtls_mpi_lset(&d.v, 0);
  mbedtls_mpi_lset(&e.v, 0);
  mbedtls_mpi_lset(&k.v, 0);
  mbedtls_mpi_lset(&x.v, 0);
  wipe(n);  // single use
  return true;
}

void randomScalar32(uint8_t out[32]) {
  Mpi s;
  randomScalar(s);
  writeScalar(s, out);
}

bool pubOf(const uint8_t priv[32], uint8_t pub[33]) {
  if (!ready) return false;
  Mpi s;
  Pt P;
  mbedtls_mpi_read_binary(&s.v, priv, 32);
  mulG(P, s);
  writeCompressed(P, pub);
  mbedtls_mpi_lset(&s.v, 0);
  return true;
}

bool keypair(uint8_t priv[32], uint8_t pub[33]) {
  randomScalar32(priv);
  return pubOf(priv, pub);
}

void subMod(const uint8_t a[32], const uint8_t b[32], uint8_t out[32]) {
  Mpi x, y, r;
  mbedtls_mpi_read_binary(&x.v, a, 32);
  mbedtls_mpi_read_binary(&y.v, b, 32);
  mbedtls_mpi_sub_mpi(&r.v, &x.v, &y.v);
  modN(r);
  writeScalar(r, out);
}

void addMod(const uint8_t a[32], const uint8_t b[32], uint8_t out[32]) {
  Mpi x, y, r;
  mbedtls_mpi_read_binary(&x.v, a, 32);
  mbedtls_mpi_read_binary(&y.v, b, 32);
  mbedtls_mpi_add_mpi(&r.v, &x.v, &y.v);
  modN(r);
  writeScalar(r, out);
}

bool seal(const uint8_t pub[33], const uint8_t* msg, size_t len, uint8_t* out, size_t* outLen) {
  if (!ready) return false;
  Pt V, S, K;
  Mpi k;
  if (!readCompressed(V, pub)) return false;
  randomScalar(k);
  mulG(K, k);
  if (mbedtls_ecp_mul(&grp, &S.v, &k.v, &V.v, rng, nullptr) != 0) return false;
  uint8_t key[32];
  eciesKey(S, key);
  writeCompressed(K, out);
  esp_fill_random(out + 33, 12);
  bool ok = gcm(true, key, out + 33, msg, len, out + 61, out + 45);
  mbedtls_platform_zeroize(key, 32);
  mbedtls_mpi_lset(&k.v, 0);
  *outLen = 61 + len;
  return ok;
}

bool open(const uint8_t priv[32], const uint8_t* ct, size_t len, uint8_t* out, size_t* outLen) {
  if (!ready || len < 61) return false;
  Pt K, S;
  Mpi d;
  if (!readCompressed(K, ct)) return false;
  mbedtls_mpi_read_binary(&d.v, priv, 32);
  if (mbedtls_ecp_mul(&grp, &S.v, &d.v, &K.v, rng, nullptr) != 0) return false;
  uint8_t key[32], tag[16];
  eciesKey(S, key);
  memcpy(tag, ct + 45, 16);
  bool ok = gcm(false, key, ct + 33, ct + 61, len - 61, out, tag);
  mbedtls_platform_zeroize(key, 32);
  mbedtls_mpi_lset(&d.v, 0);
  *outLen = len - 61;
  return ok;
}

}  // namespace frost

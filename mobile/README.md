# Leash mobile

The phone half of Leash: one shard of the 2-of-2 manager key, the place you issue
capped keys to agents, and the screen that lights up when an agent goes over.

Expo SDK 57, Expo Router, TypeScript. The wrist is real (see `../firmware/wrist`),
reached through the laptop hub (`../hub`). The agent and the chain are still
simulated in `src/store`, driven from the Demo screen.

## Run on a USB-connected Android phone

```bash
# 1. hub. The wrist reaches it over WiFi (see firmware/wrist/README.md) or USB.
cd ../hub && npm install && npm start

# 2. tunnel hub and Metro to the phone over USB
adb reverse tcp:8787 tcp:8787 && adb reverse tcp:8081 tcp:8081

# 3. app, in Expo Go
cd ../mobile && npm install && npx expo start --android --localhost
```

The hub URL defaults to `ws://localhost:8787`. Set `EXPO_PUBLIC_HUB_URL` to point elsewhere.

## What is real

- Phone shard: generated on the phone, stored in the Android Keystore backed
  secure store, unlocked with biometrics before each signature.
- Pairing: both screens show the same code. Press A on the wrist and tap on the phone.
- Key generation: 2-of-2 between phone and wrist with proofs of possession.
- Signing: grants and over-cap transactions are signed by both shards. The wrist
  rebuilds the message from the calldata it displays, signs only on a press of A,
  and the phone checks the wrist's half and the final BIP340 signature.
- Revoke: hold B on the wrist for 2 seconds, or hold the button on Home.

Protocol notes are at the top of `src/lib/frost.ts`. It must match
`firmware/wrist/src/frost.cpp` byte for byte.

## Checks

```bash
npx tsc --noEmit && npx eslint src
npx tsx scripts/frost.test.ts      # both parties in JS, 200 signatures
```

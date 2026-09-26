# Leash mobile

The phone half of Leash: one shard of the 2-of-2 manager key, the place you issue
capped keys to agents, and the screen that lights up when an agent goes over.

Expo SDK 57, Expo Router, TypeScript. The sticks are real (see `../firmware/wrist`) and
reached over Bluetooth LE. The phone talks to Sepolia itself (`src/lib/evm.ts`): no hub,
no relayer. It pays its own fees from a gas wallet kept in the secure store; fund the
address shown on Home with a little Sepolia ETH.

## Run on a USB-connected Android phone

```bash
adb reverse tcp:8081 tcp:8081
npm install && npx expo run:android
```

A release build needs no computer at all: `cd android && ./gradlew :app:assembleRelease`.
Set `EXPO_PUBLIC_SEPOLIA_RPC` to use another RPC.

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

# Leash mobile

The phone half of Leash: one shard of the manager key, the place you issue
capped keys to agents, and the screen that lights up when an agent goes over.

Expo SDK 57, Expo Router, TypeScript. Everything outside the phone (agent, chain,
wrist) is simulated in `src/store` for now.

## Run

```bash
npm install
npx expo start            # then i for iOS simulator, a for Android
```

Start with a wallet already set up, a live key, a pending grant request and an
over-cap request waiting:

```bash
EXPO_PUBLIC_SEED=full npx expo start
```

Fixed ids in seed mode: `seed-key`, `seed-req`, `seed-sign`, so deep links like
`exp://localhost:8081/--/key/seed-key` work.

## Flows

- Onboarding: welcome, lock the phone shard with biometrics, pair the wrist and
  compare fingerprints, DKG with the address shown for comparison.
- Home: how much agents can still spend, segmented bargraph with the 80% mark,
  pending key requests, live keys, hold to revoke everything.
- Key request: cap, lifetime, agent pubkey, then phone biometric plus wrist press.
- Over the cap: amount and destination decoded from calldata, chain rejection,
  phone biometric plus wrist press, then the tx lands. Opens on its own like a push.
- Demo controls (top right on Home): make the agent ask, spend, go over the cap,
  take the wrist off, expire a key, wipe the wallet.

## Layout

```
src/app          routes (expo-router)
src/components   Txt, Screen, Button, HoldButton, LedBar, Steps, ManagerSign, ...
src/store        state, reducer, simulated agent/chain/wrist
src/lib          format, biometrics, haptics
src/theme.ts     colours, fonts, spacing
```

Check before committing:

```bash
npx tsc --noEmit && npx eslint src
```

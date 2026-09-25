# Leash contracts

Foundry project. `LeashAccount` is the agent-facing account (manager, phone and session keys,
ERC-1271, NFT receivers); `RootTreasury` is owned by the 3-of-3 root key. Both verify BIP340
signatures from the FROST keys through `Bip340.sol`.

```sh
forge build
forge test            # unit, fuzz, official BIP340 vectors, real FROST fixtures
forge fmt && forge lint
```

- `test/fixtures/frost.json` holds signatures from the real phone + wrist code. Regenerate it
  with `cd ../hub && npx tsx gen-fixtures.ts` whenever a signed message format changes.
- `cd ../hub && node compile.mjs` runs `forge build` and copies the ABI and bytecode into
  `hub/LeashAccount.json` and `hub/RootTreasury.json`, which is what the hub deploys.
- Storage slots are fixed (`test_StorageLayout`): the hub's simulations write them directly.

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
  with `cd ../mobile && npx tsx ../contracts/scripts/gen-fixtures.mts` whenever a signed message format changes.
- `node scripts/export.mjs` runs `forge build` and writes the ABI and bytecode the apps use:
  `mobile/src/lib/contracts.ts` and `agent-mcp/abi.json`.
- Storage slots are fixed (`test_StorageLayout`), so tools that write them directly keep working.

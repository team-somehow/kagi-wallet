<div align="center">

# 🔑 Kagi Wallet

**A threshold wallet that gives AI agents a spending key, not yours.**

Agents get a capped, expiring key they can spend freely under.
Everything above the cap climbs a ladder of physical devices: your wrist, then a vault you can only reach by light.

![Solidity](https://img.shields.io/badge/Solidity-0.8.30-363636?logo=solidity)
![Foundry](https://img.shields.io/badge/tested_with-Foundry-f26b1d)
![Expo](https://img.shields.io/badge/Expo-SDK_57-000020?logo=expo)
![ESP32](https://img.shields.io/badge/ESP32--S3-PlatformIO-e7352c?logo=espressif)
![Network](https://img.shields.io/badge/network-Sepolia-627eea?logo=ethereum)

</div>

---

## The problem

Agents need money to be useful. Today you either hand them a hot key, and they can drain you, or you approve every transaction, and they're useless. Session keys help, but the root that issues them is still a hot wallet on a server or a phone.

Kagi splits the wallet's authority across devices with **FROST threshold Schnorr (secp256k1)**. No device ever holds a full key, and the smart account enforces the agent's limits on-chain.

## How it works

```mermaid
flowchart LR
    subgraph You
        P["📱 Phone<br/>biometric-gated shard"]
        W["⌚ Wrist ESP32 device<br/>press A to co-sign"]
        V["🏠 Vault ESP32 device<br/>IR only"]
    end
    A["🤖 Agent<br/>ephemeral key"]

    P <-- "Bluetooth LE" --> W
    W <-. "infrared" .-> V

    A -- "spend ≤ cap<br/>(ECDSA)<br/>ask for more" --> LA
    P & W -- "manager key 2-of-2<br/>grant · execute" --> LA
    P -- "phone shard alone<br/>revoke · decline" --> LA
    P & W & V -- "root key 3-of-3" --> RT

    LA[["KagiAccount"]]
    RT[["RootTreasury"]]
```

### The spending ladder

| Action | Who signs | Human in the loop |
|---|---|---|
| Spend under the cap | the agent's ephemeral key | none |
| Grant a key, spend over the cap | phone + wrist ESP32 device (manager key) | face on the phone, press A on the wrist |
| Treasury moves, anything beyond the manager's reach | phone + wrist + vault ESP32 device (root key) | walk to the vault, point the wrist at it |
| Revoke an agent key | the phone's shard alone, or the manager key | one tap, or hold B on the wrist for 2 s |

### Keys

| Key | Type | Held by | Can do |
|---|---|---|---|
| **Manager** | FROST 2-of-2 | phone + wrist ESP32 device | anything on `KagiAccount`: grant, execute, sign ERC-1271 |
| **Root** | FROST 3-of-3 (reshared from 2-of-2) | phone + wrist + vault ESP32 device | anything on `RootTreasury` |
| **Phone** | the phone's shard on its own | phone | revoke only |
| **Session** | ECDSA, made by the agent | the agent, never leaves it | plain ETH transfers under its cap until it expires |

One FROST key has one threshold, and its signature doesn't say who signed. That's why each role gets its own key.

## Repository

```
contracts/   Solidity + Foundry. KagiAccount, RootTreasury, BIP340 verifier, forge tests
firmware/    ESP32-S3 firmware (PlatformIO). One build runs as wrist or vault
  wrist/       the shard firmware: FROST, display, buttons, BLE, WiFi, IR
  irprobe/     bench tool for the IR link
mobile/      Expo / React Native app. The phone shard, the control surface, and its own Sepolia client
agent-mcp/   Node. A bare-bones MCP server that gives ChatGPT or Claude an agent wallet
site/        the landing page
IDEA.md      the full design, threat model and demo script
```

## Smart contracts

`contracts/src` has two accounts that share one base. Both verify BIP340 signatures with the ecrecover trick, so threshold Schnorr works on Ethereum with no new precompile.

| Function | Signer | What it does |
|---|---|---|
| `execute(to, value, data, rx, s)` | manager | any call: tokens, approvals, swaps, contracts |
| `grant(agent, cap, expiry, rx, s)` | manager | registers an agent key with a cap and an expiry |
| `revoke(agent, rx, s)` | phone or manager | kills an agent key immediately |
| `raiseLimit(agent, oldCap, newCap, expiry, rx, s)` | manager | raises a key's total allowance, keeping what it spent and its expiry |
| `requestLimit(newCap, reason)` | the agent itself | asks the owner for a higher total; the phone sees the event |
| `declineLimit(agent, newCap, rx, s)` | phone or manager | answers no, so the agent stops waiting |
| `spend(agent, to, value, v, r, s)` | agent | plain ETH only, within the cap, before the expiry, never to the account itself |
| `isValidSignature(hash, sig)` | manager | ERC-1271 |

**Standards supported**

- **ERC-1271:** passes only for the manager key, over `sha256("KAGI/1271" ‖ chainid ‖ account ‖ hash)`. This enables SIWE, Permit2, and CoW, UniswapX or Seaport orders. Agent keys are excluded on purpose: a signed permit moves money without going through `spend`, so it would get around the cap.
- **ERC-721 / ERC-1155 receivers:** `safeTransferFrom` and `safeMint` into the account succeed.
- **ERC-165:** advertises all of the above.
- **Not ERC-4337 (yet):** there is no relayer. The phone pays for its own transactions from a gas wallet, and an agent pays for its own from its session key, which the phone tops up when it grants it.

**Gas** (Sepolia `eth_call` estimates)

| Call | Gas |
|---|---|
| deploy `KagiAccount` | ~951k |
| `grant` | ~106k |
| `spend`, first / later | ~90k / ~55k |
| `execute` (ETH transfer) | ~54k |
| `revoke` | ~46k |

## Getting started

### Prerequisites

[Foundry](https://getfoundry.sh) · Node 20+ · [PlatformIO](https://platformio.org) (Python ≥ 3.10) · an Android phone with Expo Go · two ESP32-S3 devices with a screen, buttons and an IR transmitter + receiver

```bash
git clone --recurse-submodules <repo>
# already cloned?
git submodule update --init
```

### 1. Contracts

```bash
cd contracts
forge build
forge test
```

### 2. Agent MCP (optional)

```bash
cd agent-mcp
npm install
npm test                # anvil end to end: spend, ask for more, approve, decline
```

See [`agent-mcp/README.md`](agent-mcp/README.md) to connect ChatGPT or Claude.

### 3. Firmware

```bash
cd firmware/wrist
cp src/secrets.example.h src/secrets.h   # optional WiFi settings; the phone link is Bluetooth
pio run -e sticks3 -t upload
pio device monitor
```

Flash the same build to both ESP32 devices, then give the second one the vault role (`set_role`, stored in NVS). See [`firmware/wrist/README.md`](firmware/wrist/README.md) for WiFi quirks and first-flash steps.

### 4. Phone

```bash
adb reverse tcp:8081 tcp:8081
cd mobile
npm install
npx expo run:android
```

The phone talks to the ESP32 devices over **Bluetooth LE** and to Sepolia directly. It keeps a gas wallet in its secure store: fund its address, shown on Home, with a little Sepolia ETH.

## Tests

| Command | What it covers |
|---|---|
| `cd contracts && forge test` | 61 tests: unit and fuzz tests for every path, the official BIP340 vectors, real FROST signatures from the phone code |
| `cd mobile && npx tsx ../contracts/scripts/gen-fixtures.mts` | regenerates the FROST fixture after any change to a signed-message format |
| `cd mobile && npx tsx scripts/frost.test.ts` | both FROST parties in JS, 200 signatures |
| `cd agent-mcp && npm test` | on anvil: the phone's message builders, the contract and the MCP server, through a spend, a limit raise and a decline |

The phone's `src/lib/frost.ts` and the firmware's `src/frost.cpp` must match byte for byte. The fixture test is what catches it when they drift.

## Threat model, in short

| If an attacker gets… | They get |
|---|---|
| an agent's ephemeral key | at most the cap, for at most 24 h |
| the phone, or the server and its credentials | one shard: they can't grant or raise limits. They can revoke, which is only a nuisance |
| the wrist ESP32 device | nothing without the phone, and it stops signing after 2 minutes without motion |
| phone **and** wrist | the manager key. Everything behind the root key still needs the vault |
| any remote access at all | still no path to the vault: it has no network after the reshare |

## Status

This is a hackathon build. What isn't done yet:

- **Development firmware:** no secure boot, no flash encryption, reflashable. The production plan (eFuses burned, JTAG and USB download off, no OTA on the vault) is in [IDEA.md](IDEA.md).
- **Agent spends are plain ETH only.** A cap in USDC and a validator that measures balance changes are designed but not built.
- **The wrist has no ERC-1271 signing path yet.** It would need to decode EIP-712 (Permit2 first) so it never signs blind.
- **FROST runs in RAM.** Secure storage protects shards at rest, but each shard is in memory for a few hundred ms per signature.

See **[IDEA.md](IDEA.md)** for the full design, the threat model and the two-act demo.

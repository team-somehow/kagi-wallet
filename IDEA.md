# Kagi Wallet

## One-liner
An MPC wallet where the AI agent gets a capped, expiring key it can spend freely under, and everything above the cap climbs a ladder of physical devices: wrist, then a vault that can only be reached by light.

## The problem
Agents need money to be useful. Today you either hand them a hot key (they can drain you) or approve every tx (they're useless). Session keys help but the root that issues them is still a hot wallet on a server or a phone.

## Architecture
- Root wallet: MPC (FROST, secp256k1), no full key anywhere. Owns a smart account: a plain Solidity contract that verifies BIP340 with the ecrecover trick, submitted by our relayer. Speaks ERC-1271, ERC-721/1155 receiver and ERC-165. Not 4337 yet
- Shard 1: Android app, Android Keystore / StrongBox, biometric gated
- Shard 2: M5StickS3 on the wrist. Secure boot v2, flash encryption, eFuses burned, JTAG and USB download off. WiFi to phone and agent
- Shard 3: second M5StickS3, the vault. Lives at home. IR only after a one-time reshare
- Agent: holds an ephemeral key it generated itself. Private key never leaves the agent

## Two MPC keys, two thresholds
- Manager key: 2-of-2, phone + wrist. Approves over-cap txs, renews grants, raises caps by up to X
- Root key: starts 2-of-2, reshared to 3-of-3 with the vault. Raises caps beyond X, changes owners, upgrades the account
One FROST key has one threshold and a signature doesn't say who signed, so roles need separate keys.

## Ephemeral key lifecycle
- Agent generates keypair, sends pubkey plus requested cap and duration
- Manager key signs an EIP-712 grant. Smart account registers the key with a validator
- Agent spends with no human in the loop until the cap or the clock runs out
- Key expires at 24h. New key, new grant
- Renew at same cap: manager. Raise by ≤ X: manager. Raise by > X: root. Revoke: any single shard, instantly

## What the validator enforces
- Cap in USDC, not USD. No price oracle in the security boundary
- Rolling 24h window
- Outflow, not actions. Balance delta before and after, agent can call anything
- Approvals count as spend
- Gas counts against cap, or paymaster with its own cap
- No self-calls: can't add owners, swap validators, upgrade

## Standards the account speaks
- ERC-1271: `isValidSignature` says yes only for the manager key, over sha256("KAGI/1271" || chainid || account || hash). Unlocks SIWE, Permit2, CoW / UniswapX / Seaport orders, Snapshot
- Why manager only: a Permit2 or order signature moves money without going through `spend`, so an agent key that could sign one would walk around the cap
- Chainid and account are in the signed message, so a signature can't be replayed on another account or chain that shares the group key. No nonce: replay protection is the verifying app's job, same as an EOA
- ERC-721 / ERC-1155 receiver hooks: `safeTransferFrom` and `safeMint` into the account work. Only the manager's `execute` can move NFTs out
- ERC-165 `supportsInterface`: advertises itself, both receivers, and 1271
- Not 4337: no EntryPoint, no bundlers or paymasters, our relayer pays gas. Contracts aren't upgradeable, so adding 4337 later means a new address

## Channels and what each one is for
- Agent ↔ wrist ↔ phone: WiFi. Wrist never listens, outbound only to a pinned endpoint over Noise. Treat the network as hostile
- Vault reshare: WiFi, one 2-minute window opened by holding both buttons, encrypted to the vault's device key, fingerprint compared on screens, radio dies after, no OTA ever
- Vault signing: IR, MAC'd, every message authenticated. IR gives presence, not secrecy. Partial sigs are public anyway
- Optional: reshare finalizes only after a signed ok over IR

## Wrist behavior
- Silent under cap
- Over cap: buzz, show amount and destination rendered from raw calldata, press A to co-sign
- Live readout of total exposure across all live keys, buzz at 80%
- Long press: revoke everything
- Wearer detection via IMU: off the arm, shard sleeps

## Threat model
- Ephemeral key stolen: attacker gets ≤ cap for ≤ 24h. That's the whole blast radius
- Agent rogue: same bound, one shard revokes
- Server or phone compromised: one shard, can't mint or raise alone. Can revoke, which is a nuisance
- Wrist stolen: dead without the phone, deader with wearer detection
- Phone + wrist stolen together: manager key falls. Vault holds everything above X. The cap on the manager key is what makes a mugging survivable
- Any remote attacker: vault is unreachable. No packet gets there
- Firmware: signed only, OTA off on the vault. If the network can push firmware, the story collapses
- Signed messages (1271): the wrist signs an opaque hash, not calldata it can render. It must decode the common EIP-712 types (Permit2, Seaport, CoW) and show them, and refuse or loudly flag anything it can't. Until then the wrist has no 1271 signing path at all
- Honest caveat: secure storage on both Android and S3 protects shards at rest and guarantees firmware integrity. FROST math runs in RAM, so the shard is in memory for a few hundred ms per signature. Say it before they ask

## Demo, two acts
Act 1
- DKG on stage, address appears on both screens
- Agent gets a $500 key, runs a few txs, wrist stays quiet
- Agent tries $600, on-chain reject, escalates, wrist buzzes, press A, tx lands
- Hand judge the phone and the server creds, ask them to drain it. They get $500

Act 2
- Vault wakes, 2-minute WiFi window, reshare, radio turns itself off
- Root is now 3-of-3, same address
- Agent asks for a cap beyond X, wrist says "needs vault," walk over, point, IR round, done
- Closing line: two of the three shards are online and it still doesn't matter

## Extensions if you have time
- Sub-keys: an ephemeral key can grant smaller keys to worker agents, caps nest under the parent
- Proactive refresh: same reshare protocol, old shards go dead, run it every time you're in IR range
- Duress: press B on the vault, decoy signature for a dummy account, real one freezes
- Time-lock on the vault for anything over Y

## Build risks
- IR receiver: the stick family ships TX only. Confirm the S3 or add a Grove IR unit
- FROST on ESP32-S3 is fine. Threshold ECDSA is not. Schnorr verifier in the smart account via the ecrecover trick
- Wrist-side EIP-712 decoding for 1271 signatures: Permit2 first, since that's what approve-then-swap needs
- Balance-delta validator across arbitrary calls is the hairy contract. Prototype with USDC and ETH only
- Nonce commitments in RTC memory with a counter, never reuse

Want this in a doc you can keep editing?
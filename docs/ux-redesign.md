# Leash UX direction — first demo

Design draft, 26 September 2026. This describes the proposed experience; it does
not claim the new handoff, chat, or limit-update flow is implemented.

## Agreed scope

- One owner uses the phone and makes decisions on the approval stick.
- Start with one phone and one M5StickS3. Introduce the second stick at the end.
- Create a wallet and a temporary session key from the phone.
- Copy the actual session private key and paste it into a small web chat.
- The chat connects to an MCP and performs simple ETH transfers on Sepolia.
- The agent runs its requested sequence automatically. A transfer above its
  remaining allowance pauses and requests a higher spending limit.
- The stick beeps and presents the decision. After approval and on-chain
  confirmation, the agent automatically retries the same transfer.
- IR is a closing extension, outside the initial onboarding flow.

M5StickS3 / ESP32 are the hardware names found in this repository; interpreted
from the initial spoken hardware names.

## Primary journey

1. **Create wallet.** Find the stick, compare pairing codes, hold A on the stick,
   and protect the phone share with its existing biometric flow. Create the
   Sepolia account as part of this journey; show pending, success, and recovery
   states instead of requiring a separate chain screen.
2. **Create session key.** Name the agent, set its total ETH allowance and expiry,
   then approve the grant on the stick. Show that access is pending until the
   grant is confirmed on-chain.
3. **Connect the agent.** The phone exposes a copy action for this session key.
   The web chat accepts the pasted key, identifies its wallet/session, verifies
   that the grant is active, and shows the allowance, expiry, and network.
4. **Give one instruction.** For the demo: “Send 0.000002 ETH to ABC, then send
   0.000008 ETH to ABC.” ABC must resolve to a configured, visible recipient
   address; an unknown name needs clarification before any transfer.
5. **First transfer.** With a 0.000005 ETH allowance, the first transfer completes
   without owner involvement. Both phone and chat show the confirmed result.
   The stick stays quiet. The balance remaining is 0.000003 ETH.
6. **Request more access.** The second transfer cannot fit. Phone and chat show
   “Waiting for approval” and the stick beeps. The proposed demo request raises
   the total allowance to 0.000020 ETH. This is extra future access, and the UI
   must make that broader effect explicit.
7. **Decide on the stick.** Show agent/session identity, old and new total limit,
   and expiry. A approves; B declines. Phone biometrics unlock the phone's
   signing share; the authorization decision remains on the stick.
8. **Resume.** Confirm the new allowance on-chain before retrying the same
   0.000008 ETH transfer. Preserve the first 0.000002 ETH spent and the existing
   expiry. After both transfers, 0.000010 ETH remains from the 0.000020 ETH cap.
9. **Extend.** Open Devices and introduce another signer. Show the second-stick
   setup and an IR signature as a distinct closing act.

Amounts are suggested small testnet values, not USD conversions. The interactive
design draft simulates this journey; the implemented demo must use actual chain
receipts and explorer links.

## Screen priorities

- **Phone:** wallet setup, agent access, remaining allowance, activity, and one
  incoming approval view. Keep device details under Devices. Session details
  retain revoke and expiry controls. Move operational demo/debug controls out
  of the main experience.
- **Web:** session-key connection followed by one chat. Keep the connected
  wallet, Sepolia network, allowance, and expiry easy to inspect. Each transfer
  shows its recipient, amount, pending status, and confirmed transaction link.
  A limit request has a waiting state, not another approve button.
- **Stick:** quiet allowance readout during ordinary spending; a readable,
  explicit decision when access changes. The new cap is a total session cap,
  not a per-transfer amount. Rejection leaves the original access intact.

The initial visual direction keeps Leash's amber approval cue, restrained
surfaces, and monospaced amounts, with shorter copy and clearer primary actions.

## Hardware reference and motion

Use the owner's reference photo for the device silhouette: a dark charcoal
landscape case, LCD on the left, and a narrow blue front button on the right.
Do not use the earlier orange portrait mockup or invent two front buttons.

The [official StickS3 documentation](https://docs.m5stack.com/ja/core/StickS3)
specifies a 135×240 LCD (240×135 in this orientation), a 48×24×15 mm body, and
two programmable button inputs. Keep the amount, action, and expiry readable
inside that display. The prototype renders the alternate decline control
outside the front view, rather than claiming a physical position for it.

Motion should mark an event and settle:

- Pairing: two lights move together; the matching code stays still.
- Approval: a ring fills during the deliberate button hold, without moving the
  amount or expiry. A click in the concept previews that hold.
- Directional chevrons move toward the blue front button when it can approve.
  A separate arrow connects the old and new limit. The review → stick → chain
  progress indicator makes the waiting stages visible.
- Transfer: a small token travels from the agent to the wallet illustration.
- Limit reached: two brief amber pulses around the device echo its beep.
- Success: a spring motion on the status mark and a small, short particle burst.
  Keep signature approval, chain confirmation, and transfer completion distinct.
- Rejection: a calm return to the unchanged allowance, without celebration.

The concept supports playful, gentle, and off motion styles, and respects the
operating system's reduced-motion setting. No decoration loops indefinitely.

The prototype's “Preview limit increase” control jumps directly into the request
and arms its sounds through a user interaction. Sounds are generated locally:
a soft double buzz for a request, a quiet rising hold tone, a short signature
acknowledgement, and a three-note chime only after confirmation. Declining uses
a short descending cue. Transfers within the cap stay silent. A visible sound
toggle immediately mutes playback, and hidden previews stop sounding.

The browser sound treatment is a prototype, not flashed device firmware. Port
and tune it on the StickS3 speaker when implementing the hardware experience.

For the later IR act, the official docs require the speaker amplifier to be off
during IR reception and recommend facing devices at least 30 cm apart. Finish
the audible cue before entering the IR receive phase; reserve motion for a
line-of-sight prompt and progress feedback while the radio path is unavailable.

## Behavior that must survive the redesign

- A rejected or timed-out request sends no paused transfer and retains the old
  limit. An expired or revoked key cannot resume spending.
- A disconnected stick remains a recoverable waiting/error state. Reconnecting
  must not duplicate a request or transfer.
- “Approved,” “submitted,” and “confirmed” are different states. Do not call a
  transfer complete until its receipt succeeds. If submission status is
  unknown, reconcile that transaction before retrying.
- Only a confirmed allowance failure creates a limit request. RPC failures,
  insufficient wallet funds, and key expiry need their own recovery messages.
- The private session key belongs in the connection control, never the chat
  transcript, model prompt, analytics, URL, or logs. The copied key grants only
  its on-chain session allowance; it is not a phone or manager signing share.
- Session discovery needs an explicit mechanism: a raw private key alone does
  not encode the Leash smart-account address. A local registry or companion
  public connection metadata can resolve it without changing the paste-key UX.

## Findings in the current build

- `mobile/src/app/home.tsx`, `issue.tsx`, and `sign/[id].tsx` use the simulated
  dollar-denominated store. Real Sepolia actions are isolated in `chain.tsx`.
- `hub/agent.mjs` currently generates and retains session keys in the hub.
  Phone generation/export and web import are new work for this design.
- `contracts/src/LeashAccount.sol::grant` resets `spent` when re-granting the same
  key. A total-limit increase needs an explicit signed update that preserves
  spent amount and expiry. Reusing grant with a “raise limit” label would give
  the agent more access than the proposed screen communicates.
- The current over-cap flow signs a one-off manager transaction. This does not
  raise the agent's ongoing allowance.
- The current contract counts total spending for the session lifetime, not a
  rolling daily allowance. It supports plain ETH transfers, not token swaps.
- The phone currently routes some incoming non-chain events differently when
  BLE is active. New chat/MCP events must reach the phone on either transport.
- `vault.tsx` already separates adding a signer through resharing from signing
  through IR. “Refresh,” “add a signer,” and “sign” must remain distinct claims.
  General ESP32 compatibility requires the device to implement the signing and
  transport protocol; it is not automatic support for every ESP32 device.

## Still open

- Build a Leash MCP around the hub, or use a supplied existing MCP endpoint?
- Keep the first chat to deterministic transfer commands, or use an LLM provider?
- Before implementing the closing act: does “IR key refresh” mean adding the
  third signer, refreshing existing shares, or demonstrating an IR signature?

The first two questions have been sent to the owner. The IR distinction can wait
until the phone + chat + first stick experience is settled.

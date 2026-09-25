export type TxKind = 'transfer' | 'swap' | 'approve' | 'call';
export type TxStatus = 'landed' | 'rejected' | 'co-signed';

export interface Tx {
  id: string;
  keyId: string;
  at: number;
  amountUsdc: number;
  to: string;
  toLabel: string;
  kind: TxKind;
  status: TxStatus;
}

export type KeyStatus = 'live' | 'expired' | 'revoked';

export interface AgentKey {
  id: string;
  agent: string;
  pubkey: string;
  capUsdc: number;
  spentUsdc: number;
  issuedAt: number;
  expiresAt: number;
  status: KeyStatus;
  txs: Tx[];
}

export interface GrantRequest {
  id: string;
  agent: string;
  pubkey: string;
  capUsdc: number;
  durationH: number;
  at: number;
  status: 'pending' | 'approved' | 'denied';
}

export type SignStatus = 'pending' | 'phone-signed' | 'signed' | 'landed' | 'rejected';

export interface SignRequest {
  id: string;
  keyId: string;
  agent: string;
  amountUsdc: number;
  /** Where the money ends up. */
  to: string;
  toLabel: string;
  /** The contract the transaction calls (USDC). */
  contract: string;
  kind: TxKind;
  calldata: string;
  decoded: string;
  at: number;
  status: SignStatus;
}

export interface Wrist {
  id: string | null;
  /** The laptop hub is reachable. */
  hub: boolean;
  /** The wrist is on the hub's USB port and talking. */
  connected: boolean;
  onArm: boolean;
  battery: number;
  paired: boolean;
  /** Group key the wrist holds a share of, if any. */
  groupKey: string | null;
  /** How the wrist reaches the hub right now. */
  via: 'ble' | 'relay' | 'wifi' | 'usb' | null;
  /** WiFi network the wrist is on, if any. */
  ssid: string | null;
}

export interface State {
  hydrated: boolean;
  onboarded: boolean;
  /** x-only group key of the manager key, hex. */
  address: string | null;
  wrist: Wrist;
  /** Manager key can raise caps by up to this much. Beyond it, the vault. */
  managerRaiseLimit: number;
  keys: AgentKey[];
  requests: GrantRequest[];
  signs: SignRequest[];
  autopilot: boolean;
}

export type Action =
  | { type: 'HYDRATED'; address: string | null }
  | { type: 'ONBOARDED'; address: string }
  | { type: 'RESET' }
  | { type: 'WRIST'; patch: Partial<Wrist> }
  | { type: 'SPEND'; tx: Tx }
  | { type: 'GRANT_REQUEST'; req: GrantRequest }
  | { type: 'GRANT_DECIDE'; id: string; status: 'approved' | 'denied'; key?: AgentKey }
  | { type: 'ISSUE_KEY'; key: AgentKey }
  | { type: 'SIGN_REQUEST'; req: SignRequest }
  | { type: 'SIGN_UPDATE'; id: string; status: SignStatus }
  | { type: 'REVOKE_KEY'; id: string }
  | { type: 'REVOKE_ALL' }
  | { type: 'EXPIRE_SOONEST' }
  | { type: 'AUTOPILOT'; on: boolean }
  | { type: 'TICK'; now: number };

// Every figure on the site, with the source it came from. Checked 26 September 2026.

export type Loss = {
  name: string;
  when: string;
  usd: number; // bar position (midpoint when the source gives a range)
  label: string;
  kind: 'agent' | 'blind';
  what: string;
  source: string;
  outlet: string;
};

export const losses: Loss[] = [
  {
    name: 'Bybit',
    when: 'Feb 2025',
    usd: 1.5e9,
    label: '$1.5B',
    kind: 'blind',
    what: 'Hacked signing page swapped the transaction',
    source: 'https://www.bleepingcomputer.com/news/security/lazarus-hacked-bybit-via-breached-safe-wallet-developer-machine/',
    outlet: 'BleepingComputer',
  },
  {
    name: 'WazirX',
    when: 'Jul 2024',
    usd: 230e6,
    label: '$230M',
    kind: 'blind',
    what: 'Routine-looking signature upgraded the multisig',
    source: 'https://www.coindesk.com/business/2024/07/19/wazirx-liminal-custody-blame-each-other-as-230m-crypto-exploit-leaves-customers-stranded',
    outlet: 'CoinDesk',
  },
  {
    name: 'Radiant Capital',
    when: 'Oct 2024',
    usd: 50e6,
    label: '$50M',
    kind: 'blind',
    what: 'Hardware wallets signed what the screen hid',
    source: 'https://www.coindesk.com/tech/2024/12/09/radiant-capital-says-north-korean-hackers-behind-50-million-attack-in-october',
    outlet: 'CoinDesk',
  },
  {
    name: 'Malicious LLM routers',
    when: 'Apr 2026',
    usd: 500e3,
    label: '$500K',
    kind: 'agent',
    what: 'Router stole an agent key it relayed (as reported)',
    source: 'https://www.coindesk.com/tech/2026/04/13/ai-agents-are-set-to-power-crypto-payments-but-a-hidden-flaw-could-expose-wallets',
    outlet: 'CoinDesk',
  },
  {
    name: 'Grok × Bankrbot',
    when: 'May 2026',
    usd: 175e3,
    label: '$155–200K',
    kind: 'agent',
    what: 'An NFT raised the limit, Morse code did the rest',
    source: 'https://cryptoslate.com/how-one-trader-exploited-grok-and-morse-code-to-trick-ai-agent-into-sending-billions-of-crypto-tokens-from-a-verified-wallet/',
    outlet: 'CryptoSlate',
  },
  {
    name: 'aixbt',
    when: 'Mar 2025',
    usd: 106e3,
    label: '$106K',
    kind: 'agent',
    what: 'Hacked dashboard queued prompts to a hot wallet',
    source: 'https://cointelegraph.com/news/hacker-breaches-ai-crypto-bot-aixbt-steals-55-eth',
    outlet: 'Cointelegraph',
  },
  {
    name: 'Freysa',
    when: 'Nov 2024',
    usd: 47e3,
    label: '$47K',
    kind: 'agent',
    what: 'Talked into sending its whole prize pool',
    source: 'https://cointelegraph.com/news/crypto-user-convinced-ai-bot-transfer-47k',
    outlet: 'Cointelegraph',
  },
];

export const keyStats = [
  {
    pct: 43.8,
    what: 'of stolen crypto in 2024 came from compromised private keys',
    who: 'Chainalysis',
    source: 'https://www.chainalysis.com/blog/crypto-hacking-stolen-funds-2025/',
  },
  {
    pct: 76,
    what: 'of stolen crypto in 2025 came from infrastructure attacks, mostly keys and seeds',
    who: 'TRM Labs',
    source: 'https://www.trmlabs.com/reports-and-whitepapers/2026-crypto-crime-report',
  },
];

export const prices = [
  { name: 'Kagi', note: 'wrist + vault', usd: 43, ours: true },
  { name: 'Trezor Safe 3', note: 'one device', usd: 59 },
  { name: 'Trezor Safe 5', note: 'one device', usd: 129 },
  { name: 'Trezor Safe 7', note: 'one device', usd: 249 },
];

export const DEVICE_URL = 'https://shop.m5stack.com/products/m5sticks3-esp32s3-mini-iot-dev-kit';
export const PRICES_URL = 'https://coinbureau.com/analysis/trezor-vs-ledger';
export const REPO_URL = 'https://github.com/team-somehow/kagi-wallet';
export const RELEASE_URL = `${REPO_URL}/releases/tag/v0.2.0`;
export const APK_URL = `${REPO_URL}/releases/download/v0.2.0/kagi-1.0.0.apk`;
export const FIRMWARE_SRC_URL = `${REPO_URL}/tree/main/firmware/wrist`;
export const MCP_SRC_URL = `${REPO_URL}/tree/main/agent-mcp`;
// The shared Kagi MCP server. Each person's connector link points here and carries their own key.
export const MCP_URL = 'https://13-235-16-182.sslip.io';
export const FIRMWARE = {
  version: '0.2.0',
  manifest: './firmware/manifest.json',
  bin: './firmware/kagi-firmware-0.2.0.bin',
  sha256: '4b91196a4ccc858e206e37849e1a51a0b194b45f93b5ac785600ee2f2c07fb9d',
};

export const sources: { title: string; outlet: string; url: string }[] = [
  { title: 'How one trader exploited Grok and Morse code', outlet: 'CryptoSlate, May 2026', url: losses[4].source },
  { title: 'How Grok got prompt-injected', outlet: 'Giskard, May 2026', url: 'https://www.giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet' },
  { title: 'A hidden flaw could expose AI agent wallets', outlet: 'CoinDesk, Apr 2026', url: losses[3].source },
  { title: 'Six mistakes in ERC-4337 smart accounts', outlet: 'Trail of Bits, Mar 2026', url: 'https://blog.trailofbits.com/2026/03/11/six-mistakes-in-erc-4337-smart-accounts/' },
  { title: 'Coinbase debuts wallet infrastructure for AI agents', outlet: 'PYMNTS, Feb 2026', url: 'https://www.pymnts.com/cryptocurrency/2026/coinbase-debuts-crypto-wallet-infrastructure-for-ai-agents/' },
  { title: '2026 Crypto Crime Report', outlet: 'TRM Labs', url: keyStats[1].source },
  { title: 'Crypto hacking and stolen funds, 2024', outlet: 'Chainalysis', url: keyStats[0].source },
  { title: 'The lethal trifecta for AI agents', outlet: 'Simon Willison, Jun 2025', url: 'https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/' },
  { title: 'Defeating prompt injections by design (CaMeL)', outlet: 'arXiv, Mar 2025', url: 'https://arxiv.org/abs/2503.18813' },
  { title: 'Hacker breaches AI crypto bot aixbt', outlet: 'Cointelegraph, Mar 2025', url: losses[5].source },
  { title: 'ElizaOS memory-injection vulnerability', outlet: 'Decrypt, 2025', url: 'https://decrypt.co/318200/elizaos-vulnerability-ai-gaslit-losing-millions' },
  { title: 'Lazarus hacked Bybit via Safe{Wallet} developer machine', outlet: 'BleepingComputer, Feb 2025', url: losses[0].source },
  { title: 'Wallet drainers took $494M in 2024', outlet: 'ScamSniffer', url: 'https://drops.scamsniffer.io/scam-sniffer-2024-web3-phishing-attacks-wallet-drainers-drain-494-million/' },
  { title: 'Radiant Capital blames North Korean hackers', outlet: 'CoinDesk, Dec 2024', url: losses[2].source },
  { title: 'User convinced AI bot to transfer $47K', outlet: 'Cointelegraph, Nov 2024', url: losses[6].source },
  { title: 'WazirX and Liminal after the $230M exploit', outlet: 'CoinDesk, Jul 2024', url: losses[1].source },
  { title: 'BitForge: flaws in 15+ threshold-ECDSA wallets', outlet: 'Fireblocks, 2023', url: 'https://www.fireblocks.com/blog/bitforge-fireblocks-researchers-uncover-vulnerabilities-in-over-15-major-wallet-providers' },
  { title: 'RFC 9591: FROST threshold signatures', outlet: 'IETF, Jun 2024', url: 'https://www.rfc-editor.org/rfc/rfc9591.html' },
  { title: 'ESP32-S3 dev kit, $21.50', outlet: "Manufacturer's store", url: DEVICE_URL },
  { title: 'Hardware wallet prices', outlet: 'Coin Bureau, Jun 2026', url: PRICES_URL },
];

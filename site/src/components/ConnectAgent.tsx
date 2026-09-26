import { useState } from 'react';
import { MCP_SRC_URL, MCP_URL, REPO_URL } from '../data';

// Two recipients the live server screens with Intercepta before the key signs: one clean, one
// flagged for phishing transfers, so the second payment waits for the owner's stick.
// The clean recipient is the gas sponsor wallet: demo payments flow back into gas.
const CLEAN = '0xBB0Dd7ca77B6BD6c1AC7F5727139D8D51228DCe0';
const FLAGGED = '0x7aa25897BB2457F46109EF1886b3F0EBB6E5f67E';
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const PROMPTS = [
  { id: 'clean', label: 'Goes straight through', text: `Send 0.000002 ETH to ${CLEAN}.` },
  { id: 'held', label: 'Held by Intercepta for your stick', text: `Send 0.000002 ETH to ${FLAGGED}.` },
];
const NAME = 'kagi';
// Where the box starts: the public demo wallet, so every button works before anyone types.
const DEMO = `${MCP_URL}/demo`;

/** A connector link, from what the app copies: the link itself, or the kagi:0x…:0x… key string. */
function toLink(raw: string): string | null {
  const v = raw.trim();
  const k = /^kagi:0x([0-9a-fA-F]{40}):0x([0-9a-fA-F]{64})$/.exec(v);
  if (k) return `${MCP_URL}/k/${k[1]}${k[2]}`;
  const l = /^https:\/\/[^\s/]+\/(k\/[0-9a-fA-F]{104}|demo)$/.exec(v);
  return l ? v : null;
}

type Target = {
  id: string;
  name: string;
  // The app's own mark, in site/public/ai.
  logo: string;
  how: string;
  // open: a link the app installs from. copy: text to paste. Both can apply.
  open?: (url: string) => string;
  copy?: (url: string) => string;
  after: string;
};

const TARGETS: Target[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    logo: './ai/chatgpt.svg',
    how: 'Developer mode',
    copy: (u) => u,
    open: () => 'https://chatgpt.com/#settings/Connectors',
    after: 'Link copied. Turn on Developer mode under Advanced, create a connector, paste, and pick No authentication.',
  },
  {
    id: 'claude',
    name: 'Claude',
    logo: './ai/claude.svg',
    how: 'Custom connector',
    copy: (u) => u,
    open: () => 'https://claude.ai/settings/connectors',
    after: 'Link copied. Choose Add custom connector, name it kagi and paste the link. It then works in Claude on the web, desktop and phone.',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    logo: './ai/claude-code.svg',
    how: 'Terminal or IDE extension',
    copy: (u) => `claude mcp add --transport http ${NAME} ${u}`,
    after: 'Command copied. Run it in your terminal, then start claude. The Claude Code extension for VS Code and JetBrains picks it up too.',
  },
  {
    id: 'codex',
    name: 'Codex',
    logo: './ai/codex.svg',
    how: 'Terminal',
    copy: (u) => `codex mcp add ${NAME} --url ${u}`,
    after: 'Command copied. Run it in your terminal, then start codex.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    logo: './ai/cursor.svg',
    how: 'One click',
    open: (u) => `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${btoa(JSON.stringify({ url: u }))}`,
    after: 'Cursor asks you to confirm the install.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    logo: './ai/vscode.svg',
    how: 'One click',
    open: (u) => `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, type: 'http', url: u }))}`,
    after: 'VS Code asks you to confirm the install.',
  },
];

// What the demo prompt does, tool call by tool call.
const RUN: { who: 'you' | 'tool' | 'stick' | 'ai'; text: string; tone?: 'ok' | 'wait' }[] = [
  { who: 'you', text: `Send 0.000002 ETH to ${short(CLEAN)}.` },
  { who: 'tool', text: `send_eth: Intercepta says clean (risk 0), 0.000002 sent`, tone: 'ok' },
  { who: 'you', text: `Send 0.000002 ETH to ${short(FLAGGED)}.` },
  { who: 'tool', text: `send_eth: Intercepta flags a fake phishing transfer (risk 45). Not signed, held for the owner`, tone: 'wait' },
  { who: 'stick', text: 'The phone shows “Intercepta held this payment” with the reason. Hold the stick’s button to pay anyway, tap it to refuse.' },
  { who: 'tool', text: 'wait_for_approval: approved, 0.000002 sent', tone: 'ok' },
  { who: 'ai', text: 'The first payment went straight through. The second was held until you approved it on your stick.' },
];

const WHO = { you: 'You', tool: 'Tool', stick: 'Stick', ai: 'AI' } as const;

async function copyText(t: string) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}

export function ConnectAgent() {
  const [raw, setRaw] = useState(DEMO);
  const isDemo = raw.trim() === DEMO;
  const [done, setDone] = useState<{ id: string; ok: boolean } | null>(null);
  const [promptCopied, setPromptCopied] = useState<string | null>(null);
  const link = toLink(raw);
  const invalid = raw.trim().length > 0 && !link;
  const target = TARGETS.find((t) => t.id === done?.id);

  const add = async (t: Target) => {
    if (!link) return;
    const ok = t.copy ? await copyText(t.copy(link)) : true;
    if (t.open) window.open(t.open(link), t.open(link).startsWith('http') ? '_blank' : '_self', 'noopener');
    setDone({ id: t.id, ok });
  };

  return (
    <section className="section" id="connect">
      <div className="wrap">
        <div className="section-head">
          <h2>Connect your AI</h2>
          <p>Give an agent a key of its own. It spends within the allowance you set, and anything more waits for a hold on your stick.</p>
        </div>

        <ol className="steps steps-3">
          <li>
            <b>Make an agent key</b>
            <span>In the Kagi app, tap New agent key. Pick a total allowance and an expiry, then hold the stick’s button.</span>
          </li>
          <li>
            <b>Copy the session key</b>
            <span>Tap Copy session key. It can spend only the approved allowance until it expires, so keep it private. Copy connector link does the same as a URL.</span>
          </li>
          <li>
            <b>Add it to your AI</b>
            <span>Paste it below and pick your app. To just try Kagi, keep the demo link that is already there.</span>
          </li>
        </ol>

        <div className="connect">
          <div className="connect-setup panel">
            <label className="connect-field">
              <span>Session key or connector link</span>
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={`kagi:0x…:0x…  or  ${MCP_URL}/k/…`}
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setDone(null);
                }}
                onFocus={(e) => e.target.select()}
                aria-invalid={invalid}
              />
              <small className={invalid ? 'is-bad' : ''}>
                {invalid
                  ? 'That is not a Kagi session key or connector link. Copy it again from the Kagi app.'
                  : isDemo
                    ? 'This is the public demo link. To use your own wallet, paste your link from the Kagi app here, or give your AI your session key in the chat and it switches over.'
                    : 'Your own wallet. The link stays on this page. Nothing here is sent anywhere.'}
              </small>
            </label>

            <div className="connect-targets">
              {TARGETS.map((t) => (
                <button key={t.id} type="button" className="connect-target" disabled={!link} onClick={() => void add(t)}>
                  <img src={t.logo} alt="" width={28} height={28} />
                  <b>Add to {t.name}</b>
                  <span>{t.how}</span>
                </button>
              ))}
            </div>
            {target ? (
              <p className="connect-after" role="status">
                {done?.ok ? target.after : 'Your browser blocked copying. Copy the link above by hand.'}
              </p>
            ) : null}

            {PROMPTS.map((pr, i) => (
              <div key={pr.id} className={`connect-try try-${pr.id}`}>
                <span>
                  {i === 0 ? 'Then try' : 'And then'} · <b>{pr.label}</b>
                </span>
                <q>{pr.text}</q>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    void copyText(pr.text).then((ok) => {
                      setPromptCopied(ok ? pr.id : null);
                      setTimeout(() => setPromptCopied(null), 2000);
                    });
                  }}
                >
                  {promptCopied === pr.id ? 'Copied' : 'Copy prompt'}
                </button>
              </div>
            ))}
            <p className="connect-note">
              Every recipient is screened by <b>Intercepta</b> before the agent's key signs. Clean addresses are paid within the allowance, flagged ones wait for your stick, and sanctioned or scam addresses are refused outright.
            </p>
            <p className="connect-note">
              Anyone with your own link can spend what is left of that key's allowance. That is all they can do. They cannot raise the limit or outlast the expiry, and you can revoke the key from the phone.
            </p>
          </div>

          <div className="connect-run panel" aria-label="What happens">
            {RUN.map((r, i) => (
              <div key={i} className={`run-row run-${r.who}${r.tone ? ` tone-${r.tone}` : ''}`}>
                <span className="run-who">{WHO[r.who]}</span>
                <span className="run-text">{r.text}</span>
              </div>
            ))}
          </div>
        </div>

        <details className="cli">
          <summary>Run your own server instead</summary>
          <pre><code>{`git clone ${REPO_URL}.git
cd ${REPO_URL.split('/').pop()}/agent-mcp && npm install
PORT=8790 node server.mjs                 # connector links become http://localhost:8790/k/…

# or in a container, on Render, Railway, Fly or a VPS
docker build -t kagi-agent-mcp . && docker run -p 8790:8790 kagi-agent-mcp`}</code></pre>
          <p className="connect-src">
            Tools: get_wallet, send_eth, wait_for_approval, request_higher_limit and get_activity (history from Curvegrid MultiBaas), plus use_my_key on the demo link. Source and details on{' '}
            <a href={MCP_SRC_URL} target="_blank" rel="noreferrer">GitHub</a>.
          </p>
        </details>
      </div>
    </section>
  );
}

import { useState } from 'react';
import { MCP_SRC_URL, MCP_URL, REPO_URL } from '../data';

const TO = '0x7aa25897BB2457F46109EF1886b3F0EBB6E5f67E';
const SHORT = `${TO.slice(0, 6)}…${TO.slice(-4)}`;
const PROMPT = `Send 0.000002 ETH to ${TO}, then send 0.000008 ETH to the same address.`;
const NAME = 'kagi';

/** A connector link, from what the app copies: the link itself, or the kagi:0x…:0x… key string. */
function toLink(raw: string): string | null {
  const v = raw.trim();
  const k = /^kagi:0x([0-9a-fA-F]{40}):0x([0-9a-fA-F]{64})$/.exec(v);
  if (k) return `${MCP_URL}/k/${k[1]}${k[2]}`;
  const l = /^https:\/\/[^\s/]+\/k\/[0-9a-fA-F]{104}$/.exec(v);
  return l ? v : null;
}

type Target = {
  id: string;
  name: string;
  how: string;
  // open: a link the app installs from. copy: text to paste. Both can apply.
  open?: (url: string) => string;
  copy?: (url: string) => string;
  after: string;
};

const TARGETS: Target[] = [
  {
    id: 'claude',
    name: 'Claude',
    how: 'Web and desktop',
    copy: (u) => u,
    open: () => 'https://claude.ai/settings/connectors',
    after: 'Link copied. In Connectors, choose Add custom connector, name it Kagi and paste.',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    how: 'Developer mode',
    copy: (u) => u,
    open: () => 'https://chatgpt.com/#settings/Connectors',
    after: 'Link copied. Turn on Developer mode under Advanced, create a connector, paste, and pick No authentication.',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    how: 'Terminal',
    copy: (u) => `claude mcp add --transport http ${NAME} ${u}`,
    after: 'Command copied. Run it in your terminal, then start claude.',
  },
  {
    id: 'codex',
    name: 'Codex',
    how: 'Terminal',
    copy: (u) => `codex mcp add ${NAME} --url ${u}`,
    after: 'Command copied. Run it in your terminal, then start codex.',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    how: 'One click',
    open: (u) => `cursor://anysphere.cursor-deeplink/mcp/install?name=${NAME}&config=${btoa(JSON.stringify({ url: u }))}`,
    after: 'Cursor asks you to confirm the install.',
  },
  {
    id: 'vscode',
    name: 'VS Code',
    how: 'One click',
    open: (u) => `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: NAME, type: 'http', url: u }))}`,
    after: 'VS Code asks you to confirm the install.',
  },
];

// What the demo prompt does, tool call by tool call.
const RUN: { who: 'you' | 'tool' | 'stick' | 'ai'; text: string; tone?: 'ok' | 'wait' }[] = [
  { who: 'you', text: `Send 0.000002 ETH to ${SHORT}, then send 0.000008 ETH to the same address.` },
  { who: 'tool', text: `send_eth 0.000002 to ${SHORT}`, tone: 'ok' },
  { who: 'tool', text: `send_eth 0.000008 to ${SHORT}: over the allowance, asks for 0.00002 in total`, tone: 'wait' },
  { who: 'stick', text: 'Beeps. Raise trader’s total to 0.00002 ETH? Hold A.' },
  { who: 'tool', text: 'wait_for_approval: approved, 0.000008 sent', tone: 'ok' },
  { who: 'ai', text: 'Both sent. 0.00001 ETH of the 0.00002 allowance is left.' },
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
  const [raw, setRaw] = useState('');
  const [done, setDone] = useState<{ id: string; ok: boolean } | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);
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
          <p>Give ChatGPT, Claude or Codex a key of its own. It spends within the allowance you set, and anything more waits for a hold on your stick.</p>
        </div>

        <ol className="steps steps-3">
          <li>
            <b>Make an agent key</b>
            <span>In the Kagi app, tap New agent key. Pick a total allowance and an expiry, then hold A on the stick.</span>
          </li>
          <li>
            <b>Copy its connector link</b>
            <span>Tap Copy connector link. It points at the shared Kagi server and carries this key, so keep it private.</span>
          </li>
          <li>
            <b>Add it to your AI</b>
            <span>Paste the link below and pick your app. Then ask it to pay someone.</span>
          </li>
        </ol>

        <div className="connect">
          <div className="connect-setup panel">
            <label className="connect-field">
              <span>Your connector link</span>
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={`${MCP_URL}/k/…`}
                value={raw}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setDone(null);
                }}
                aria-invalid={invalid}
              />
              <small className={invalid ? 'is-bad' : ''}>
                {invalid
                  ? 'That is not a connector link. Copy it again from the Kagi app.'
                  : 'It stays on this page. Nothing here is sent anywhere.'}
              </small>
            </label>

            <div className="connect-targets">
              {TARGETS.map((t) => (
                <button key={t.id} type="button" className="connect-target" disabled={!link} onClick={() => void add(t)}>
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

            <div className="connect-try">
              <span>Then try</span>
              <q>{PROMPT}</q>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void copyText(PROMPT).then((ok) => {
                    setPromptCopied(ok);
                    setTimeout(() => setPromptCopied(false), 2000);
                  });
                }}
              >
                {promptCopied ? 'Copied' : 'Copy prompt'}
              </button>
            </div>
            <p className="connect-note">
              Anyone with the link can spend what is left of that key's allowance. That is all they can do. They cannot raise the limit or outlast the expiry, and you can revoke the key from the phone.
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
            Four tools: get_wallet, send_eth, wait_for_approval and request_higher_limit. Source and details on{' '}
            <a href={MCP_SRC_URL} target="_blank" rel="noreferrer">GitHub</a>.
          </p>
        </details>
      </div>
    </section>
  );
}

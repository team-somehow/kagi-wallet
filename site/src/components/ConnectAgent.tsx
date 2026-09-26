import { useState } from 'react';
import { MCP_SRC_URL, REPO_URL } from '../data';

type Client = 'chatgpt' | 'claude';

const PROMPT = 'Send 0.000002 ETH to ABC, then send 0.000008 ETH to ABC.';

const CLIENTS: Record<Client, { name: string; steps: string[] }> = {
  chatgpt: {
    name: 'ChatGPT',
    steps: [
      'Open Settings, then Apps and Connectors, then Advanced, and turn on Developer mode.',
      'Create a connector. Paste your server URL and choose No authentication.',
      'In a new chat, open the tools menu and pick the Kagi connector.',
    ],
  },
  claude: {
    name: 'Claude',
    steps: [
      'Open Settings, then Connectors, and choose Add custom connector.',
      'Name it Kagi and paste your server URL.',
      'In a new chat, turn the Kagi connector on from the tools menu.',
    ],
  },
};

// What the demo prompt does, tool call by tool call.
const RUN: { who: 'you' | 'tool' | 'stick' | 'ai'; text: string; tone?: 'ok' | 'wait' }[] = [
  { who: 'you', text: PROMPT },
  { who: 'tool', text: 'send_eth 0.000002 to ABC', tone: 'ok' },
  { who: 'tool', text: 'send_eth 0.000008 to ABC: over the allowance, asks for 0.00002 in total', tone: 'wait' },
  { who: 'stick', text: 'Beeps. Raise trader’s total to 0.00002 ETH? Hold A.' },
  { who: 'tool', text: 'wait_for_approval: approved, 0.000008 sent', tone: 'ok' },
  { who: 'ai', text: 'Both sent. 0.00001 ETH of the 0.00002 allowance is left.' },
];

const WHO = { you: 'You', tool: 'Tool', stick: 'Stick', ai: 'AI' } as const;

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        });
      }}
    >
      {done ? 'Copied' : label}
    </button>
  );
}

export function ConnectAgent() {
  const [client, setClient] = useState<Client>('chatgpt');
  const c = CLIENTS[client];

  return (
    <section className="section" id="connect">
      <div className="wrap">
        <div className="section-head">
          <h2>Connect your AI</h2>
          <p>Give ChatGPT or Claude a key of its own. It spends within the allowance you set, and anything more waits for a hold on your stick.</p>
        </div>

        <ol className="steps steps-4">
          <li>
            <b>Make an agent key</b>
            <span>In the Kagi app, tap New agent key. Pick a total allowance and an expiry, then hold A on the stick.</span>
          </li>
          <li>
            <b>Copy it</b>
            <span>
              Tap Copy session key. It copies <code>kagi:0x…:0x…</code>, the wallet address and the key together.
            </span>
          </li>
          <li>
            <b>Start the server</b>
            <span>Run the Kagi MCP server with that key. It prints a private HTTPS address ending in <code>/mcp/…</code>.</span>
          </li>
          <li>
            <b>Add it to your AI</b>
            <span>Paste the address into ChatGPT or Claude as a connector. Then ask it to pay someone.</span>
          </li>
        </ol>

        <div className="connect">
          <div className="connect-setup panel">
            <div className="connect-tabs" role="tablist" aria-label="AI app">
              {(Object.keys(CLIENTS) as Client[]).map((k) => (
                <button key={k} type="button" role="tab" aria-selected={client === k} className={client === k ? 'is-on' : ''} onClick={() => setClient(k)}>
                  {CLIENTS[k].name}
                </button>
              ))}
            </div>
            <ol className="connect-list">
              {c.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <div className="connect-try">
              <span>Then try</span>
              <q>{PROMPT}</q>
              <Copy text={PROMPT} label="Copy prompt" />
            </div>
            <p className="connect-note">
              Keep the server address private: anyone with it can spend what is left of that key's allowance. That is all they can do. They cannot raise the limit or outlast the expiry, and you can revoke the key from the phone.
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
          <summary>Run the server</summary>
          <pre><code>{`# on your computer, with a public HTTPS tunnel (needs cloudflared)
git clone ${REPO_URL}.git
cd kagi-wallet/agent-mcp && npm install
SESSION_KEY='kagi:0x…:0x…' ./run-local.sh

# or on any container host: Render, Railway, Fly, a VPS
docker build -t kagi-agent-mcp .
docker run -p 8790:8790 -e SESSION_KEY='kagi:0x…:0x…' -e MCP_TOKEN=$(openssl rand -hex 16) kagi-agent-mcp`}</code></pre>
          <p className="connect-src">
            Four tools: get_wallet, send_eth, wait_for_approval and request_higher_limit. Source and details on{' '}
            <a href={MCP_SRC_URL} target="_blank" rel="noreferrer">GitHub</a>.
          </p>
        </details>
      </div>
    </section>
  );
}

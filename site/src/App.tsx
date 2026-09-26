import { Compare } from './components/Compare';
import { ConnectAgent } from './components/ConnectAgent';
import { Demo } from './components/Demo';
import { GetLeash } from './components/GetLeash';
import { Hardware } from './components/Hardware';
import { Hero } from './components/Hero';
import { KeyStats } from './components/KeyStats';
import { Ladder } from './components/Ladder';
import { Losses } from './components/Losses';
import { REPO_URL, sources } from './data';

export function App() {
  return (
    <>
      <div className="grain" aria-hidden="true" />
      <nav className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#top">
            <svg viewBox="0 0 26 26" aria-hidden="true"><circle cx="8" cy="18" r="4.2" fill="none" stroke="#ece9e1" strokeWidth="2.2" /><path d="M11 15.5 C 14 12, 15 9.5, 20 6" fill="none" stroke="#ffb13b" strokeWidth="2.2" strokeLinecap="round" /></svg>
            Leash
          </a>
          <div className="nav-links">
            <a href="#demo">Demo</a>
            <a href="#incidents">Why</a>
            <a href="#how">How</a>
            <a href="#hardware">Hardware</a>
            <a href="#connect">Connect AI</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a className="btn btn-primary btn-sm" href="#get">Get Leash</a>
          </div>
        </div>
      </nav>

      <main>
        <div className="wrap"><Hero /></div>
        <Demo />
        <Losses />
        <KeyStats />
        <Ladder />
        <Hardware />
        <Compare />
        <GetLeash />
        <ConnectAgent />

        <section className="section" id="sources">
          <div className="wrap">
            <details className="sources">
              <summary>Sources ({sources.length})</summary>
              <ul>
                {sources.map((s) => (
                  <li key={s.url + s.title}>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                    <span>{s.outlet}</span>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>Leash runs on the Sepolia testnet. Development firmware, not audited.</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/team-somehow/leash-wallet</a>
        </div>
      </footer>
    </>
  );
}

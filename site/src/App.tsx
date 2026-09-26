import { Compare } from './components/Compare';
import { ConnectAgent } from './components/ConnectAgent';
import { Demo } from './components/Demo';
import { GetKagi } from './components/GetKagi';
import { Hardware } from './components/Hardware';
import { Hero } from './components/Hero';
import { KeyStats } from './components/KeyStats';
import { Ladder } from './components/Ladder';
import { Losses } from './components/Losses';
import { Partners } from './components/Partners';
import { REPO_URL, sources } from './data';

export function App() {
  return (
    <>
      <nav className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#top">
            <img src="./logo.png" alt="Kagi Wallet" width="81" height="34" />
          </a>
          <div className="nav-links">
            <a href="#demo">Demo</a>
            <a href="#how">How it works</a>
            <a href="#hardware">Hardware</a>
            <a href="#connect">Connect AI</a>
            <a href="#sources">Sources</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
            <a className="btn btn-primary btn-sm" href="#get">Download</a>
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
        <GetKagi />
        <ConnectAgent />
        <Partners />

        <section className="section" id="sources">
          <div className="wrap">
            <div className="section-head">
              <span className="eyebrow section-index">10 / References</span>
              <h2>Follow the evidence.</h2>
              <p>The research, incident reports, and technical references behind Kagi.</p>
            </div>
            <div className="sources">
              <p className="sources-label">{sources.length} references</p>
              <ul>
                {sources.map((s) => (
                  <li key={s.url + s.title}>
                    <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
                    <span>{s.outlet}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-inner">
          <span>Kagi Wallet runs on-chain, on a testnet. Development firmware, not audited.</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">github.com/team-somehow/kagi-wallet</a>
        </div>
      </footer>
    </>
  );
}

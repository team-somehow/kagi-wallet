type Mark = 'yes' | 'no' | 'some';
const COLS = ['Limit enforced on-chain', 'No single key can raise it', 'Device shows what you sign', 'Agent works while you sleep'];
const ROWS: { name: string; eg: string; marks: Mark[]; ours?: boolean }[] = [
  { name: 'Payment networks', eg: 'Stripe, Visa, Mastercard', marks: ['no', 'no', 'no', 'yes'] },
  { name: 'Vendor wallets', eg: 'Coinbase, Turnkey, Privy', marks: ['no', 'no', 'no', 'yes'] },
  { name: 'Session keys', eg: 'Safe, ZeroDev, MetaMask', marks: ['yes', 'no', 'some', 'yes'] },
  { name: 'Kagi', eg: 'phone + ESP32 devices', marks: ['yes', 'yes', 'yes', 'yes'], ours: true },
];
const LABEL: Record<Mark, string> = { yes: 'Yes', no: 'No', some: 'If you add a hardware wallet' };

export function Compare() {
  return (
    <section className="section" id="compare">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow section-index">06 / The comparison</span>
          <h2>How others do it</h2>
        </div>
        <div className="compare panel">
          <div className="compare-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col"><span className="sr">Approach</span></th>
                  {COLS.map((c) => <th scope="col" key={c}>{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((r) => (
                  <tr key={r.name} className={r.ours ? 'is-ours' : ''}>
                    <th scope="row"><b>{r.name}</b><small>{r.eg}</small></th>
                    {r.marks.map((m, i) => (
                      <td key={i}><span className={`mark is-${m}`} title={LABEL[m]} aria-label={LABEL[m]} /></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

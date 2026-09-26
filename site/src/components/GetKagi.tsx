import { useEffect, useRef, useState } from 'react';
import { APK_URL, FIRMWARE, FIRMWARE_SRC_URL, REPO_URL } from '../data';

// Minimal Web Serial types: Chrome and Edge on desktop have it, TypeScript's DOM lib doesn't.
type SerialPortLike = {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
};
type SerialLike = { requestPort(): Promise<SerialPortLike> };
const serial = (): SerialLike | undefined => (navigator as unknown as { serial?: SerialLike }).serial;

type RoleState = 'idle' | 'busy' | 'done' | 'error';

/** Sends {"t":"set_role","role":"vault"} over USB. The firmware only accepts it over the cable. */
async function makeVault(): Promise<void> {
  const s = serial();
  if (!s) throw new Error('no-serial');
  const port = await s.requestPort();
  await port.open({ baudRate: 115200 });
  try {
    const w = port.writable!.getWriter();
    await w.write(new TextEncoder().encode('{"t":"set_role","role":"vault"}\n'));
    w.releaseLock();
  } finally {
    await port.close().catch(() => undefined);
  }
}

export function GetKagi() {
  const [webSerial, setWebSerial] = useState(true);
  const [role, setRole] = useState<RoleState>('idle');
  const loaded = useRef(false);

  useEffect(() => {
    setWebSerial(Boolean(serial()));
    if (loaded.current) return;
    loaded.current = true;
    // Registers <esp-web-install-button>. Loaded lazily so it doesn't weigh on first paint.
    void import('esp-web-tools/dist/web/install-button.js');
  }, []);

  const onVault = async () => {
    setRole('busy');
    try {
      await makeVault();
      setRole('done');
    } catch (e) {
      // Closing the port picker is not an error worth showing.
      setRole((e as Error)?.name === 'NotFoundError' ? 'idle' : 'error');
    }
  };

  return (
    <section className="section" id="get">
      <div className="wrap">
        <div className="section-head">
          <span className="eyebrow section-index">07 / Get started</span>
          <h2>Get Kagi Wallet</h2>
          <p>The Android app, the open firmware, and a flasher that runs in your browser.</p>
        </div>

        <div className="get">
          <article className="get-card panel">
            <div className="get-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" /></svg>
            </div>
            <h3>Android app</h3>
            <p>Holds the phone's half of each key, behind your fingerprint.</p>
            <a className="btn btn-primary" href={APK_URL}>Download APK</a>
            <small>v0.3.0, 103 MB, Android 7+ on 64-bit phones. Allow installs from your browser when Android asks.</small>
          </article>

          <article className="get-card panel">
            <div className="get-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="4" y="7" width="16" height="10" rx="2.5" /><rect x="6.5" y="9" width="8" height="6" rx="1" /><circle cx="17.5" cy="12" r="1.2" /></svg>
            </div>
            <h3>Firmware</h3>
            <p>One build for both Kagi Wallets. Its saved role picks the blue Kagi Wallet or red second-wallet screens. C++ on PlatformIO, open on GitHub.</p>
            <div className="get-actions">
              <a className="btn btn-ghost" href={FIRMWARE_SRC_URL} target="_blank" rel="noreferrer">View source</a>
              <a className="btn btn-ghost" href={FIRMWARE.bin} download>Download .bin</a>
            </div>
            <small>v{FIRMWARE.version} for ESP32-S3, 8 MB flash. SHA-256 <code>{FIRMWARE.sha256.slice(0, 16)}…</code></small>
          </article>
        </div>

        <div className="flash panel" id="flash">
          <div className="flash-head">
            <h3>Flash an ESP32</h3>
            {webSerial ? (
              <esp-web-install-button manifest={FIRMWARE.manifest}>
                <button slot="activate" type="button" className="btn btn-primary">Flash from this browser</button>
                <span slot="unsupported" className="flash-warn">Use Chrome or Edge on a computer to flash from the browser.</span>
                <span slot="not-allowed" className="flash-warn">Open this page over HTTPS to flash.</span>
              </esp-web-install-button>
            ) : (
              <span className="flash-warn">Use Chrome or Edge on a computer to flash from the browser.</span>
            )}
          </div>

          <ol className="steps">
            <li>
              <b>Plug it in</b>
              <span>Connect the ESP32 to your computer with a USB-C data cable.</span>
            </li>
            <li>
              <b>First time only: download mode</b>
              <span>Hold the side button until the green LED flashes. After Kagi Wallet is on it, updates reset the ESP32 by themselves.</span>
            </li>
            <li>
              <b>Flash</b>
              <span>Press Flash from this browser, pick the serial port, and wait about a minute.</span>
            </li>
            <li>
              <b>Boot</b>
              <span>Click the side button once. The screen shows Kagi and asks you to open the app.</span>
            </li>
            <li>
              <b>Optional: a second Kagi Wallet</b>
              <span>Optional. Flash another ESP32 the same way, keep it plugged in, then set its role over the cable. It turns red, then joins your wallet from the app.</span>
              <div className="step-action">
                <button type="button" className="btn btn-ghost btn-sm" onClick={onVault} disabled={!webSerial || role === 'busy'}>
                  {role === 'busy' ? 'Setting…' : role === 'done' ? 'Second Kagi Wallet set' : 'Set as second Kagi Wallet'}
                </button>
                {role === 'error' && <em className="flash-warn">Couldn't write to the device. Check the cable and try again.</em>}
              </div>
            </li>
          </ol>

          <details className="cli">
            <summary>Prefer the command line?</summary>
            <pre><code>{`# build and flash from source (PlatformIO)
git clone ${REPO_URL}.git
cd kagi-wallet/firmware/wrist
pio run -e sticks3 -t upload

# or flash the release image with esptool
esptool.py --chip esp32s3 write_flash 0x0 kagi-firmware-${FIRMWARE.version}.bin`}</code></pre>
          </details>
        </div>
      </div>
    </section>
  );
}

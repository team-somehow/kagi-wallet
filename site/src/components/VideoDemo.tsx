// The recorded demo: the real phone, the real Kagi Wallets and a real AI paying on-chain.
const VIDEO_ID = 'f7zsFhNV9_M';

export function VideoDemo() {
  return (
    <section className="section" id="video">
      <div className="wrap">
        <div className="section-head">
          <h2>See it work</h2>
          <p>An AI pays within its cap, Intercepta holds a risky recipient, and the owner approves on the Kagi Wallet.</p>
        </div>
        <div className="video-frame panel">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${VIDEO_ID}?rel=0`}
            title="Kagi Wallet demo"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        </div>
        <p className="video-link">
          <a href={`https://youtu.be/${VIDEO_ID}`} target="_blank" rel="noreferrer">
            Watch on YouTube <span aria-hidden="true">↗</span>
          </a>
        </p>
      </div>
    </section>
  );
}

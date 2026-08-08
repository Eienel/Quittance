import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

/**
 * Landing page — says what Quittance is before dropping anyone into the app.
 * Hero → the core insight (proof of absence) → the two outcomes at equal
 * weight → how it works → the confidential score → CTA.
 */
export default function Home() {
  // React can drop the `muted` attribute, which makes the browser block
  // muted-autoplay and show a play button — force muted + play() via the ref.
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = true;
    v.play().catch(() => {});
  }, []);

  return (
    <div className="home">
      {/* hero */}
      <header className="hero">
        <video
          ref={videoRef}
          className="hero-video"
          src="/hero-loop.mp4"
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
        />
        <div className="hero-scrim" />
        <div className="hero-inner">
          <h1>
            Every invoice ends in a<br />
            <span className="q">quittance</span>, or a <span className="m">mark</span>.
          </h1>
          <p className="hero-sub">
            Invoices in XRP that settle themselves. Proven paid, or proven unpaid.
          </p>
          <div className="cta-row">
            <Link to="/create" className="btn primary">Create an invoice</Link>
            <Link to="/invoices" className="btn">See it in action →</Link>
          </div>
        </div>
        <span className="scroll-cue">Scroll ↓</span>
      </header>

      {/* the core insight — image left, text right */}
      <div className="home-block split">
        <div className="split-media">
          <img src="/insight.jpg" alt="" loading="lazy" />
        </div>
        <div className="split-text">
          <h2>Proof nobody else can give</h2>
          <p className="lead">
            Anyone can prove a payment <em>happened</em>. Almost nothing can prove one
            <em> didn&apos;t</em>. Flare can, so a missed payment becomes a fact anyone can verify,
            not just your word against theirs.
          </p>
        </div>
      </div>

      {/* two outcomes, equal weight */}
      <div className="two-up">
        <div className="outcome-card settled">
          <div className="headline">Paid, on time <span className="k">Quittance</span></div>
          <p className="sub">
            The XRPL payment landed before the deadline. Settled with an FDC
            <span className="mono"> XRPPayment</span> proof. A permanent receipt.
          </p>
        </div>
        <div className="outcome-card delinquent">
          <div className="headline">Proven unpaid <span className="k">Mark</span></div>
          <p className="sub">
            No payment exists anywhere in the window. Marked with an FDC
            <span className="mono"> XRPPaymentNonexistence</span> proof. A permanent mark.
          </p>
        </div>
      </div>

      {/* how it works */}
      <section className="home-block">
        <h2>How it works</h2>
        <ol className="steps">
          <li>
            <span className="step-n">1</span>
            <div>
              <b>Issue</b>
              <p>Create an invoice payable in XRP with a deadline. The registry mints a unique destination tag.</p>
            </div>
          </li>
          <li>
            <span className="step-n">2</span>
            <div>
              <b>Pay</b>
              <p>The payer sends ordinary XRP from any wallet or exchange, tagged with that number. Nothing to install, no bridging, no custody.</p>
            </div>
          </li>
          <li>
            <span className="step-n">3</span>
            <div>
              <b>Prove</b>
              <p>Flare&apos;s Data Connector votes on the outcome and returns an on-chain proof in about two minutes, visible the whole way.</p>
            </div>
          </li>
          <li>
            <span className="step-n">4</span>
            <div>
              <b>Settle or mark</b>
              <p>The invoice locks to exactly one outcome, forever. It accumulates into a permanent, per-account payment record.</p>
            </div>
          </li>
        </ol>
      </section>

      {/* confidential score — image left, text right */}
      <div className="home-block split media-left">
        <div className="split-media">
          <img src="/confidential.jpg" alt="" loading="lazy" />
        </div>
        <div className="split-text">
          <h2>A credit score that never sees your history</h2>
          <p className="lead">
            A lender needs the judgement, not the ledger. So a <b>TEE</b> reads your full
            history and returns only the score. The raw data never leaves the enclave.
          </p>
          <Link to="/score" className="btn" style={{ marginTop: "0.5rem" }}>Try the score →</Link>
        </div>
      </div>

      {/* footer cta */}
      <footer className="home-cta">
        <h2>Every invoice ends in a quittance or a mark.</h2>
        <div className="cta-row">
          <Link to="/create" className="btn primary">Create an invoice</Link>
          <Link to="/record" className="btn">Look up a record</Link>
        </div>
      </footer>
    </div>
  );
}

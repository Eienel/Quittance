import { useState } from "react";
import { looksLikeXrplAddress } from "@/lib/format";
import * as fixtures from "@/lib/fixtures";
import ScorePanel from "@/components/ScorePanel";
import type { Score as ScoreType } from "@/lib/types";

/**
 * Plime Confidential — the differentiator.
 *
 * STATUS: the on-chain request path and extension 66014 are real, but no TEE
 * machine or result proxy is registered yet. Until that end-to-end path exists,
 * this screen only returns a clearly labelled fixture preview.
 *
 * When the machine is live, the result arrives asynchronously from the enclave,
 * so this needs the same pending treatment as the proof flows — the request
 * transaction confirming is not the score arriving.
 */
export default function Score() {
  const fixtureMode = fixtures.useFixtures();
  const [input, setInput] = useState("");
  const [score, setScore] = useState<ScoreType | null>(null);
  const [error, setError] = useState<string | null>(null);

  function lookup() {
    if (!looksLikeXrplAddress(input)) return;
    setError(null);
    setScore(null);
    if (!fixtureMode) {
      setError("Live confidential scoring is not available yet. Open fixture mode to preview the scorer output without sending a transaction.");
      return;
    }
    setScore(fixtures.scores.live);
  }

  return (
    <section>
      <h2>Confidential score</h2>
      <p className="dim">
        A creditworthiness score computed inside a TEE. The enclave reads this
        account&apos;s entire payment history (every invoice, amount and date), and
        only the score comes out.
      </p>

      <div className="row">
        <div>
          <label>XRPL address</label>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="r…" />
        </div>
        <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
          <button onClick={lookup} disabled={!looksLikeXrplAddress(input)}>
            {fixtureMode ? "Preview score" : "Check availability"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {score && <ScorePanel score={score} />}

      <div className="detail-card">
        <p style={{ marginTop: 0 }}><b>Prototype status</b></p>
        <p className="dim" style={{ marginBottom: 0 }}>
          The scorer model, enclave reader, Coston2 instruction sender and extension 66014
          are built. A TEE machine and result proxy are not live, so this page demonstrates
          the output shape with fixtures and does not claim a live confidential computation.
        </p>
      </div>
    </section>
  );
}

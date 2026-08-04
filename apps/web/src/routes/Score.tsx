import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import type { useWallet } from "@/hooks/useWallet";
import { requestScore, errorMessage } from "@/lib/registry";
import { remember } from "@/lib/addressBook";
import { looksLikeXrplAddress } from "@/lib/format";
import * as fixtures from "@/lib/fixtures";
import ScorePanel from "@/components/ScorePanel";
import type { Score as ScoreType } from "@/lib/types";

type Wallet = ReturnType<typeof useWallet>;

/**
 * Quittance Confidential — the differentiator.
 *
 * STATUS: the on-chain request path is real (extension 65940 is registered), but
 * no TEE machine is registered yet, so no score comes back. Until then this
 * screen runs on fixtures. Everything except `deliverScore` is final.
 *
 * When the machine is live, the result arrives asynchronously from the enclave,
 * so this needs the same pending treatment as the proof flows — the request
 * transaction confirming is not the score arriving.
 */
export default function Score() {
  const wallet = useOutletContext<Wallet>();
  const [input, setInput] = useState("");
  const [score, setScore] = useState<ScoreType | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function lookup() {
    if (!looksLikeXrplAddress(input)) return;
    setBusy(true);
    setError(null);
    setScore(null);
    try {
      if (fixtures.useFixtures() || !wallet.signer) {
        // Fixture path — also what you get without a wallet connected.
        setScore(fixtures.scores.live);
        return;
      }
      await requestScore(wallet.signer, remember(input));
      // TODO(backend): the enclave's reply is not wired up yet. Once a TEE
      // machine is registered, subscribe to the instruction result here.
      setError("Score requested. The TEE machine is not registered yet, so no result will arrive.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2>Confidential score</h2>
      <p className="dim">
        A creditworthiness score computed inside a TEE. The enclave reads this
        account&apos;s entire payment history — every invoice, amount and date — and
        only the score comes out.
      </p>

      <div className="row">
        <div>
          <label>XRPL address</label>
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="r…" />
        </div>
        <div style={{ flex: "0 0 auto", alignSelf: "flex-end" }}>
          <button onClick={lookup} disabled={!looksLikeXrplAddress(input) || busy}>
            {busy ? "Requesting…" : "Get score"}
          </button>
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {score && <ScorePanel score={score} />}

      <div className="stub">
        <p className="dim">
          TODO(design): show the enclave boundary. Raw history on one side marked
          &quot;never exposed&quot;; the score crossing over. This is the clearest
          way to make the privacy claim legible rather than asserted.
        </p>
        <p className="dim">
          Fixture states to build against: {Object.keys(fixtures.scores).join(", ")} —
          see <code>src/lib/fixtures.ts</code>.
        </p>
      </div>
    </section>
  );
}

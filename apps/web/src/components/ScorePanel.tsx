import type { Score } from "@/lib/types";

/**
 * The confidential score — the part that most needs the UI to tell a story.
 *
 * What must land visually: the enclave reads the account's ENTIRE payment
 * history — every invoice, amount and date — and only this number comes out.
 * Consider showing the boundary literally: raw history on one side marked
 * "never exposed", the score crossing over.
 *
 * `basis` must always be visible. A 700 backed by two invoices is a different
 * claim from a 700 backed by forty, and hiding that would be the dishonest
 * version of this screen — a judge will poke at exactly this.
 */
export default function ScorePanel({ score }: { score: Score }) {
  if (score.score === 0) {
    return (
      <div className="stub">
        <p><b>No record</b></p>
        <p className="dim">
          This account has no attested outcomes. That is not the same as a clean
          record — say so plainly.
        </p>
      </div>
    );
  }

  return (
    <div className="stub">
      <p style={{ fontSize: "3rem", margin: 0 }}>{score.score}</p>
      <p className="badge status-open">{score.band}</p>
      <p className="dim">
        Based on {score.basis} attested outcome{score.basis === 1 ? "" : "s"} · model {score.version}
      </p>
      <p className="dim">
        Computed inside a TEE. The payment history behind this number never left
        the enclave.
      </p>
    </div>
  );
}

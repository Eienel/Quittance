import { STAGE_LABELS } from "@/hooks/usePipeline";
import { TIMING } from "@/lib/config";
import type { Pipeline as PipelineType } from "@/lib/types";

/**
 * The two-minute wait, made legible.
 *
 * From the payer hitting send to a receipt on screen is roughly two minutes,
 * almost all of it one FDC voting round. That latency is in the protocol and
 * cannot be engineered away — so the UI's job is to show real progress across
 * it. A named pipeline reads as rigor; a two-minute spinner reads as broken.
 *
 * TODO(design): this is the strongest candidate for real motion — a progress
 * arc keyed to TIMING.fdcRound, stage transitions, the XRPL tx link appearing.
 */
const ORDER: PipelineType["stage"][] = ["awaiting_payment", "proving", "settled"];

export default function Pipeline({ pipeline }: { pipeline: PipelineType }) {
  const terminal = pipeline.stage === "settled" || pipeline.stage === "delinquent";
  const stages = pipeline.stage === "delinquent" ? ["awaiting_payment", "proving", "delinquent"] : ORDER;
  const currentIndex = stages.indexOf(pipeline.stage);

  const badTerminal = pipeline.stage === "delinquent";

  return (
    <div className="pipeline">
      <ol>
        {stages.map((stage, i) => {
          const done = i < currentIndex || (terminal && i === currentIndex);
          const active = i === currentIndex && !terminal;
          const cls = done ? (badTerminal && i === currentIndex ? "bad" : "done") : active ? "active" : "";
          return (
            <li key={stage} className={cls}>
              <span className="node" />
              {STAGE_LABELS[stage as PipelineType["stage"]].label}
            </li>
          );
        })}
      </ol>

      {pipeline.stage === "proving" && (
        <p className="dim small" style={{ marginTop: "0.9rem" }}>
          The Flare Data Connector is voting on this outcome. Rounds take about{" "}
          {TIMING.fdcRound}s, occasionally up to {TIMING.fdcRoundWorstCase}s — the wait is
          in the protocol, not the page.
        </p>
      )}

      {pipeline.xrplTxHash && (
        <p className="dim small mono" style={{ marginTop: "0.5rem" }}>
          XRPL tx {pipeline.xrplTxHash.slice(0, 16)}…
        </p>
      )}
    </div>
  );
}

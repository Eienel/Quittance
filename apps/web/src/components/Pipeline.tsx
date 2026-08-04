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

  return (
    <div className="stub">
      <ol style={{ display: "flex", gap: "1rem", listStyle: "none", padding: 0, flexWrap: "wrap" }}>
        {stages.map((stage, i) => {
          const done = i < currentIndex || (terminal && i === currentIndex);
          const active = i === currentIndex && !terminal;
          return (
            <li
              key={stage}
              className={done ? "status-settled" : active ? "status-open" : "dim"}
              style={{ borderBottom: "2px solid currentColor", paddingBottom: ".25rem" }}
            >
              {STAGE_LABELS[stage as PipelineType["stage"]].label}
            </li>
          );
        })}
      </ol>

      {pipeline.stage === "proving" && (
        <p className="dim">
          The Flare Data Connector is voting on this outcome. Rounds take about{" "}
          {TIMING.fdcRound}s, occasionally up to {TIMING.fdcRoundWorstCase}s.
        </p>
      )}

      {pipeline.xrplTxHash && (
        <p className="dim mono">XRPL tx {pipeline.xrplTxHash.slice(0, 16)}…</p>
      )}
    </div>
  );
}

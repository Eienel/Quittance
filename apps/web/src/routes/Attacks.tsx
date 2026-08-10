import attacks from "@/lib/attacks.json";
import { CHAIN } from "@/lib/config";

/**
 * The adversarial demo.
 *
 * Every attestation behind this page is genuine — confirmed by the Flare Data Connector,
 * asserting something true. Each one would nonetheless be false *about the invoice it is
 * aimed at*, and an integration that verifies the Merkle proof and then acts would accept
 * all of them.
 *
 * That is the argument the project actually rests on: on Flare the hard part is not
 * obtaining a proof, it is establishing that the proof you obtained is about the
 * obligation in front of you.
 *
 * The JSON is written by `services/attester/bin/adversary.js`, which runs these against
 * the live registry — so what is on screen is the output of a run, not a claim.
 *
 * TODO(design): this is the most quotable screen in the app. Consider leading with the
 * three claims in the attacker's voice, and revealing the contract's refusal underneath.
 */
export default function Attacks() {
  const { results, generatedAt, registry } = attacks;

  return (
    <section>
      <h2>Attacks</h2>
      <p className="dim">
        Every proof below is real and every statement it makes is true. Each would still be
        false about the invoice it targets, and a naive integration would accept all of
        them.
      </p>

      {results.map((a) => (
        <div className="stub" key={a.name}>
          <p>
            <b>{a.name}</b>{" "}
            <span className={`badge ${a.blocked ? "status-settled" : "status-delinquent"}`}>
              {a.blocked ? "blocked" : "NOT BLOCKED"}
            </span>{" "}
            {!a.live && <span className="badge status-lapsed">not live on {CHAIN.name}</span>}
          </p>

          {a.claim && (
            <p>
              <span className="dim">The attacker proves: </span>
              {a.claim}
            </p>
          )}
          {a.whyItFools && (
            <p>
              <span className="dim">Why it would fool a naive contract: </span>
              {a.whyItFools}
            </p>
          )}
          {a.defence && (
            <p>
              <span className="dim">What stops it here: </span>
              {a.defence}
            </p>
          )}
          {a.reason && <p className="mono dim">{a.reason}</p>}
          {a.note && <p className="dim">{a.note}</p>}
        </div>
      ))}

      <p className="dim">
        Generated {new Date(generatedAt).toLocaleString()} against{" "}
        <a href={`${CHAIN.explorer}/address/${registry}`} className="mono">
          {registry.slice(0, 10)}…
        </a>
        . Re-run with <code>node bin/adversary.js</code>.
      </p>
    </section>
  );
}

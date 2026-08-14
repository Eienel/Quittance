/**
 * Live checks for the browser-side FDC pipeline.
 *
 * Only the read-only halves are exercised here — preparing a request and
 * fetching a finalized proof — because the write half spends gas. Those two are
 * where the browser port could realistically break: request encoding, and the DA
 * layer's header rules.
 *
 * Run with LIVE=1.
 */
import { describe, expect, it } from "vitest";

const live = process.env.LIVE === "1";

const VERIFIER = "https://fdc-verifiers-testnet.flare.network";
const DA = "https://ctn2-data-availability.flare.network";

const toBytes32 = (s: string): string =>
  "0x" +
  Array.from(new TextEncoder().encode(s))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .padEnd(64, "0");

/** From the end-to-end run: the payment that settled invoice 1, and its round. */
const SETTLED_TX = "9E6C3DDEF5E35CE1C8E91A2705B20B9DEC6875C88B77403C1587DC56BB4DDC96";
const SETTLED_ROUND = 1_415_700;

describe.skipIf(!live)("FDC pipeline", () => {
  it("prepares an XRPPayment request", async () => {
    const res = await fetch(`${VERIFIER}/verifier/xrp/XRPPayment/prepareRequest`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": "00000000-0000-0000-0000-000000000000" },
      body: JSON.stringify({
        attestationType: toBytes32("XRPPayment"),
        sourceId: toBytes32("testXRP"),
        requestBody: { transactionId: "0x" + SETTLED_TX, proofOwner: "0x" + "0".repeat(40) },
      }),
    });
    const body = await res.json();
    expect(body.status).toBe("VALID");
    expect(body.abiEncodedRequest).toMatch(/^0x[0-9a-f]+$/);
  }, 30_000);

  it("prepares an XRPPaymentNonexistence request", async () => {
    const res = await fetch(`${VERIFIER}/verifier/xrp/XRPPaymentNonexistence/prepareRequest`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": "00000000-0000-0000-0000-000000000000" },
      body: JSON.stringify({
        attestationType: toBytes32("XRPPaymentNonexistence"),
        sourceId: toBytes32("testXRP"),
        requestBody: {
          minimalBlockNumber: "19625000",
          deadlineBlockNumber: "19625400",
          deadlineTimestamp: String(Math.floor(Date.now() / 1000) - 600),
          destinationAddressHash: "0x49ed1d1fbbb168b407d0836c6b3f900bc2551f017ae28f183c6ae3c41ec56b29",
          amount: "123456789",
          checkFirstMemoData: false,
          firstMemoDataHash: "0x" + "0".repeat(64),
          checkDestinationTag: true,
          destinationTag: "77001",
          proofOwner: "0x" + "0".repeat(40),
        },
      }),
    });
    const body = await res.json();
    expect(body.status).toBe("VALID");
  }, 30_000);

  /**
   * The DA layer's CORS allowlist does not include x-api-key, so the browser must
   * not send it. This asserts the keyless call works — if that ever changes, the
   * browser pipeline breaks and this catches it.
   */
  it("fetches a finalized proof without an API key", async () => {
    const prep = await fetch(`${VERIFIER}/verifier/xrp/XRPPayment/prepareRequest`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-API-KEY": "00000000-0000-0000-0000-000000000000" },
      body: JSON.stringify({
        attestationType: toBytes32("XRPPayment"),
        sourceId: toBytes32("testXRP"),
        requestBody: { transactionId: "0x" + SETTLED_TX, proofOwner: "0x" + "0".repeat(40) },
      }),
    });
    const { abiEncodedRequest } = await prep.json();

    const res = await fetch(`${DA}/api/v1/fdc/proof-by-request-round-raw`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ votingRoundId: SETTLED_ROUND, requestBytes: abiEncodedRequest }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.proof)).toBe(true);
    expect(body.response_hex).toMatch(/^0x[0-9a-f]+$/);
  }, 45_000);

  it("still allows cross-origin requests from a browser", async () => {
    for (const url of [
      `${VERIFIER}/verifier/xrp/XRPPayment/prepareRequest`,
      `${DA}/api/v1/fdc/proof-by-request-round-raw`,
    ]) {
      const res = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: "https://plime.vercel.app",
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type",
        },
      });
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    }
  }, 30_000);
});

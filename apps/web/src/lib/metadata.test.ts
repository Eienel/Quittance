import { describe, expect, it } from "vitest";
import { decodeMeta, encodeMeta, verifyPayee } from "./metadata";
import { addressHash } from "./format";
import * as fixtures from "./fixtures";

const PAYEE = fixtures.LIVE.payeeAddress;

describe("invoice metadata", () => {
  it("round-trips payee and memo", () => {
    const encoded = encodeMeta({ payee: PAYEE, memo: "Design work" });
    expect(decodeMeta(encoded)).toEqual({ payee: PAYEE, memo: "Design work" });
  });

  it("round-trips a non-invoice obligation kind", () => {
    const encoded = encodeMeta({ payee: PAYEE, kind: "coupon" });
    expect(decodeMeta(encoded)).toEqual({ payee: PAYEE, kind: "coupon" });
  });

  it("omits the default invoice kind to keep metadata small", () => {
    // "invoice" is the absence of a kind, so it should not be written.
    expect(encodeMeta({ payee: PAYEE, kind: "invoice" })).toBe(
      encodeMeta({ payee: PAYEE })
    );
    expect(decodeMeta(encodeMeta({ payee: PAYEE, kind: "invoice" })).kind).toBeUndefined();
  });

  it("encodes nothing for an empty meta", () => {
    expect(encodeMeta({})).toBe("");
    expect(decodeMeta("")).toEqual({});
  });

  it("reads a bare address from older invoices", () => {
    expect(decodeMeta(PAYEE)).toEqual({ payee: PAYEE });
  });

  it("treats other loose text as a memo", () => {
    expect(decodeMeta("ipfs://something")).toEqual({ memo: "ipfs://something" });
  });

  it("accepts a payee whose hash matches the invoice", () => {
    const inv = { ...fixtures.invoices.open(), metadataURI: encodeMeta({ payee: PAYEE }) };
    expect(verifyPayee(inv)).toBe(PAYEE);
  });

  // The metadata is issuer-supplied, so it is checked rather than trusted.
  it("rejects a payee that does not hash to the invoice's payee", () => {
    const inv = {
      ...fixtures.invoices.open(),
      metadataURI: encodeMeta({ payee: "rATTACKERAddressThatIsNotThePayee" }),
    };
    expect(verifyPayee(inv)).toBeNull();
  });

  it("falls back to a locally known address when metadata is absent", () => {
    const inv = { ...fixtures.invoices.open(), metadataURI: "" };
    expect(verifyPayee(inv, PAYEE)).toBe(PAYEE);
    expect(verifyPayee(inv, "rSomeoneElseEntirely")).toBeNull();
  });

  it("matches the hash the contract stores", () => {
    expect(addressHash(PAYEE)).toBe(fixtures.LIVE.payeeHash);
  });
});

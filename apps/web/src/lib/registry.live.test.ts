/**
 * Reads the real deployed registry on Coston2.
 *
 * Skipped by default so `npm test` stays hermetic; run with LIVE=1 to check the
 * data layer against the chain. The expected values come from the end-to-end run
 * documented in the root README.
 */
import { describe, expect, it } from "vitest";
import { getInvoice, getInvoiceCount, getRecord, listInvoices } from "./registry";
import { LIVE } from "./fixtures";
import { displayStatus } from "./format";
import { InvoiceStatus } from "./types";

const live = process.env.LIVE === "1";

describe.skipIf(!live)("InvoiceRegistry on Coston2", () => {
  it("reads the invoice count", async () => {
    expect(await getInvoiceCount()).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it("reads the settled invoice (the receipt path)", async () => {
    const inv = await getInvoice(2);
    expect(inv.destinationTag).toBe(2);
    expect(inv.amountDrops).toBe(5_000_000n);
    expect(inv.status).toBe(InvoiceStatus.Settled);
    expect(inv.settledByAddressHash).toBe(LIVE.payerHash);
    // Paying admits the debt, so no separate acknowledgement is ever needed.
    expect(inv.acknowledged).toBe(true);
    expect(displayStatus(inv)).toBe("settled");
  }, 20_000);

  it("reads the delinquent invoice (the mark path)", async () => {
    const inv = await getInvoice(3);
    expect(inv.destinationTag).toBe(3);
    expect(inv.amountDrops).toBe(7_000_000n);
    expect(inv.status).toBe(InvoiceStatus.Delinquent);
    expect(inv.acknowledged).toBe(true);
    expect(displayStatus(inv)).toBe("delinquent");
  }, 20_000);

  /**
   * Invoice 5 names a payer who never admitted the debt. The mark is real; the
   * record it would have touched must be untouched.
   */
  it("does not let a fabricated debt reach anyone's record", async () => {
    const inv = await getInvoice(5);
    expect(inv.acknowledged).toBe(false);
    expect(inv.status).toBe(InvoiceStatus.Delinquent);

    const victim = await getRecord(inv.payerAddressHash);
    expect(victim.delinquentCount).toBe(0n);
    expect(victim.delinquentDrops).toBe(0n);
  }, 20_000);

  it("reads the payer's accumulated record", async () => {
    const rec = await getRecord(LIVE.payerHash);
    expect(rec.settledCount).toBeGreaterThanOrEqual(1n);
    expect(rec.delinquentCount).toBeGreaterThanOrEqual(2n);
    expect(rec.settledDrops).toBeGreaterThanOrEqual(5_000_000n);
    expect(rec.delinquentDrops).toBeGreaterThanOrEqual(19_000_000n);
  }, 20_000);

  it("reports no record for an account with no history", async () => {
    const rec = await getRecord("0x" + "11".repeat(32));
    expect(rec.settledCount).toBe(0n);
    expect(rec.delinquentCount).toBe(0n);
  }, 20_000);

  it("lists invoices newest first", async () => {
    const list = await listInvoices(5);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBeGreaterThan(list[list.length - 1].id);
  }, 30_000);
});

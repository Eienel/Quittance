import { useCallback, useEffect, useState } from "react";
import { TIMING } from "@/lib/config";
import * as fixtures from "@/lib/fixtures";
import { getInvoice, getRecord, listInvoices } from "@/lib/registry";
import type { Invoice, PayerRecord } from "@/lib/types";

interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Polled chain reads.
 *
 * Nothing on-chain here changes faster than an FDC round, so a 15 s poll is
 * plenty — don't tighten it hoping for snappier updates, the latency is in the
 * protocol, not the polling.
 */
function usePolled<T>(fetcher: () => Promise<T>, deps: unknown[], enabled = true): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await fetcher();
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.shortMessage ?? err?.message ?? String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(refresh, TIMING.pollMs);
    return () => clearInterval(id);
  }, [refresh, enabled]);

  return { data, loading, error, refresh };
}

export function useInvoiceList(limit = 25): Async<Invoice[]> {
  if (fixtures.useFixtures()) {
    return { data: fixtures.list(), loading: false, error: null, refresh: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePolled(() => listInvoices(limit), [limit]);
}

export function useInvoice(id: bigint | number | null): Async<Invoice> {
  if (fixtures.useFixtures()) {
    return { data: fixtures.invoices.open(), loading: false, error: null, refresh: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePolled(() => getInvoice(id!), [id?.toString()], id !== null);
}

export function usePayerRecord(payerAddressHash: string | null): Async<PayerRecord> {
  if (fixtures.useFixtures()) {
    return { data: fixtures.records.live, loading: false, error: null, refresh: () => {} };
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return usePolled(() => getRecord(payerAddressHash!), [payerAddressHash], !!payerAddressHash);
}

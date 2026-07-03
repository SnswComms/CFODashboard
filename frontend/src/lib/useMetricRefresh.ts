'use client';

// Shared hook for the per-metric live pull. Each dashboard card owns an instance
// keyed by its backend metric id; calling refresh() POSTs the scoped, read-only
// (GET-only against MYOB) per-metric pull endpoint through the api client,
// isolating the fresh value in its own small per-metric cache without taking the
// global sync lock. Two different metrics can be refreshing at once — every
// instance carries independent status, so one card's spinner never blocks
// another's.
//
// Endpoint (backend/src/routes/myob.js):
//   POST /api/myob/metrics/:id/pull → triggers the scoped MYOB fetch, recomputes
//   the ONE figure via the shared builders, persists metric-<id>.json and returns
//   the fresh doc inline. 409 (same metric already pulling) resolves the fallback.
//   It is a POST (not GET) because it triggers a MYOB read + local cache write;
//   apiPost also never retries, so a failed/409 pull fires exactly one request.
//
// Response envelope (backend/src/lib/envelope.js): the endpoint returns
//   { data: MetricRefreshDoc, meta: { generated_at, dataSource, ... } }
// We consume the persisted per-metric doc (backend metricPullService.runPull):
// its `value` is a KIND-SPECIFIC object (a KPI card, a cash-movement table, a
// benefits balance, …), so the hook does not interpret it — it hands the whole
// doc to the card, which knows how to swap its own figure.

import { useCallback, useState } from 'react';
import { apiPost } from '@/lib/api';

/**
 * Fresh per-metric document the pull endpoint returns in the envelope `data`
 * (backend metricPullService.runPull). `value` is the recomputed figure(s),
 * shaped per metric kind — the owning card reads the fields it needs. `as_of`
 * is the read timestamp and `provenance.source` is the label surfaced next to
 * the card.
 */
export interface MetricProvenance {
  source: string;
  myob_scope: string;
  compute_source: string;
  from_date: string;
  company: string;
  base_endpoint_family?: string;
}

export interface MetricRefreshDoc {
  metric_id: string;
  label: string;
  view: string;
  generated_at: string;
  as_of: string;
  read_only_policy: string;
  provenance: MetricProvenance;
  // Kind-specific figure(s); the owning card interprets this.
  value: Record<string, unknown>;
  extras: Record<string, unknown>;
}

export type MetricRefreshPhase = 'idle' | 'loading' | 'success' | 'error';

export interface MetricRefreshState {
  phase: MetricRefreshPhase;
  /** Latest fresh doc, or null until the first successful refresh. */
  result: MetricRefreshDoc | null;
  /** Human-readable error tone message on the last failed attempt. */
  error: string | null;
  /** Fire a scoped refresh for this metric; safe to call repeatedly. */
  refresh: () => Promise<void>;
}

// Distinct sentinel so a failed/empty/409 POST is never mistaken for a real doc
// (apiPost resolves the fallback on any error, non-2xx, or timeout — a 409
// "already pulling" is a non-2xx, so it also lands here).
const FAILED = { metric_id: '' } as unknown as MetricRefreshDoc;

/**
 * @param id       backend metric id — MUST match the backend registry exactly
 *                 (backend/src/constants/metricRegistry.js).
 * @param endpoint pull endpoint path (e.g. `/myob/metrics/<id>/pull`),
 *                 relative to the api client's `/api` base.
 */
export function useMetricRefresh(id: string, endpoint: string): MetricRefreshState {
  const [phase, setPhase] = useState<MetricRefreshPhase>('idle');
  const [result, setResult] = useState<MetricRefreshDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setPhase('loading');
    setError(null);
    // POST the scoped pull; the endpoint already encodes the metric id in its
    // path. The backend validates it against its registry and 409s a concurrent
    // pull of the same metric (which apiPost maps to the FAILED fallback).
    const fresh = await apiPost<MetricRefreshDoc>(endpoint, {}, FAILED);
    if (fresh === FAILED || !fresh.metric_id) {
      setPhase('error');
      setError('Could not refresh this figure — the last value is unchanged.');
      return;
    }
    setResult(fresh);
    setPhase('success');
    // `id` is encoded in `endpoint`, so the pull only depends on the path.
  }, [endpoint]);

  return { phase, result, error, refresh };
}

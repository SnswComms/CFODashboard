'use client';

// Thin typed client for the Express backend.
// All requests go to the same-origin `/api/...` path; next.config.ts rewrites
// proxy them to the backend (default http://localhost:4000).
//
// Backend envelope (src/lib/envelope.js):
//   { data: <payload>, meta: { dataSource, sourcePath, generated_at, warnings, ... } }
// Legacy endpoints (/health, /api/status, /roles*, ...) return unwrapped bodies;
// the unwrap below passes those through untouched.

import { useEffect, useState } from 'react';

export interface ApiMeta {
  dataSource: 'live-cache' | 'synthetic' | 'missing' | string;
  sourcePath: string | null;
  generated_at: string | null;
  warnings: string[];
  [key: string]: unknown;
}

export interface Envelope<T> {
  data: T;
  meta: ApiMeta;
}

const BASE = '/api';
// Generous enough for a dev-mode cold compile plus a large live-cache parse;
// failures still resolve the fallback, so slow is better than permanently mock.
const DEFAULT_TIMEOUT_MS = 10000;
const RETRY_DELAY_MS = 1500;

function isEnvelope<T>(body: unknown): body is Envelope<T> {
  return Boolean(
    body &&
      typeof body === 'object' &&
      'data' in (body as Record<string, unknown>) &&
      'meta' in (body as Record<string, unknown>)
  );
}

function unwrap<T>(body: unknown): T {
  if (
    body &&
    typeof body === 'object' &&
    'data' in (body as Record<string, unknown>) &&
    'meta' in (body as Record<string, unknown>)
  ) {
    return (body as Envelope<T>).data;
  }
  return body as T;
}

async function request<T>(
  path: string,
  fallback: T,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, {
      cache: 'no-store',
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) return fallback;
    const body: unknown = await res.json();
    const data = unwrap<T>(body);
    return data == null ? fallback : data;
  } catch {
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET an API path (e.g. '/command-centre/overview' or '/api/budget/conference')
 * and unwrap the envelope. Resolves `fallback` on any error, non-2xx, or
 * timeout — callers never need try/catch. A failed GET is retried once after a
 * short delay (GETs are idempotent; POSTs are never retried) so a transient
 * backend restart doesn't pin a view to its fallback.
 */
export async function apiGet<T>(path: string, fallback: T, timeoutMs?: number): Promise<T> {
  // `fallback` is the sentinel for "request failed" — a distinct marker object
  // would be cleaner, but data == null already maps to fallback in request().
  const first = await request<T>(normalize(path), fallback, undefined, timeoutMs);
  if (first !== fallback) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return request<T>(normalize(path), fallback, undefined, timeoutMs);
}

async function requestEnvelope<T>(path: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Envelope<T> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(path, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    return isEnvelope<T>(body) ? body : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET an API path and return the FULL envelope ({ data, meta }) so callers can
 * read meta.warnings alongside the payload. Same no-store/timeout/one-retry
 * semantics as apiGet; resolves null on any error, non-2xx, timeout, or a
 * non-envelope body — callers fall back on their design constants.
 */
export async function apiGetEnvelope<T>(path: string, timeoutMs?: number): Promise<Envelope<T> | null> {
  const first = await requestEnvelope<T>(normalize(path), timeoutMs);
  if (first !== null) return first;
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return requestEnvelope<T>(normalize(path), timeoutMs);
}

/** POST JSON to an API path; same unwrap/fallback semantics as apiGet. */
export function apiPost<T>(path: string, payload: unknown, fallback: T, timeoutMs?: number): Promise<T> {
  return request<T>(
    normalize(path),
    fallback,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    timeoutMs
  );
}

function normalize(path: string): string {
  if (path.startsWith('/api/') || path === '/health') return path;
  return BASE + (path.startsWith('/') ? path : '/' + path);
}

/**
 * React hook: GET on mount and again whenever the tab regains focus, so a tab
 * that loaded during a backend restart self-heals instead of showing its
 * design fallback until a manual refresh. Display-only views should prefer
 * this over a bare useEffect+apiGet; views that seed editable state from the
 * payload must NOT use it (a focus refetch would clobber user input).
 */
export function useApiGet<T>(path: string, fallback: T, timeoutMs?: number): T {
  const [data, setData] = useState<T>(fallback);
  useEffect(() => {
    let alive = true;
    const load = () => {
      apiGet<T>(path, fallback, timeoutMs).then((d) => {
        if (alive) setData(d);
      });
    };
    load();
    const onFocus = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
    // fallback is a stable module-level constant in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, timeoutMs]);
  return data;
}

/**
 * Envelope-preserving twin of useApiGet: same mount + focus-refetch semantics,
 * but resolves the full { data, meta } so views can surface meta.warnings.
 * Null until the first successful response (and after any failure) — callers
 * derive their payload as `env?.data ?? FALLBACK`.
 */
export function useApiGetEnvelope<T>(path: string, timeoutMs?: number): Envelope<T> | null {
  const [env, setEnv] = useState<Envelope<T> | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => {
      apiGetEnvelope<T>(path, timeoutMs).then((e) => {
        if (alive) setEnv(e);
      });
    };
    load();
    const onFocus = () => {
      if (document.visibilityState === 'visible') load();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      alive = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [path, timeoutMs]);
  return env;
}

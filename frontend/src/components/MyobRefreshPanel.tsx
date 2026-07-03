'use client';

// "Refresh MYOB data" control — triggers the backend's read-only sync run
// (POST /api/myob/sync) and shows live progress by polling GET
// /api/myob/sync/status. An optional custom extract window (from/to date) is
// posted in the body; leaving both blank pulls the env/FY-start default that
// the 6-hourly scheduler uses. The run is GET-only against MYOB, so triggering
// it is always safe — a failed pull keeps the last good caches untouched.

import { useCallback, useEffect, useRef, useState } from 'react';
import { FONT, color } from '@/lib/format';

interface LastRun {
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  company: string;
  from_date: string | null;
  to_date: string | null;
  counts: Record<string, unknown>;
  errors: string[];
}

interface SyncStatus {
  running: boolean;
  current_run: LastRun | null;
  last_run: LastRun | null;
}

type MsgTone = 'good' | 'warn' | 'bad' | 'neutral';
interface Msg {
  tone: MsgTone;
  text: string;
}

const POLL_MS = 3000;

async function fetchStatus(): Promise<SyncStatus | null> {
  try {
    const res = await fetch('/api/myob/sync/status', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return (body && body.data) ?? null;
  } catch {
    return null;
  }
}

// Compact "12,345 lines · 13 departments" summary from a run's counts.
function countsSummary(counts: Record<string, unknown>): string {
  const num = (key: string) => (typeof counts[key] === 'number' ? (counts[key] as number) : null);
  const parts: string[] = [];
  const lines = num('journal_lines');
  const scanned = num('journals_scanned');
  const depts = num('departments');
  const accounts = num('accounts');
  if (lines != null) parts.push(`${lines.toLocaleString('en-US')} journal lines`);
  if (scanned != null) parts.push(`${scanned.toLocaleString('en-US')} journals`);
  if (accounts != null) parts.push(`${accounts.toLocaleString('en-US')} accounts`);
  if (depts != null) parts.push(`${depts} departments`);
  return parts.join(' · ');
}

function windowLabel(run: LastRun): string {
  if (run.from_date && run.to_date) return `${run.from_date} → ${run.to_date}`;
  if (run.from_date) return `from ${run.from_date}`;
  if (run.to_date) return `to ${run.to_date}`;
  return 'default full-year window';
}

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E7E5DF',
  borderRadius: 10,
  padding: '18px 20px',
};

const labelStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 9.5,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
  marginBottom: 6,
  display: 'block',
};

export default function MyobRefreshPanel() {
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const running = Boolean(status?.running) || submitting;

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  // Poll until the run finishes, then surface its outcome and stop.
  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(async () => {
      const s = await fetchStatus();
      if (!s) return;
      setStatus(s);
      if (!s.running) {
        stopPolling();
        const run = s.last_run;
        if (run && run.ok) {
          setMsg({
            tone: 'good',
            text: `Refresh complete — ${countsSummary(run.counts) || 'caches updated'}.`,
          });
        } else if (run) {
          setMsg({
            tone: 'bad',
            text: `Refresh finished with errors: ${run.errors.slice(0, 2).join('; ') || 'see sync status'}.`,
          });
        }
      }
    }, POLL_MS);
  }, [stopPolling]);

  // Reflect an already-running sync on mount (e.g. a scheduled run in flight).
  useEffect(() => {
    let alive = true;
    fetchStatus().then((s) => {
      if (!alive || !s) return;
      setStatus(s);
      if (s.running) {
        setMsg({ tone: 'neutral', text: 'A sync is already running…' });
        startPolling();
      }
    });
    return () => {
      alive = false;
      stopPolling();
    };
  }, [startPolling, stopPolling]);

  const pull = async () => {
    setSubmitting(true);
    setMsg({ tone: 'neutral', text: 'Starting refresh…' });
    try {
      const payload: Record<string, string> = {};
      if (fromDate) payload.from_date = fromDate;
      if (toDate) payload.to_date = toDate;
      const res = await fetch('/api/myob/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (res.status === 202) {
        setMsg({ tone: 'neutral', text: 'Pulling from MYOB… this can take a few minutes.' });
        if (body?.data) setStatus(body.data as SyncStatus);
        startPolling();
      } else if (res.status === 409) {
        setMsg({ tone: 'warn', text: 'A sync is already in progress — watching it instead.' });
        if (body?.data) setStatus(body.data as SyncStatus);
        startPolling();
      } else if (res.status === 400) {
        setMsg({ tone: 'bad', text: body?.error || 'Invalid date range.' });
      } else {
        setMsg({ tone: 'bad', text: body?.error || `Refresh failed (HTTP ${res.status}).` });
      }
    } catch {
      setMsg({ tone: 'bad', text: 'Could not reach the backend to start a refresh.' });
    } finally {
      setSubmitting(false);
    }
  };

  const lastRun = status?.last_run ?? null;

  return (
    <div style={cardStyle}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 14, color: '#1B2430', fontWeight: 500, marginBottom: 3 }}>
            Refresh MYOB data
          </div>
          <div style={{ fontSize: 12, color: '#9AA0A8', lineHeight: 1.5, maxWidth: 460 }}>
            Pulls the live GL from MYOB Advanced (read-only) and rebuilds every dashboard cache.
            Leave the dates blank for the standard full-financial-year window.
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <label style={labelStyle} htmlFor="myob-from">
              From
            </label>
            <input
              id="myob-from"
              type="date"
              className="num-input"
              value={fromDate}
              max={toDate || undefined}
              onChange={(e) => setFromDate(e.currentTarget.value)}
              disabled={running}
              style={{ width: 150 }}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="myob-to">
              To
            </label>
            <input
              id="myob-to"
              type="date"
              className="num-input"
              value={toDate}
              min={fromDate || undefined}
              onChange={(e) => setToDate(e.currentTarget.value)}
              disabled={running}
              style={{ width: 150 }}
            />
          </div>
          <button
            onClick={pull}
            disabled={running}
            style={{
              fontFamily: FONT,
              fontSize: 12.5,
              fontWeight: 500,
              color: '#FFFFFF',
              background: running ? '#9AA0A8' : '#1B2430',
              border: 0,
              borderRadius: 8,
              padding: '9px 18px',
              cursor: running ? 'default' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {running ? 'Refreshing…' : 'Pull from MYOB'}
          </button>
        </div>
      </div>

      {msg && (
        <div
          style={{
            marginTop: 14,
            fontSize: 12,
            color: color(msg.tone === 'neutral' ? '' : msg.tone),
            lineHeight: 1.5,
          }}
        >
          {msg.text}
        </div>
      )}

      {lastRun && (
        <div
          style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid #EFEDE7',
            fontSize: 11.5,
            color: '#9AA0A8',
            lineHeight: 1.6,
          }}
        >
          <span style={{ color: color(lastRun.ok === false ? 'bad' : lastRun.ok ? 'good' : '') }}>
            {lastRun.ok === false ? 'Last run failed' : lastRun.ok ? 'Last run OK' : 'Last run pending'}
          </span>
          {' · '}
          {lastRun.company}
          {' · '}
          {windowLabel(lastRun)}
          {lastRun.finishedAt ? ` · finished ${lastRun.finishedAt.replace('T', ' ').slice(0, 16)}` : ''}
          {countsSummary(lastRun.counts) ? ` · ${countsSummary(lastRun.counts)}` : ''}
        </div>
      )}
    </div>
  );
}

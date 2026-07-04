'use client';

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { navGroupDefs, viewMetaMap, isViewKey } from '@/lib/designData';
import type { ViewKey } from '@/lib/designData';
import { FONT } from '@/lib/format';
import { DateRangeContext, resolveRange } from '@/lib/dateRange';
import AuthScreens from '@/components/AuthScreens';
import { authClient, useSession } from '@/lib/authClient';
import { useToast } from '@/components/Toast';

const RANGE_OPTIONS: Array<[string, string]> = [
  ['fytd', 'FY2026 to date'],
  ['month', 'This month'],
  ['quarter', 'This quarter'],
  ['12m', 'Last 12 months'],
  ['year', 'Full year FY2026'],
];

const SYNC_POLL_INTERVAL_MS = 3000;
const SYNC_POLL_ATTEMPTS = 30;

const groupLabelStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: '#A8A196',
  fontWeight: 500,
  padding: '0 10px 8px',
};

interface SyncRun {
  ok: boolean | null;
  counts?: Record<string, unknown>;
  errors?: string[];
}

interface SyncStatusPayload {
  running: boolean;
  last_run: SyncRun | null;
}

interface OverviewFingerprint {
  kpis: unknown;
  totals: unknown;
  trend: unknown;
  warnings: string[];
}

function countsSummary(counts: Record<string, unknown> | undefined): string {
  if (!counts) return '';
  const num = (key: string) => (typeof counts[key] === 'number' ? (counts[key] as number) : null);
  const parts: string[] = [];
  const lines = num('journal_lines');
  const journals = num('journals_scanned');
  const departments = num('departments');
  if (lines != null) parts.push(`${lines.toLocaleString('en-US')} journal lines`);
  if (journals != null) parts.push(`${journals.toLocaleString('en-US')} journals`);
  if (departments != null) parts.push(`${departments} departments`);
  return parts.join(' · ');
}

function fingerprintEqual(a: OverviewFingerprint | null, b: OverviewFingerprint | null): boolean {
  if (!a || !b) return false;
  return JSON.stringify({ kpis: a.kpis, totals: a.totals, trend: a.trend }) === JSON.stringify({ kpis: b.kpis, totals: b.totals, trend: b.trend });
}

export default function Shell({ view, children }: { view: ViewKey; children: ReactNode }) {
  const toast = useToast();
  const router = useRouter();
  const { data: session, isPending } = useSession();
  const [rangeKey, setRangeKey] = useState('fytd');
  const [rangeLabel, setRangeLabel] = useState('FY2026 to date');
  const [range, setRange] = useState(() => resolveRange('fytd'));
  const [rangeRefreshing, setRangeRefreshing] = useState(false);
  const [rangeStatus, setRangeStatus] = useState('');
  const [rangeOpen, setRangeOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [customError, setCustomError] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const customFromRef = useRef<HTMLInputElement>(null);
  const customToRef = useRef<HTMLInputElement>(null);
  const syncSeqRef = useRef(0);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t && t.closest && !t.closest('[data-range]')) setRangeOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // Views (e.g. Overview's "Jump to a dashboard" rows) request navigation by
  // dispatching a 'cc:navigate' CustomEvent whose detail is the target ViewKey.
  useEffect(() => {
    const onNavigate = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (typeof id === 'string' && isViewKey(id)) router.push(`/${id}`);
    };
    window.addEventListener('cc:navigate', onNavigate);
    return () => window.removeEventListener('cc:navigate', onNavigate);
  }, [router]);

  const userRole = (session?.user as { role?: string | null } | undefined)?.role;
  const isAdmin = userRole === 'admin';

  // The admin route is role-gated: send non-admins back to the overview. The
  // page content is hidden below until the redirect lands.
  const blockAdmin = !isPending && !!session && view === 'admin' && !isAdmin;
  useEffect(() => {
    if (blockAdmin) router.replace('/overview');
  }, [blockAdmin, router]);

  // New page, fresh scroll position — mirror normal browser navigation. Also
  // close the mobile drawer so tapping a nav item dismisses the off-canvas menu.
  useEffect(() => {
    document.getElementById('cc-scroll')?.scrollTo({ top: 0 });
    // Deliberate sync-with-navigation: the drawer must close on ANY view
    // change (nav tap, cc:navigate event, browser back), so the effect is the
    // one place that sees them all.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawerOpen(false);
  }, [view]);

  // Close the mobile drawer on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (isPending) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#FAFAF8',
          fontFamily: FONT,
          color: '#9AA0A8',
          fontSize: 13,
        }}
      >
        Loading…
      </div>
    );
  }

  if (!session) {
    // useSession refetches automatically after sign-in; the prop is kept for
    // interface stability.
    return <AuthScreens onAuthed={() => {}} />;
  }

  const userName = session.user.name || session.user.email || '';
  const initials =
    userName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => (w[0] || '').toUpperCase())
      .join('') || '?';
  const roleLabel = isAdmin ? 'Administrator' : 'Chief Financial Officer';

  // While the /admin → /overview redirect for non-admins is in flight, present
  // the overview chrome and suppress the admin page content.
  const effectiveView: ViewKey = blockAdmin ? 'overview' : view;

  const viewMeta = viewMetaMap[effectiveView] || viewMetaMap.overview;

  const isLatestSync = (seq: number) => syncSeqRef.current === seq;

  const pollSync = async (seq: number): Promise<SyncRun | null> => {
    for (let i = 0; i < SYNC_POLL_ATTEMPTS; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_INTERVAL_MS));
      if (!isLatestSync(seq)) return null;
      if (i === 7) setRangeStatus('Still refreshing MYOB data');
      const res = await fetch('/api/myob/sync/status', { cache: 'no-store' }).catch(() => null);
      if (!res || !res.ok) continue;
      const body = await res.json().catch(() => null);
      if (!body?.data?.running) {
        window.dispatchEvent(new CustomEvent('cc:data-refresh'));
        return (body.data as SyncStatusPayload).last_run ?? null;
      }
    }
    return null;
  };

  const overviewFingerprint = async (query: string): Promise<OverviewFingerprint | null> => {
    const res = await fetch(`/api/command-centre/overview?${query}`, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) return null;
    const body = await res.json().catch(() => null);
    if (!body?.data) return null;
    return {
      kpis: body.data.kpis ?? null,
      totals: body.data.totals ?? null,
      trend: body.data.trend ?? null,
      warnings: Array.isArray(body.meta?.warnings) ? body.meta.warnings : [],
    };
  };

  const postRangeSync = (next: ReturnType<typeof resolveRange>) =>
    fetch('/api/myob/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_date: next.from, to_date: next.to }),
    });

  const triggerRangeSync = async (next: ReturnType<typeof resolveRange>, previous: ReturnType<typeof resolveRange>, seq: number) => {
    setRangeRefreshing(true);
    setRangeStatus('Updating from MYOB');
    window.dispatchEvent(new CustomEvent('cc:data-refresh'));
    toast.info(`${next.label} is loading from cached data while MYOB refreshes.`, 'Date range changed');
    const before = await overviewFingerprint(previous.query);
    try {
      let res = await postRangeSync(next);
      if (res.status === 202 || res.status === 409) {
        setRangeStatus(res.status === 409 ? 'Waiting for current MYOB sync' : 'Pulling fresh MYOB data');
        if (res.status === 409) toast.warn('A MYOB pull is already running. I’ll update the page when it finishes.', 'Refresh queued');
        let run = await pollSync(seq);
        if (res.status === 409 && run && isLatestSync(seq)) {
          setRangeStatus('Pulling fresh MYOB data');
          res = await postRangeSync(next);
          run = res.status === 202 ? await pollSync(seq) : null;
        }
        if (!isLatestSync(seq)) return;
        if (run?.ok) {
          const after = await overviewFingerprint(next.query);
          window.dispatchEvent(new CustomEvent('cc:data-refresh'));
          const summary = countsSummary(run.counts);
          const coverageWarning = after?.warnings.find((warning) => /cached extract window|cache starts|cache ends/i.test(warning));
          if (coverageWarning) {
            toast.warn(coverageWarning, 'Range coverage limited');
          } else if (fingerprintEqual(before, after)) {
            toast.warn(
              summary
                ? `MYOB returned ${summary}, but the visible KPIs and chart are unchanged for ${next.label}.`
                : `The visible KPIs and chart are unchanged for ${next.label}.`,
              'No dashboard change'
            );
          } else {
            toast.success(summary ? `Updated ${next.label}: ${summary}.` : `Updated ${next.label}.`, 'MYOB refresh complete');
          }
        } else if (run && run.ok === false) {
          toast.error((run.errors || []).slice(0, 2).join('; ') || 'MYOB refresh finished with errors.', 'MYOB refresh failed');
        } else {
          toast.warn('The page updated from the latest available cache. The MYOB refresh is still running in the background.', 'Still refreshing');
        }
      } else {
        if (!isLatestSync(seq)) return;
        window.dispatchEvent(new CustomEvent('cc:data-refresh'));
        const body = await res.json().catch(() => null);
        toast.warn(body?.error || `MYOB refresh did not start (HTTP ${res.status}). Showing cached data.`, 'Using cached data');
      }
    } catch {
      if (!isLatestSync(seq)) return;
      window.dispatchEvent(new CustomEvent('cc:data-refresh'));
      toast.error('Could not reach the backend to start the MYOB refresh. Showing cached data.', 'Refresh unavailable');
    } finally {
      if (isLatestSync(seq)) {
        setRangeRefreshing(false);
        setRangeStatus('');
      }
    }
  };

  const pickRange = (key: string) => {
    const next = resolveRange(key);
    if (next.query === range.query) {
      setRangeOpen(false);
      return;
    }
    const previous = range;
    const seq = syncSeqRef.current + 1;
    syncSeqRef.current = seq;
    setCustomError('');
    setRangeKey(next.key);
    setRangeLabel(next.label);
    setRange(next);
    setRangeOpen(false);
    void triggerRangeSync(next, previous, seq);
  };

  const applyCustom = () => {
    const from = customFrom || customFromRef.current?.value || '';
    const to = customTo || customToRef.current?.value || '';
    if (!from || !to) {
      setCustomError('Choose both dates.');
      return;
    }
    if (from > to) {
      setCustomError('Start date must be before end date.');
      return;
    }
    setCustomFrom(from);
    setCustomTo(to);
    const next = resolveRange('custom', { from, to });
    if (next.query === range.query) {
      setRangeOpen(false);
      return;
    }
    const previous = range;
    const seq = syncSeqRef.current + 1;
    syncSeqRef.current = seq;
    setCustomError('');
    setRangeKey(next.key);
    setRangeLabel(next.label);
    setRange(next);
    setRangeOpen(false);
    void triggerRangeSync(next, previous, seq);
  };

  const logout = async () => {
    await authClient.signOut();
    setRangeOpen(false);
    toast.info('Signed out.');
  };

  return (
    <DateRangeContext.Provider value={{ ...range, refreshing: rangeRefreshing }}>
    <div
      className="cc-shell"
      style={{
        fontFamily: FONT,
        color: '#1B2430',
        WebkitFontSmoothing: 'antialiased',
        background: '#FAFAF8',
      }}
    >
      <aside
        className={`cc-sidebar${drawerOpen ? ' cc-sidebar-open' : ''}`}
        style={{
          background: '#F5F4EF',
          borderRight: '1px solid #E7E5DF',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div
          style={{
            padding: '22px 20px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: '1px solid #E7E5DF',
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/sda-logo.png"
            alt="SDA"
            style={{ width: 34, height: 34, borderRadius: 8, display: 'block', flex: 'none' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1B2430', lineHeight: 1.1 }}>
              CFO Command Centre
            </div>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#9AA0A8',
              }}
            >
              South NSW Conference
            </div>
          </div>
        </div>
        <nav style={{ flex: 1, overflowY: 'auto', padding: '16px 12px' }}>
          {navGroupDefs.map((group) => (
            <div key={group.label} style={{ marginBottom: 18 }}>
              <div style={groupLabelStyle}>{group.label}</div>
              {group.items.map(([id, label]) => {
                const active = effectiveView === id;
                return (
                  <button
                    key={id}
                    className="navbtn"
                    onClick={() => router.push(`/${id}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      border: 0,
                      background: active ? '#1B2430' : 'transparent',
                      borderRadius: 8,
                      padding: '9px 10px',
                      marginBottom: 2,
                      cursor: 'pointer',
                      fontFamily: FONT,
                      fontSize: 13.5,
                      color: active ? '#FBFBF9' : '#4A5260',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: active ? '#C9A24B' : 'transparent',
                        flex: 'none',
                      }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          ))}
          {isAdmin && (
            <div style={{ marginBottom: 18 }}>
              <div style={groupLabelStyle}>Administration</div>
              {([['admin', 'User management']] as Array<[ViewKey, string]>).map(([id, label]) => {
                const active = effectiveView === id;
                return (
                  <button
                    key={id}
                    className="navbtn"
                    onClick={() => router.push(`/${id}`)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      width: '100%',
                      textAlign: 'left',
                      border: 0,
                      background: active ? '#1B2430' : 'transparent',
                      borderRadius: 8,
                      padding: '9px 10px',
                      marginBottom: 2,
                      cursor: 'pointer',
                      fontFamily: FONT,
                      fontSize: 13.5,
                      color: active ? '#FBFBF9' : '#4A5260',
                      fontWeight: active ? 500 : 400,
                    }}
                  >
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        background: active ? '#C9A24B' : 'transparent',
                        flex: 'none',
                      }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
          )}
        </nav>
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid #E7E5DF',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: '50%',
              background: '#1B2430',
              color: '#F5F4EF',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 500,
              flex: 'none',
            }}
          >
            {initials}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 12.5, color: '#1B2430', fontWeight: 500, lineHeight: 1.1 }}>
              {userName}
            </div>
            <div style={{ fontSize: 11, color: '#9AA0A8' }}>{roleLabel}</div>
          </div>
          <button
            className="navbtn"
            onClick={logout}
            title="Log out"
            style={{
              border: 0,
              background: 'transparent',
              cursor: 'pointer',
              padding: 7,
              borderRadius: 8,
              flex: 'none',
              lineHeight: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#757C86"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
          </button>
        </div>
      </aside>

      {drawerOpen && (
        <button
          className="cc-backdrop"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      <main
        style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100vh', minWidth: 0 }}
      >
        <header
          style={{
            flex: 'none',
            // backdrop-filter creates a stacking context, which would otherwise
            // trap the range dropdown below the later-painted page content.
            // Lift the whole header above content (z 0) but keep it under the
            // modals/drawers (z 60) so drilldowns still cover the header bar.
            position: 'relative',
            zIndex: 50,
            background: 'rgba(250,250,248,.92)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            className="cc-header-pad"
            style={{
              maxWidth: 1240,
              margin: '0 auto',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 24,
            }}
          >
            <button
              className="cc-hamburger"
              aria-label="Open menu"
              onClick={() => setDrawerOpen(true)}
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#39424F"
                strokeWidth="1.8"
                strokeLinecap="round"
              >
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 10,
                  letterSpacing: '.14em',
                  textTransform: 'uppercase',
                  color: '#A0885E',
                  fontWeight: 500,
                  marginBottom: 5,
                }}
              >
                {viewMeta.eyebrow}
              </div>
              <h1
                style={{
                  fontFamily: FONT,
                  fontWeight: 300,
                  fontSize: 27,
                  lineHeight: 1,
                  letterSpacing: '-.01em',
                  color: '#1B2430',
                  margin: 0,
                }}
              >
                {viewMeta.title}
              </h1>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 'none' }}>
              <div data-range="" style={{ position: 'relative' }}>
                <button
                  aria-busy={rangeRefreshing}
                  onClick={() => setRangeOpen((o) => !o)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 9,
                    fontFamily: FONT,
                    fontSize: 11.5,
                    color: '#39424F',
                    border: '1px solid #E7E5DF',
                    background: '#FFFFFF',
                    borderRadius: 999,
                    padding: '7px 13px',
                    cursor: 'pointer',
                  }}
                >
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#8A6A2A"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2"></rect>
                    <line x1="3" y1="9" x2="21" y2="9"></line>
                    <line x1="8" y1="2" x2="8" y2="6"></line>
                    <line x1="16" y1="2" x2="16" y2="6"></line>
                  </svg>
                  {rangeRefreshing ? (
                    <span
                      aria-hidden
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        border: '2px solid #E7E5DF',
                        borderTopColor: '#8A6A2A',
                        display: 'inline-block',
                        animation: 'cc-spin 0.72s linear infinite',
                        flex: 'none',
                      }}
                    />
                  ) : null}
                  <span>{rangeLabel}</span>
                  {rangeRefreshing ? (
                    <span
                      style={{
                        fontFamily: FONT,
                        fontSize: 9,
                        letterSpacing: '.08em',
                        textTransform: 'uppercase',
                        color: '#8A6A2A',
                        background: '#F7F1E6',
                        borderRadius: 999,
                        padding: '2px 7px',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Live refresh
                    </span>
                  ) : null}
                  <span style={{ color: '#B7BAC0', fontSize: 9 }}>▾</span>
                </button>
                {rangeRefreshing && (
                  <div
                    role="status"
                    aria-live="polite"
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 8px)',
                      width: 286,
                      background: '#FFFFFF',
                      border: '1px solid #E7E5DF',
                      borderRadius: 10,
                      boxShadow: '0 12px 32px rgba(27,36,48,.12)',
                      padding: '12px 14px',
                      zIndex: 70,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        aria-hidden
                        style={{
                          width: 18,
                          height: 18,
                          borderRadius: '50%',
                          border: '2px solid #E7E5DF',
                          borderTopColor: '#8A6A2A',
                          display: 'inline-block',
                          animation: 'cc-spin 0.72s linear infinite',
                          flex: 'none',
                        }}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: '#1B2430' }}>
                          {rangeStatus || 'Refreshing MYOB data'}
                        </span>
                        <span style={{ display: 'block', fontSize: 11.5, color: '#757C86', marginTop: 3, lineHeight: 1.35 }}>
                          Showing cached figures now. Charts and Qwen text will update again when the pull finishes.
                        </span>
                      </span>
                    </div>
                    <div
                      style={{
                        height: 3,
                        borderRadius: 999,
                        background: '#EFEDE7',
                        overflow: 'hidden',
                        marginTop: 11,
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          width: '38%',
                          height: '100%',
                          borderRadius: 999,
                          background: '#C9A24B',
                          animation: 'cc-indeterminate 1.2s ease-in-out infinite',
                        }}
                      />
                    </div>
                  </div>
                )}
                {rangeOpen && (
                  <div
                    style={{
                      position: 'absolute',
                      right: 0,
                      top: 'calc(100% + 8px)',
                      width: 'min(320px, calc(100vw - 36px))',
                      boxSizing: 'border-box',
                      background: '#FFFFFF',
                      border: '1px solid #E7E5DF',
                      borderRadius: 12,
                      boxShadow: '0 22px 48px rgba(27,36,48,.16)',
                      padding: 8,
                      zIndex: 80,
                    }}
                  >
                    {RANGE_OPTIONS.map(([key, label]) => (
                      <button
                        key={key}
                        className="navbtn"
                        onClick={() => pickRange(key)}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          width: '100%',
                          textAlign: 'left',
                          border: 0,
                          background: 'transparent',
                          borderRadius: 8,
                          padding: '9px 11px',
                          cursor: 'pointer',
                          fontFamily: FONT,
                          fontSize: 13,
                          color: '#1B2430',
                        }}
                      >
                        {label}
                        {rangeKey === key && (
                          <span style={{ color: '#8A6A2A', fontSize: 12 }}>✓</span>
                        )}
                      </button>
                    ))}
                    <div style={{ borderTop: '1px solid #EFEDE7', margin: '8px 4px 0', paddingTop: 10 }}>
                      <div
                        style={{
                          fontFamily: FONT,
                          fontSize: 9,
                          letterSpacing: '.12em',
                          textTransform: 'uppercase',
                          color: '#9AA0A8',
                          fontWeight: 500,
                          padding: '0 7px 9px',
                        }}
                      >
                        Custom range
                      </div>
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                          gap: 8,
                          padding: '0 7px',
                        }}
                      >
                        <input
                          ref={customFromRef}
                          type="date"
                          className="fld"
                          aria-invalid={Boolean(customError)}
                          value={customFrom}
                          onChange={(e) => {
                            setCustomFrom(e.target.value);
                            setCustomError('');
                          }}
                          style={{ minWidth: 0, boxSizing: 'border-box', padding: '8px 9px', fontSize: 12.5 }}
                        />
                        <input
                          ref={customToRef}
                          type="date"
                          className="fld"
                          aria-invalid={Boolean(customError)}
                          value={customTo}
                          onChange={(e) => {
                            setCustomTo(e.target.value);
                            setCustomError('');
                          }}
                          style={{ minWidth: 0, boxSizing: 'border-box', padding: '8px 9px', fontSize: 12.5 }}
                        />
                      </div>
                      {customError ? (
                        <div
                          role="alert"
                          style={{
                            fontSize: 11.5,
                            color: '#A8443B',
                            lineHeight: 1.35,
                            padding: '7px 7px 0',
                          }}
                        >
                          {customError}
                        </div>
                      ) : null}
                      <div style={{ padding: '10px 7px 4px' }}>
                        <button
                          onClick={applyCustom}
                          style={{
                            width: '100%',
                            border: 0,
                            borderRadius: 8,
                            background: '#1B2430',
                            color: '#FBFBF9',
                            padding: 9,
                            fontFamily: FONT,
                            fontSize: 12.5,
                            fontWeight: 500,
                            cursor: 'pointer',
                          }}
                        >
                          Apply range
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        <div id="cc-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          <div className="cc-content-pad" style={{ maxWidth: 1240, margin: '0 auto' }}>
            {blockAdmin ? null : children}
          </div>
        </div>
      </main>
    </div>
    </DateRangeContext.Provider>
  );
}

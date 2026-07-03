'use client';

// Cash position view — faithful port of the design's CASH section
// (template.html lines 599-616): source-backed cash discipline messaging with
// pending MYOB/CMF states. Wired per CONTRACT.md to the EXISTING endpoints
// GET /api/cash/position, GET /api/cash/status and GET /api/cash/candidates;
// falls back to the design's exact static content when the backend is
// unreachable.

import { useCallback, useEffect, useState } from 'react';
import { apiGet, type ApiMeta } from '@/lib/api';
import { fmtF } from '@/lib/format';
import MetricRefreshControl from '@/components/MetricRefreshControl';
import type { MetricRefreshDoc } from '@/lib/useMetricRefresh';

const FONT = "var(--font-poppins), 'Poppins', sans-serif";

// ---------- contract types (Cash view slice of /api/cash/*) ----------

interface CashTarget {
  system: string; // "Westpac" | "CMF"
  name: string;
  external_account: string; // always masked "•••• 1234"
  myob_source?: string | null;
  myob_balance?: number | null;
  status?: string;
}

interface RecommendedAccount {
  AccountCD: string;
  Description: string;
}

interface CashPosition {
  generated_at: string | null;
  source_status: string;
  cmf_status: string;
  targets: CashTarget[];
  recommended_myob_accounts: RecommendedAccount[];
}

interface CashStatus {
  source_status: string;
  cmf_status: string;
  probe: { exists: boolean; generated_at: string | null };
  cmf: { exists: boolean; generated_at: string | null };
  dataSource: string;
}

// GET /api/cash/candidates — coalesced cash-account rows from the latest MYOB
// endpoint probe (cashService.js#coalesceCandidate); balance may arrive as a
// number or a raw string depending on which MYOB field was populated.
interface CashCandidate {
  _endpoint: string | null;
  account: string | null;
  description: string | null;
  balance: number | string | null;
  raw: unknown;
}

interface CandidatesPayload {
  generated_at: string | null;
  count: number;
  total: number;
  limit: number;
  offset: number;
  candidates: CashCandidate[];
}

// ---------- per-metric live-pull value shapes (backend metricPullService) ----------

// id "cash-cmf-movement" → doc.value: net CMF movement keyed by account, plus
// the number of ledger lines the scoped pull read. Mirrors Overview's FreshKpi:
// a small local interface so the overlay reads doc.value with clean types.
interface FreshCmfMovement {
  balances_by_account: Record<string, number>;
  line_count: number;
}

// id "cash-gl-movements" → doc.value: per-GL-account net movements for the
// 111xxx cash accounts, with the basis and any data-health warning.
interface FreshGlAccount {
  account: string;
  description: string;
  net_movement: number;
  debit: number;
  credit: number;
  line_count: number;
  myob_source: string;
}

interface FreshGlMovements {
  accounts: FreshGlAccount[];
  basis: string;
  warning: string;
}

// ---------- fallbacks: the design's explicit "no live figures" state ----------

const FALLBACK_POSITION: CashPosition = {
  generated_at: null,
  source_status: 'MYOB cash endpoints not yet refreshed',
  cmf_status: 'CMF cash extractor not yet refreshed',
  targets: [],
  recommended_myob_accounts: [],
};

const FALLBACK_STATUS: CashStatus = {
  source_status: 'pending',
  cmf_status: 'pending',
  probe: { exists: false, generated_at: null },
  cmf: { exists: false, generated_at: null },
  dataSource: 'missing',
};

// Design's static GL candidate chips, used until the backend supplies
// recommended_myob_accounts.
const FALLBACK_CHIPS = ['111200 · Bank (AUD)', '111300 · CMF (AUD)'];

// Candidates table fallback: the empty state renders the explicit
// "no candidates" line (Python parity: generate_cash_position_dashboard.py
// keeps its candidates table open with a no-probe row).
const FALLBACK_CANDIDATES: CandidatesPayload = {
  generated_at: null,
  count: 0,
  total: 0,
  limit: 0,
  offset: 0,
  candidates: [],
};

// Shared-code gap workaround: lib/api.ts#apiGet unwraps the envelope and
// discards `meta`, but this view must render meta.source_rule (contract's
// meta.extra.source_rule, flattened by the envelope's `...meta.extra`) as the
// compliance footnote. Local fetch with the same semantics (no-store, ~3s
// timeout, null on any failure) that keeps the envelope intact.
async function fetchPositionEnvelope(): Promise<{ data: CashPosition; meta: ApiMeta } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch('/api/cash/position', { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return null;
    const body: unknown = await res.json();
    if (
      body &&
      typeof body === 'object' &&
      'data' in (body as Record<string, unknown>) &&
      'meta' in (body as Record<string, unknown>)
    ) {
      const env = body as { data: CashPosition; meta: ApiMeta };
      if (env.data && typeof env.data === 'object') return env;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractSourceRule(meta: ApiMeta): string | null {
  // The backend envelope (src/lib/envelope.js) SPREADS meta.extra into meta,
  // so on the wire the field lives at meta.source_rule (no `extra` key).
  // Keep an extra.source_rule fallback for any non-flattened producer.
  const direct = (meta as Record<string, unknown>).source_rule;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  const extra = meta.extra;
  if (extra && typeof extra === 'object') {
    const rule = (extra as Record<string, unknown>).source_rule;
    if (typeof rule === 'string' && rule.length > 0) return rule;
  }
  return null;
}

// ---------- shared style fragments (verbatim template values) ----------

const microLabel: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
};

const stateCard: React.CSSProperties = {
  border: '1px solid #EFEDE7',
  borderRadius: 9,
  padding: '16px 18px',
};

const chipStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 12,
  color: '#39424F',
  background: '#F5F4EF',
  border: '1px solid #E7E5DF',
  borderRadius: 5,
  padding: '3px 9px',
};

const thStyle: React.CSSProperties = {
  ...microLabel,
  textAlign: 'left',
  padding: '0 12px 8px 0',
};

const tdStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 12.5,
  color: '#39424F',
  padding: '7px 12px 7px 0',
  borderTop: '1px solid #EFEDE7',
  verticalAlign: 'top',
};

const tdMoneyStyle: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  paddingRight: 0,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

// Probe balance fields are whatever MYOB returned (number or raw string);
// only format genuine numbers as currency, never coerce blanks to $0.
function fmtCandidateBalance(value: number | string | null): string {
  if (value === null || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? fmtF(n) : String(value);
}

export default function Cash() {
  const [position, setPosition] = useState<CashPosition>(FALLBACK_POSITION);
  const [status, setStatus] = useState<CashStatus>(FALLBACK_STATUS);
  const [sourceRule, setSourceRule] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<CandidatesPayload>(FALLBACK_CANDIDATES);

  // Fresh per-metric pulls. Each holds the recomputed figure from a scoped MYOB
  // pull so ONLY that card swaps in place, without refetching /api/cash/* or
  // touching the shared caches (mirrors Overview's freshByIndex/applyFresh).
  const [freshCmf, setFreshCmf] = useState<FreshCmfMovement | null>(null);
  const [freshGl, setFreshGl] = useState<FreshGlMovements | null>(null);

  // Stable callbacks (close over nothing mutable) so MetricRefreshControl's
  // onRefreshed effect fires once per pull, never in a render loop.
  const applyCmfFresh = useCallback((doc: MetricRefreshDoc) => {
    const value = doc.value as unknown as FreshCmfMovement;
    if (!value || typeof value !== 'object' || !value.balances_by_account) return;
    setFreshCmf(value);
  }, []);

  const applyGlFresh = useCallback((doc: MetricRefreshDoc) => {
    const value = doc.value as unknown as FreshGlMovements;
    if (!value || !Array.isArray(value.accounts)) return;
    setFreshGl(value);
  }, []);

  useEffect(() => {
    let alive = true;
    // Accounts stay MASKED — never send unmasked=true from this dashboard.
    fetchPositionEnvelope().then((env) => {
      if (!alive || !env) return;
      setPosition({
        ...FALLBACK_POSITION,
        ...env.data,
        targets: Array.isArray(env.data.targets) ? env.data.targets : [],
        recommended_myob_accounts: Array.isArray(env.data.recommended_myob_accounts)
          ? env.data.recommended_myob_accounts
          : [],
      });
      setSourceRule(extractSourceRule(env.meta));
      setWarnings(Array.isArray(env.meta.warnings) ? env.meta.warnings : []);
    });
    apiGet<CashStatus>('/api/cash/status', FALLBACK_STATUS).then((s) => {
      if (alive) setStatus({ ...FALLBACK_STATUS, ...s });
    });
    apiGet<CandidatesPayload>('/api/cash/candidates', FALLBACK_CANDIDATES).then((c) => {
      if (!alive) return;
      setCandidates({
        ...FALLBACK_CANDIDATES,
        ...c,
        candidates: Array.isArray(c.candidates) ? c.candidates : [],
      });
    });
    return () => {
      alive = false;
    };
  }, []);

  // "Pending / refreshed" badges per contract (/api/cash/status probe + cmf).
  const probeRefreshed = Boolean(status.probe && status.probe.exists && status.probe.generated_at);
  const cmfRefreshed = Boolean(status.cmf && status.cmf.exists && status.cmf.generated_at);

  const chips =
    position.recommended_myob_accounts.length > 0
      ? position.recommended_myob_accounts.map((a) => `${a.AccountCD} · ${a.Description}`)
      : FALLBACK_CHIPS;

  const targetsNote =
    position.targets.length > 0
      ? `${position.targets.length} Westpac & CMF accounts are held locally as reconciliation targets only, with full identifiers masked.`
      : '20 Westpac & CMF accounts are held locally as reconciliation targets only, with full identifiers masked.';

  // CMF overlay: on a fresh pull, sum the per-account CMF net movement and show
  // it in place inside the CMF lane card. Absent a pull, the card keeps its
  // source-status text untouched (the default apiGet payload).
  const cmfMovementTotal = freshCmf
    ? Object.values(freshCmf.balances_by_account).reduce((sum, n) => sum + (Number.isFinite(n) ? n : 0), 0)
    : null;

  // GL overlay: index fresh per-account net movements by AccountCD so the
  // candidates table can swap ONLY the balance column for accounts the pull
  // covers, leaving un-pulled rows on their probe value.
  const glByAccount = freshGl
    ? new Map(freshGl.accounts.map((a) => [a.account, a]))
    : null;

  return (
    <div>
      <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: 32 }}>
        <h3
          style={{
            fontFamily: FONT,
            fontWeight: 300,
            fontSize: 26,
            lineHeight: 1.2,
            color: '#1B2430',
            margin: '0 0 12px',
          }}
        >
          No live cash balance is published here.
        </h3>
        <p
          style={{
            fontSize: 14,
            lineHeight: 1.6,
            color: '#5B626C',
            margin: '0 0 26px',
            maxWidth: 640,
            fontWeight: 300,
          }}
        >
          By design, cash-on-hand is only shown once it is source-backed from MYOB. Bank and CMF
          screenshot balances are held as reconciliation targets — never surfaced as actuals, and
          never used to make a liquidity claim.
        </p>

        <div className="cc-grid-2" style={{ gap: 14, marginBottom: 26 }}>
          <div style={stateCard}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div style={microLabel}>Source now</div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 9,
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                  color: probeRefreshed ? '#3E7A55' : '#A8443B',
                }}
              >
                {probeRefreshed ? 'Refreshed' : 'Pending'}
              </div>
            </div>
            <div style={{ fontSize: 14, color: '#39424F', lineHeight: 1.4 }}>
              {position.source_status}
            </div>
          </div>
          <div style={stateCard}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                gap: 10,
                marginBottom: 8,
              }}
            >
              <div style={microLabel}>CMF lane</div>
              <div
                style={{
                  fontFamily: FONT,
                  fontSize: 9,
                  letterSpacing: '.05em',
                  textTransform: 'uppercase',
                  fontWeight: 500,
                  color: cmfRefreshed || freshCmf ? '#3E7A55' : '#A8443B',
                }}
              >
                {cmfRefreshed || freshCmf ? 'Refreshed' : 'Pending'}
              </div>
            </div>
            {cmfMovementTotal !== null ? (
              <div>
                <div
                  style={{
                    fontFamily: FONT,
                    fontWeight: 300,
                    fontSize: 24,
                    lineHeight: 1,
                    color: '#1B2430',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {fmtF(cmfMovementTotal)}
                </div>
                <div style={{ fontSize: 12, color: '#757C86', lineHeight: 1.4, marginTop: 6 }}>
                  Net CMF movement · {freshCmf?.line_count ?? 0} lines
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: '#39424F', lineHeight: 1.4 }}>
                {position.cmf_status}
              </div>
            )}
            <div style={{ marginTop: 12, paddingTop: 11, borderTop: '1px solid #EFEDE7' }}>
              <MetricRefreshControl
                id="cash-cmf-movement"
                endpoint="/myob/metrics/cash-cmf-movement/pull"
                onRefreshed={applyCmfFresh}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={microLabel}>Primary GL candidates</span>
          {chips.map((chip) => (
            <span key={chip} style={chipStyle}>
              {chip}
            </span>
          ))}
        </div>

        {position.targets.length > 0 ? (
          <div style={{ marginTop: 26 }}>
            <div style={{ ...microLabel, marginBottom: 10 }}>
              Reconciliation targets — not source balances
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>System</th>
                    <th style={thStyle}>Name</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>MYOB match</th>
                    <th style={{ ...thStyle, textAlign: 'right', paddingRight: 0 }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {position.targets.map((t) => (
                    <tr key={`${t.system}-${t.name}-${t.external_account}`}>
                      <td style={tdStyle}>{t.system}</td>
                      <td style={tdStyle}>{t.name}</td>
                      {/* Already masked by the backend; no unmasked lookup exists here. */}
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{t.external_account}</td>
                      <td style={{ ...tdStyle, ...(t.myob_source ? {} : { color: '#9AA0A8' }) }}>
                        {t.myob_source ?? 'Awaiting MYOB endpoint match'}
                      </td>
                      <td style={tdMoneyStyle}>
                        {t.myob_balance == null ? '—' : fmtF(t.myob_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div style={{ marginTop: 26 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 10,
            }}
          >
            <div style={microLabel}>
              MYOB cash account candidates
              {candidates.generated_at ? ` — probe ${candidates.generated_at.slice(0, 10)}` : ''}
              {glByAccount ? ` · GL movements ${freshGl?.basis ?? ''}`.trimEnd() : ''}
            </div>
            <MetricRefreshControl
              id="cash-gl-movements"
              endpoint="/myob/metrics/cash-gl-movements/pull"
              onRefreshed={applyGlFresh}
            />
          </div>
          {freshGl?.warning ? (
            <div style={{ fontFamily: FONT, fontSize: 12, color: '#8A6A2A', marginBottom: 10, lineHeight: 1.45 }}>
              {freshGl.warning}
            </div>
          ) : null}
          {candidates.candidates.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Endpoint</th>
                    <th style={thStyle}>Account</th>
                    <th style={thStyle}>Description</th>
                    <th style={{ ...thStyle, textAlign: 'right', paddingRight: 0 }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {candidates.candidates.map((c, i) => {
                    // Overlay ONLY this row's balance when the fresh GL pull
                    // covers its account; other rows keep their probe value.
                    const gl = c.account ? glByAccount?.get(c.account) : undefined;
                    return (
                    <tr key={`${c._endpoint ?? ''}-${c.account ?? ''}-${i}`}>
                      <td style={tdStyle}>{c._endpoint ?? '—'}</td>
                      <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>{c.account ?? '—'}</td>
                      <td style={tdStyle}>{c.description ?? '—'}</td>
                      <td style={tdMoneyStyle}>
                        {gl ? fmtF(gl.net_movement) : fmtCandidateBalance(c.balance)}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ fontFamily: FONT, fontSize: 12.5, color: '#9AA0A8' }}>
              No cash-account candidates in the latest probe.
            </div>
          )}
        </div>

        <div
          style={{
            borderTop: '1px solid #EFEDE7',
            marginTop: 26,
            paddingTop: 18,
            fontSize: 12.5,
            color: '#9AA0A8',
            lineHeight: 1.5,
          }}
        >
          {targetsNote}
          {sourceRule ? (
            <div style={{ marginTop: 6 }}>{sourceRule}</div>
          ) : null}
          {warnings.map((warning) => (
            <div key={warning} style={{ marginTop: 6, color: '#8A6A2A' }}>
              {warning}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

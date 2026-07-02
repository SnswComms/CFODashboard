'use client';

// Cash position view — faithful port of the design's CASH section
// (template.html lines 599-616): source-backed cash discipline messaging with
// pending MYOB/CMF states. Wired per CONTRACT.md to the EXISTING endpoints
// GET /api/cash/position and GET /api/cash/status; falls back to the design's
// exact static content when the backend is unreachable.

import { useEffect, useState } from 'react';
import { apiGet, type ApiMeta } from '@/lib/api';

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

export default function Cash() {
  const [position, setPosition] = useState<CashPosition>(FALLBACK_POSITION);
  const [status, setStatus] = useState<CashStatus>(FALLBACK_STATUS);
  const [sourceRule, setSourceRule] = useState<string | null>(null);

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
    });
    apiGet<CashStatus>('/api/cash/status', FALLBACK_STATUS).then((s) => {
      if (alive) setStatus({ ...FALLBACK_STATUS, ...s });
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

  return (
    <div style={{ maxWidth: 780, margin: '0 auto' }}>
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

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 26 }}>
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
                  color: cmfRefreshed ? '#3E7A55' : '#A8443B',
                }}
              >
                {cmfRefreshed ? 'Refreshed' : 'Pending'}
              </div>
            </div>
            <div style={{ fontSize: 14, color: '#39424F', lineHeight: 1.4 }}>
              {position.cmf_status}
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
        </div>
      </div>
    </div>
  );
}

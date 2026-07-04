'use client';

// "Data sources" view — evidence registry + source freshness.
// Faithful port of template.html lines 621-645 (isSources section) and the
// sources block of app-script.js. Data: GET /api/command-centre/sources with
// designData fallback (per contract §9).
//
// Below the design's two columns, three trust-panel sections render from the
// entity routes (evidence-registry detail, finance source lanes, history/trend
// readiness); each hides entirely when its fetch fails, so the page still
// degrades to the original design rendering.

import { useCallback, useState } from 'react';
import { useApiGet } from '@/lib/api';
import { useDateRange } from '@/lib/dateRange';
import { color, fmtF, FONT, tint } from '@/lib/format';
import MyobRefreshPanel from '@/components/MyobRefreshPanel';
import MetricRefreshControl from '@/components/MetricRefreshControl';
import type { MetricRefreshDoc } from '@/lib/useMetricRefresh';
import {
  evidence as evidenceFallback,
  freshnessFull as freshnessFallback,
  type EvidenceDef,
  type FreshnessFullDef,
} from '@/lib/designData';

// ---------------------------------------------------------------------------
// API payload (contract §9) and mapping to the design's row shapes
// ---------------------------------------------------------------------------

interface SourcesPayload {
  generated_at: string | null;
  evidence: Array<{
    label: string;
    value: string;
    basis: string;
    confidence: 'High' | 'Medium';
  }>;
  freshness: Array<{
    name: string;
    status: string;
    tone: 'good' | 'warn' | 'bad';
    note: string;
  }>;
}

// Fallback expressed in the API's own shape so one mapping path serves both
// the live payload and the dead-backend case (rendering stays pixel-identical).
const FALLBACK: SourcesPayload = {
  generated_at: null,
  evidence: evidenceFallback.map((e) => ({
    label: e.label,
    value: e.value,
    basis: e.basis,
    confidence: e.conf,
  })),
  freshness: freshnessFallback.map((f) => ({
    name: f.name,
    status: f.status,
    tone: f.color === '#3E7A55' ? 'good' : f.color === '#8A6A2A' ? 'warn' : 'bad',
    note: f.note,
  })),
};

// The benefits-balance per-metric pull (MYOB account 312510) overlays the one
// evidence row whose label names 312510. `value` is the recomputed balance +
// as-of + transaction count (backend metricPullService.computeBenefits).
interface FreshBenefits {
  account_balance: number;
  account_as_of: string;
  transaction_count: number;
}
const BENEFITS_METRIC_ID = 'benefits-balance';

function toEvidenceRows(p: SourcesPayload): EvidenceDef[] {
  return p.evidence.map((e) => ({
    label: e.label,
    value: e.value,
    basis: e.basis,
    conf: e.confidence,
    confColor: e.confidence === 'High' ? '#3E7A55' : '#8A6A2A',
  }));
}

function toFreshnessRows(p: SourcesPayload): FreshnessFullDef[] {
  return p.freshness.map((f) => ({
    name: f.name,
    status: f.status,
    color: color(f.tone),
    note: f.note,
  }));
}

// ---------------------------------------------------------------------------
// Trust-panel payloads (routes/entities.js). All three are pagedDocList
// shapes — header fields + rows array + total/limit/offset — served from the
// dashboards data dir with a fixture fallback. Each section renders only when
// its fetch succeeds (fallback null), so a dead backend degrades this page to
// exactly the two-column rendering above.
// ---------------------------------------------------------------------------

// GET /api/evidence-registry — point-in-time evidence documents. Values carry
// their own period stamps (the registry is a doc, not the live cache), so
// staleness is self-evident next to the live extract counts above.
interface RegistryMetric {
  metric_id: string;
  label: string;
  value: number | string | null;
  unit?: string;
  period?: string;
  basis?: string;
  confidence?: string;
  status?: string;
  sources?: Array<{ type?: string; locator?: string; endpoint?: string }>;
  notes?: string;
}
interface RegistryPayload {
  generated_at: string | null;
  schema: string | null;
  metrics: RegistryMetric[];
  total: number;
  limit: number;
  offset: number;
}

// GET /api/finance-sources — the finance source-lane inventory.
interface FinanceLane {
  id: string;
  name: string;
  status: string;
  coverage: string;
  role: string;
  next: string;
  source_truth: string[];
  risk: string;
  confidence: string;
}
interface FinanceSourcesPayload {
  generated_at: string | null;
  lanes: FinanceLane[];
  total: number;
  limit: number;
  offset: number;
}

// GET /api/history-comparison — per-area trend readiness; the guard against
// charts claiming multi-year trends that no indexed source can back.
interface HistoryRow {
  area: string;
  status: string;
  period: string;
  what: string;
  link: string;
  source: string;
}
interface HistoryComparisonPayload {
  generated_at: string | null;
  rows: HistoryRow[];
  total: number;
  limit: number;
  offset: number;
}

// Registry values: AUD renders as currency (negatives in parentheses), other
// units keep their unit word; non-numeric values pass through as-is.
function registryValue(m: RegistryMetric): string {
  if (typeof m.value !== 'number') return String(m.value ?? '—');
  if (m.unit === 'AUD') return fmtF(m.value);
  const n = m.value.toLocaleString('en-US');
  return m.unit ? `${n} ${m.unit}` : n;
}

// Lane/registry confidence strings are freeform ("high", "medium", "high for
// catalogue, low/medium ..."); tone keys off the leading word.
function confidenceTone(confidence: string | undefined): 'good' | 'warn' | 'bad' {
  const c = (confidence ?? '').toLowerCase();
  return c.startsWith('high') ? 'good' : c.startsWith('low') ? 'bad' : 'warn';
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

const colLabelStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
  marginBottom: 16,
};

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E7E5DF',
  borderRadius: 10,
  overflow: 'hidden',
};

const mutedLineStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: '#9AA0A8',
  lineHeight: 1.4,
};

const statusTagStyle = (tone: string): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  color: color(tone),
});

export default function Sources() {
  const dateRange = useDateRange();
  const payload = useApiGet<SourcesPayload>(`/command-centre/sources?${dateRange.query}`, FALLBACK);
  const rows = { evidence: toEvidenceRows(payload), freshness: toFreshnessRows(payload) };
  // Trust-panel feeds; null fallback hides each section (page degrades to the
  // two-column layout above, pixel-identical to the design rendering).
  const registry = useApiGet<RegistryPayload | null>('/api/evidence-registry', null);
  const lanes = useApiGet<FinanceSourcesPayload | null>('/api/finance-sources', null);
  const history = useApiGet<HistoryComparisonPayload | null>('/api/history-comparison', null);

  // Per-metric live pull for the benefits balance (MYOB account 312510). The
  // 312510 evidence row carries its own refresh control; a fresh pull overlays
  // only that row's value in place, leaving the rest of the registry on the
  // base /command-centre/sources payload.
  const [freshBenefits, setFreshBenefits] = useState<FreshBenefits | null>(null);
  const applyBenefits = useCallback((doc: MetricRefreshDoc) => {
    const v = doc.value as unknown as FreshBenefits;
    if (!v || typeof v.account_balance !== 'number') return;
    setFreshBenefits(v);
  }, []);

  return (
    <div>
      <p
        style={{
          fontSize: 13.5,
          color: '#757C86',
          margin: payload.generated_at ? '0 0 8px' : '0 0 28px',
          maxWidth: 640,
          lineHeight: 1.5,
        }}
      >
        Every figure traces to a source. This registry tracks what is source-backed now, its
        confidence, and which feeds still need a refresh.
      </p>
      {payload.generated_at && (
        <div style={{ ...mutedLineStyle, margin: '0 0 20px' }}>
          Generated {payload.generated_at.slice(0, 10)}
        </div>
      )}
      <div style={{ margin: '0 0 28px' }}>
        <MyobRefreshPanel />
      </div>
      <div className="cc-grid-stack" style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 26, alignItems: 'start' }}>
        <div>
          <div style={colLabelStyle}>Evidence registry</div>
          <div style={cardStyle}>
            {rows.evidence.map((e) => {
              // The one evidence row backed by a per-metric pull: account 312510.
              const isBenefits = /312510/.test(e.label);
              const displayValue =
                isBenefits && freshBenefits ? fmtF(freshBenefits.account_balance) : e.value;
              return (
                <div
                  key={e.label}
                  style={{
                    padding: '15px 17px',
                    borderBottom: '1px solid #EFEDE7',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 14,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: '#1B2430', marginBottom: 3 }}>{e.label}</div>
                    <div style={{ fontSize: 11.5, color: '#9AA0A8', lineHeight: 1.4 }}>{e.basis}</div>
                    {isBenefits && (
                      <div style={{ marginTop: 8 }}>
                        <MetricRefreshControl
                          id={BENEFITS_METRIC_ID}
                          endpoint={`/myob/metrics/${BENEFITS_METRIC_ID}/pull`}
                          onRefreshed={applyBenefits}
                        />
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 16, color: '#1B2430', fontVariantNumeric: 'tabular-nums' }}>
                      {displayValue}
                    </div>
                    <div
                      style={{
                        fontFamily: FONT,
                        fontSize: 9,
                        letterSpacing: '.05em',
                        textTransform: 'uppercase',
                        color: e.confColor,
                        marginTop: 3,
                      }}
                    >
                      {e.conf}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div style={colLabelStyle}>Source freshness</div>
          <div style={cardStyle}>
            {rows.freshness.map((f) => (
              <div key={f.name} style={{ padding: '14px 16px', borderBottom: '1px solid #EFEDE7' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontSize: 13, color: '#1B2430' }}>{f.name}</span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      fontFamily: FONT,
                      fontSize: 9,
                      letterSpacing: '.06em',
                      textTransform: 'uppercase',
                      color: f.color,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: f.color }} />
                    {f.status}
                  </span>
                </div>
                <div style={{ fontSize: 11.5, color: '#9AA0A8', lineHeight: 1.4 }}>{f.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {registry && registry.metrics.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={colLabelStyle}>Evidence detail — point-in-time registry</div>
          <div style={cardStyle}>
            {registry.metrics.map((m) => {
              const locator = m.sources?.[0]?.locator;
              return (
                <div
                  key={m.metric_id}
                  style={{
                    padding: '15px 17px',
                    borderBottom: '1px solid #EFEDE7',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: 14,
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, color: '#1B2430', marginBottom: 3 }}>{m.label}</div>
                    <div style={mutedLineStyle}>
                      {m.basis}
                      {locator ? ` · ${locator}` : ''}
                    </div>
                    {m.period && <div style={{ ...mutedLineStyle, marginTop: 2 }}>{m.period}</div>}
                    {m.notes && (
                      <div style={{ ...mutedLineStyle, color: '#8A6A2A', marginTop: 4 }}>{m.notes}</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flex: 'none' }}>
                    <div style={{ fontSize: 16, color: '#1B2430', fontVariantNumeric: 'tabular-nums' }}>
                      {registryValue(m)}
                    </div>
                    <div
                      style={{
                        fontFamily: FONT,
                        fontSize: 9,
                        letterSpacing: '.05em',
                        textTransform: 'uppercase',
                        color: color(confidenceTone(m.confidence)),
                        marginTop: 3,
                      }}
                    >
                      {m.confidence}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {lanes && lanes.lanes.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={colLabelStyle}>Source lanes</div>
          <div style={cardStyle}>
            {lanes.lanes.map((lane) => (
              <div key={lane.id} style={{ padding: '15px 17px', borderBottom: '1px solid #EFEDE7' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 14,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ fontSize: 13.5, color: '#1B2430' }}>{lane.name}</span>
                  <span style={{ ...statusTagStyle(confidenceTone(lane.confidence)), textAlign: 'right' }}>
                    {lane.confidence}
                  </span>
                </div>
                <div
                  style={{
                    display: 'inline-block',
                    padding: '3px 9px',
                    borderRadius: 8,
                    background: tint(''),
                    fontSize: 10.5,
                    color: '#757C86',
                    lineHeight: 1.4,
                    marginBottom: 7,
                  }}
                >
                  {lane.status}
                </div>
                {(
                  [
                    ['Coverage', lane.coverage],
                    ['Role', lane.role],
                    ['Next', lane.next],
                    ['Risk', lane.risk],
                  ] as const
                ).map(([label, text]) => (
                  <div key={label} style={{ ...mutedLineStyle, marginTop: 2 }}>
                    <span style={{ color: label === 'Risk' ? '#8A6A2A' : '#757C86' }}>{label}</span>
                    {' — '}
                    {text}
                  </div>
                ))}
                <details style={{ marginTop: 7 }}>
                  <summary style={{ fontSize: 11, color: '#757C86', cursor: 'pointer' }}>
                    Source-of-truth paths ({lane.source_truth.length})
                  </summary>
                  <ul style={{ margin: '5px 0 0', paddingLeft: 18 }}>
                    {lane.source_truth.map((p) => (
                      <li key={p} style={{ ...mutedLineStyle, lineHeight: 1.5 }}>
                        {p}
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}
      {history && history.rows.length > 0 && (
        <div style={{ marginTop: 30 }}>
          <div style={colLabelStyle}>History &amp; trend readiness</div>
          <div style={cardStyle}>
            {history.rows.map((r) => (
              <div key={r.area} style={{ padding: '14px 16px', borderBottom: '1px solid #EFEDE7' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    marginBottom: 3,
                  }}
                >
                  <span style={{ fontSize: 13, color: '#1B2430' }}>{r.area}</span>
                  <span style={statusTagStyle(r.status.startsWith('Available') ? 'good' : 'warn')}>
                    <span
                      style={{
                        width: 5,
                        height: 5,
                        borderRadius: '50%',
                        flex: 'none',
                        background: color(r.status.startsWith('Available') ? 'good' : 'warn'),
                      }}
                    />
                    {r.status}
                  </span>
                </div>
                <div style={{ ...mutedLineStyle, fontFamily: FONT, fontSize: 10.5, marginBottom: 3 }}>
                  {r.period}
                </div>
                <div style={mutedLineStyle}>{r.what}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

// "Operating position" view — faithful port of the design's operating section
// (template.html lines 338-416): 4-column KPI grid, observation sentence,
// expense donut + budget-vs-spend composition bars, and function pace bars.
// Data: GET /api/command-centre/functions with a designData-shaped fallback so
// the view renders the exact design figures when the backend is unreachable.

import { useCallback, useState } from 'react';
import { useApiGet, useApiGetEnvelopeState } from '@/lib/api';
import { useDateRange } from '@/lib/dateRange';
import { fmtC, fmtF, color, tint, FONT } from '@/lib/format';
import MetricRefreshControl from '@/components/MetricRefreshControl';
import type { MetricRefreshDoc } from '@/lib/useMetricRefresh';
// Contract types (GET /api/command-centre/functions, §2) and the design-figure
// fallback are shared with the Overview view via lib/commandCentre.
import { OPERATING_FALLBACK as FALLBACK } from '@/lib/commandCentre';
import type { OperatingPayload, OpFunction, OpMonthly } from '@/lib/commandCentre';

// ---------------------------------------------------------------------------
// Chart math, ported verbatim from the design's app-script.js
// ---------------------------------------------------------------------------

interface DonutSeg {
  color: string;
  dash: string;
  offset: string;
  name: string;
  amountFmt: string;
  pct: string;
}

/** 6-segment donut: top 5 functions by budget + "Other functions"; C = 2*PI*48. */
function buildDonut(functions: OpFunction[]): { segs: DonutSeg[]; center: string } {
  const sorted = [...functions].sort((a, b) => b.budget - a.budget);
  const items: Array<[string, number]> = sorted.slice(0, 5).map((f) => [f.name, f.budget]);
  items.push(['Other functions', sorted.slice(5).reduce((a, f) => a + f.budget, 0)]);
  const C = 2 * Math.PI * 48;
  const total = items.reduce((a, x) => a + x[1], 0) || 1;
  const ramp = ['#1B2430', '#41566C', '#6E7788', '#9AA0AC', '#8A6A2A', '#C6CAD1'];
  let dacc = 0;
  const segs = items.map((it, i) => {
    const share = it[1] / total, len = share * C;
    const seg: DonutSeg = {
      color: ramp[i],
      dash: len.toFixed(1) + ' ' + (C - len).toFixed(1),
      offset: (-dacc).toFixed(1),
      name: it[0],
      amountFmt: fmtC(it[1]),
      pct: Math.round(share * 100) + '%',
    };
    dacc += len;
    return seg;
  });
  return { segs, center: fmtC(total) };
}

interface MonthlyChartPoint {
  row: OpMonthly;
  x: number;
  incomeY: number | null;
  expenseY: number | null;
  netY: number | null;
}

function buildMonthlyChart(monthly: OpMonthly[]) {
  const rows = monthly.length > 0 ? monthly : FALLBACK.monthly ?? [];
  const values = rows.flatMap((row) => [row.income, row.expense, row.net]).filter((value): value is number => typeof value === 'number');
  const maxValue = Math.max(...values, 1);
  const minValue = Math.min(...values, 0);
  const ceiling = Math.ceil(maxValue / 500000) * 500000 || 500000;
  const floor = minValue < 0 ? Math.floor(minValue / 500000) * 500000 : 0;
  const width = 760;
  const height = 270;
  const pad = { left: 58, right: 22, top: 18, bottom: 44 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const range = ceiling - floor || 1;
  const y = (value: number) => pad.top + ((ceiling - value) / range) * plotH;
  const x = (index: number) => pad.left + (index / Math.max(1, rows.length - 1)) * plotW;
  const baseline = y(0);
  const points: MonthlyChartPoint[] = rows.map((row, index) => ({
    row,
    x: x(index),
    incomeY: row.income === null ? null : y(row.income),
    expenseY: row.expense === null ? null : y(row.expense),
    netY: row.net === null ? null : y(row.net),
  }));
  const netLine = points
    .filter((point) => point.netY !== null)
    .map((point) => `${point.x.toFixed(1)},${point.netY!.toFixed(1)}`)
    .join(' ');
  const latest = [...rows].reverse().find((row) => typeof row.income === 'number' || typeof row.expense === 'number' || typeof row.net === 'number') ?? null;
  return { width, height, baseline, points, netLine, floor, ceiling, latest };
}

// ---------------------------------------------------------------------------
// Per-metric key-account drilldown refresh (GET /api/myob/metrics catalog +
// POST /api/myob/metrics/<id>/pull). The set of key-account codes lives in the
// backend registry, not here — we fetch the catalog and keep only the operating
// drilldown metrics, so the UI stays in lock-step with the registry. Each row
// then owns a scoped, read-only MYOB pull that overlays that one account's fresh
// figure in place without refetching the operating payload or shared caches.
// ---------------------------------------------------------------------------

// Catalog entry shape (envelope data = { count, metrics: [...] }); useApiGet
// already unwraps the envelope's data.
interface MetricCatalogEntry {
  id: string;
  label: string;
  view: string;
  myob_scope: string;
  compute_source: string;
  cache_file: string;
}

interface MetricCatalog {
  count: number;
  metrics: MetricCatalogEntry[];
}

const METRIC_CATALOG_FALLBACK: MetricCatalog = { count: 0, metrics: [] };

interface DrilldownIndexItem {
  account: string;
  label: string | null;
  bill_lines: number;
  bill_total: number;
  journal_lines: number;
  journal_net: number;
  generated_at: string | null;
}

interface DrilldownIndex {
  items: DrilldownIndexItem[];
}

const DRILLDOWN_INDEX_FALLBACK: DrilldownIndex = { items: [] };

const DRILLDOWN_PREFIX = 'account-drilldown-';

// The fresh figure a drilldown pull hands back (backend
// metricPullService: buildAccountDrilldown). We surface the net debit and the
// journal-line scan count once a pull lands.
interface DrilldownDerived {
  journal_line_count: number;
  journal_debit_total: number;
  journal_credit_total: number;
  journal_net_debit: number;
}

interface DrilldownValue {
  account: string;
  derived: DrilldownDerived;
  journals_scanned: number;
}

// A drilldown metric row: the catalog entry plus its stripped account code.
interface DrilldownMetric {
  id: string;
  label: string;
  code: string;
}

// The fresh per-metric figure we hold locally after a pull, keyed by metric id.
interface FreshDrilldown {
  netFmt: string;
  journalsScanned: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Operating() {
  const dateRange = useDateRange();
  const { env, failed } = useApiGetEnvelopeState<OperatingPayload>(`/command-centre/functions?${dateRange.query}`);
  const data = env?.data ?? FALLBACK;
  const dataWarnings = env?.meta.warnings ?? [];

  // Per-metric pull catalog, filtered to the operating drilldown metrics. The
  // code is the id with the `account-drilldown-` prefix stripped.
  const catalog = useApiGet<MetricCatalog>('/myob/metrics', METRIC_CATALOG_FALLBACK);
  const drilldownIndex = useApiGet<DrilldownIndex>('/myob/drilldowns', DRILLDOWN_INDEX_FALLBACK);
  const indexedByCode = new Map((drilldownIndex.items ?? []).map((item) => [item.account, item]));
  const catalogDrilldowns: DrilldownMetric[] = (catalog.metrics ?? [])
    .filter((m) => m.view === 'operating' && m.id.startsWith(DRILLDOWN_PREFIX))
    .map((m) => ({ id: m.id, label: m.label, code: m.id.slice(DRILLDOWN_PREFIX.length) }));
  const catalogCodes = new Set(catalogDrilldowns.map((d) => d.code));
  const summaryOnlyDrilldowns: DrilldownMetric[] = (drilldownIndex.items ?? [])
    .filter((item) => item.account && !catalogCodes.has(item.account))
    .map((item) => ({
      id: `${DRILLDOWN_PREFIX}${item.account}`,
      label: `${item.label ?? `Account ${item.account}`} drilldown (${item.account})`,
      code: item.account,
    }));
  const drilldowns: DrilldownMetric[] = [...catalogDrilldowns, ...summaryOnlyDrilldowns];

  // Fresh per-metric pulls keyed by metric id: a refresh writes the recomputed
  // net figure here so ONLY that row swaps, without refetching the operating
  // payload or touching the shared caches (mirrors Overview's applyFresh).
  const [freshById, setFreshById] = useState<Record<string, FreshDrilldown>>({});

  // Stable callback that records the fresh drilldown figure under its metric id.
  const applyFresh = useCallback((id: string, doc: MetricRefreshDoc) => {
    const v = doc.value as unknown as DrilldownValue;
    if (!v || !v.derived || typeof v.derived.journal_net_debit !== 'number') return;
    setFreshById((prev) => ({
      ...prev,
      [id]: { netFmt: fmtF(v.derived.journal_net_debit), journalsScanned: v.journals_scanned },
    }));
  }, []);

  const elapsed = data.period?.elapsed_pct ?? 42;

  // Template's noteColor: tone-driven, with neutral rendered as the muted grey.
  const kpiCells = (data.kpis ?? FALLBACK.kpis).map((k) => ({
    eyebrow: k.eyebrow,
    value: k.value,
    note: k.note,
    noteColor: k.tone === 'neutral' ? '#757C86' : color(k.tone),
  }));

  const comp = data.composition ?? FALLBACK.composition;

  const composition = comp.map((c) => {
    const pct = Math.round((c.spent / c.approved) * 100);
    return {
      label: c.label,
      approvedFmt: fmtC(c.approved),
      spentFmt: fmtC(c.spent),
      pct: pct + '%',
      pctLabel: pct + '%',
      color: color(c.tone),
      paceLabel: (c.spent / c.approved) * 100 > elapsed ? 'ahead of elapsed-year pace' : 'at or under pace',
    };
  });

  const fns = data.functions ?? FALLBACK.functions;
  const donut = buildDonut(fns);

  // Each bar is a single horizontal display: full track = that function's own
  // allocated budget (light status tint), fill = spend as a share of its OWN
  // budget (strong status colour), so allocated-vs-spent reads directly. The
  // pace marker sits at elapsed% of the bar (elapsed-year pace of that budget),
  // now aligned across every row. Over-budget clamps the fill to 100%.
  const sortedFns = [...fns].sort((a, b) => b.budget - a.budget);
  const paceW = Math.max(0, Math.min(100, elapsed)).toFixed(1) + '%';
  const monthlyChart = buildMonthlyChart(data.monthly ?? FALLBACK.monthly ?? []);
  const functionBars = sortedFns.slice(0, 8).map((f) => ({
    name: f.name,
    usedFmt: f.used_pct + '%',
    budgetFmt: fmtC(f.budget),
    spentFmt: fmtC(f.spent),
    spentW: Math.max(0, Math.min(100, f.used_pct)).toFixed(1) + '%',
    allocColor: f.status === 'over' ? tint('bad') : f.status === 'tight' ? tint('warn') : tint('neutral'),
    spentColor: f.status === 'over' ? '#A8443B' : f.status === 'tight' ? '#8A6A2A' : '#1B2430',
  }));

  // Pressure watchlist: lowest remaining first, so overruns (negative remaining)
  // surface at the top with their dollar amounts — including small functions the
  // top-8-by-budget bars never show.
  const watchlist = [...fns]
    .sort((a, b) => a.remaining - b.remaining)
    .slice(0, 8)
    .map((f) => ({
      name: f.name,
      budgetFmt: fmtF(f.budget),
      spentFmt: fmtF(f.spent),
      remainingFmt: fmtF(f.remaining),
      remainingColor: f.remaining < 0 ? '#A8443B' : '#39424F',
      usedFmt: f.used_pct + '%',
    }));

  const eyebrowStyle: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 10,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: '#9AA0A8',
    fontWeight: 500,
  };

  return (
    <div>
      {dataWarnings.length > 0 && (
        <div
          role="status"
          style={{
            border: '1px solid #E4D3A1',
            background: '#FFF8E8',
            color: '#6F551D',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 22,
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          {dataWarnings[0]}
        </div>
      )}
      {failed && !env && (
        <div
          role="status"
          style={{
            border: '1px solid #E4D3A1',
            background: '#FFF8E8',
            color: '#6F551D',
            borderRadius: 8,
            padding: '12px 14px',
            marginBottom: 22,
            fontSize: 12.5,
            lineHeight: 1.45,
          }}
        >
          Live operating data could not be loaded. Showing fallback design figures until the backend responds.
        </div>
      )}

      {/* Operating KPI grid (template.html lines 340-348) */}
      <div className="cc-grid-4" style={{ gap: 34, borderTop: '1px solid #E7E5DF', paddingTop: 28, marginBottom: 38 }}>
        {kpiCells.map((k) => (
          <div key={k.eyebrow}>
            <div style={eyebrowStyle}>{k.eyebrow}</div>
            <div style={{ fontFamily: FONT, fontWeight: 300, fontSize: 38, lineHeight: 1, color: '#1B2430', fontVariantNumeric: 'tabular-nums', margin: '13px 0 7px' }}>
              {k.value}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.4, color: k.noteColor }}>{k.note}</div>
          </div>
        ))}
      </div>

      {/* Observation sentence */}
      <div style={{ borderTop: '1px solid #E7E5DF', borderBottom: '1px solid #E7E5DF', padding: '24px 0', marginBottom: 40 }}>
        <p style={{ fontFamily: FONT, fontWeight: 300, fontSize: 19, lineHeight: 1.45, color: '#39424F', margin: 0, maxWidth: 720 }}>
          {data.observation}
        </p>
      </div>

      {/* Month-by-month operating movement */}
      <div style={{ marginBottom: 44 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 18, marginBottom: 18 }}>
          <div style={eyebrowStyle}>Month by month {'—'} operating movement</div>
          {monthlyChart.latest && (
            <div style={{ fontFamily: FONT, fontSize: 9.5, color: '#B7BAC0', letterSpacing: '.04em', textAlign: 'right' }}>
              {monthlyChart.latest.label} net {fmtF(monthlyChart.latest.net ?? 0)}
            </div>
          )}
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '20px 22px 18px' }}>
          <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            {[
              ['Income', '#3E7A55'],
              ['Spend', '#41566C'],
              ['Net', '#A8443B'],
            ].map(([label, swatch]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#757C86' }}>
                <span style={{ width: 10, height: 10, borderRadius: 2, background: swatch }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <svg viewBox={`0 0 ${monthlyChart.width} ${monthlyChart.height}`} role="img" aria-label="Month by month operating income, spend and net" style={{ display: 'block', width: '100%', height: 'auto' }}>
            <line x1={58} x2={738} y1={monthlyChart.baseline} y2={monthlyChart.baseline} stroke="#D9D7D0" strokeWidth={1} />
            {[monthlyChart.floor, 0, monthlyChart.ceiling].filter((value, index, all) => all.indexOf(value) === index).map((value) => {
              const y = 18 + ((monthlyChart.ceiling - value) / (monthlyChart.ceiling - monthlyChart.floor || 1)) * (270 - 18 - 44);
              return (
                <g key={value}>
                  <line x1={58} x2={738} y1={y} y2={y} stroke={value === 0 ? '#D9D7D0' : '#F0EEE8'} strokeWidth={1} />
                  <text x={48} y={y + 4} textAnchor="end" fontSize={10} fill="#9AA0A8" style={{ fontFamily: FONT }}>
                    {fmtC(value)}
                  </text>
                </g>
              );
            })}
            {monthlyChart.points.map((point) => {
              const barW = 13;
              return (
                <g key={point.row.month}>
                  {point.row.income !== null && (
                    <rect
                      x={point.x - barW - 1}
                      y={Math.min(point.incomeY!, monthlyChart.baseline)}
                      width={barW}
                      height={Math.max(2, Math.abs(monthlyChart.baseline - point.incomeY!))}
                      rx={3}
                      fill="#3E7A55"
                    />
                  )}
                  {point.row.expense !== null && (
                    <rect
                      x={point.x + 1}
                      y={Math.min(point.expenseY!, monthlyChart.baseline)}
                      width={barW}
                      height={Math.max(2, Math.abs(monthlyChart.baseline - point.expenseY!))}
                      rx={3}
                      fill="#41566C"
                    />
                  )}
                  <text x={point.x} y={248} textAnchor="middle" fontSize={10} fill={point.row.net === null ? '#C6CAD1' : '#757C86'} style={{ fontFamily: FONT }}>
                    {point.row.label}
                  </text>
                </g>
              );
            })}
            {monthlyChart.netLine && (
              <polyline points={monthlyChart.netLine} fill="none" stroke="#A8443B" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
            )}
            {monthlyChart.points.filter((point) => point.netY !== null).map((point) => (
              <circle key={`net-${point.row.month}`} cx={point.x} cy={point.netY!} r={3.5} fill="#A8443B" stroke="#FFFFFF" strokeWidth={1.5} />
            ))}
          </svg>
        </div>
      </div>

      {/* Donut + composition */}
      <div className="cc-grid-2" style={{ gap: 44, alignItems: 'start', marginBottom: 44 }}>
        <div>
          <div style={{ ...eyebrowStyle, marginBottom: 16 }}>Where the budget goes</div>
          <div style={{ display: 'flex', gap: 26, alignItems: 'center', background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: 24 }}>
            <div style={{ position: 'relative', width: 132, height: 132, flex: 'none' }}>
              <svg viewBox="0 0 120 120" width={132} height={132} style={{ display: 'block' }}>
                {donut.segs.map((s) => (
                  <circle
                    key={s.name}
                    cx={60}
                    cy={60}
                    r={48}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={15}
                    strokeDasharray={s.dash}
                    strokeDashoffset={s.offset}
                    transform="rotate(-90 60 60)"
                  />
                ))}
              </svg>
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ fontFamily: FONT, fontWeight: 300, fontSize: 21, color: '#1B2430', fontVariantNumeric: 'tabular-nums' }}>
                  {donut.center}
                </div>
                <div style={{ fontFamily: FONT, fontSize: 8, letterSpacing: '.1em', textTransform: 'uppercase', color: '#9AA0A8' }}>Expense</div>
              </div>
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
              {donut.segs.map((s) => (
                <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: s.color, flex: 'none' }} />
                  <span style={{ flex: 1, fontSize: 12.5, color: '#39424F', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.name}
                  </span>
                  <span style={{ fontSize: 12, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>{s.amountFmt}</span>
                  <span style={{ width: 34, textAlign: 'right', fontSize: 11.5, color: '#9AA0A8', fontVariantNumeric: 'tabular-nums' }}>{s.pct}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div>
          <div style={{ ...eyebrowStyle, marginBottom: 22 }}>Budget vs spend to date</div>
          {composition.map((c) => (
            <div key={c.label} style={{ marginBottom: 26 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 9 }}>
                <span style={{ fontSize: 14, color: '#1B2430' }}>{c.label}</span>
                <span style={{ fontSize: 12.5, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>
                  {c.spentFmt} <span style={{ color: '#B7BAC0' }}>/ {c.approvedFmt}</span>
                </span>
              </div>
              <div style={{ height: 10, borderRadius: 5, background: '#ECEAE4', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: c.pct, background: c.color }} />
              </div>
              <div style={{ fontSize: 11.5, color: '#9AA0A8', marginTop: 6, fontVariantNumeric: 'tabular-nums' }}>
                {c.pctLabel} of approved {'·'} {c.paceLabel}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Function pace bars (top 8 by budget) */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <div style={eyebrowStyle}>Function budgets {'—'} budget &amp; spend</div>
          <div style={{ fontFamily: FONT, fontSize: 9.5, color: '#B7BAC0', letterSpacing: '.04em' }}>| = elapsed-year pace</div>
        </div>
        <div className="cc-scroll-x">
          <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '22px 24px' }}>
            {functionBars.map((f) => (
              <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 15 }}>
                <span style={{ width: 170, flex: 'none', fontSize: 12.5, color: '#1B2430', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {f.name}
                </span>
                <div style={{ flex: 1, height: 13, background: f.allocColor, border: '1px solid rgba(27,36,48,.06)', borderRadius: 7, position: 'relative', overflow: 'hidden' }}>
                  <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: f.spentW, background: f.spentColor, borderRadius: 7 }} />
                  <div style={{ position: 'absolute', left: paceW, top: -2, width: 1.5, height: 17, background: '#AEB2BA' }} />
                </div>
                <span style={{ width: 88, flex: 'none', textAlign: 'right', fontSize: 12, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>
                  {f.spentFmt} <span style={{ color: '#B7BAC0' }}>/ {f.budgetFmt}</span>
                </span>
                <span style={{ width: 38, flex: 'none', textAlign: 'right', fontSize: 12, color: '#39424F', fontVariantNumeric: 'tabular-nums' }}>
                  {f.usedFmt}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pressure watchlist (lowest remaining first) */}
      <div style={{ marginTop: 44 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
          <div style={eyebrowStyle}>Pressure watchlist {'—'} lowest remaining first</div>
          <div style={{ fontFamily: FONT, fontSize: 9.5, color: '#B7BAC0', letterSpacing: '.04em' }}>( ) = over budget</div>
        </div>
        <div className="cc-scroll-x">
        <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '22px 24px' }}>
          <div style={{ display: 'flex', gap: 16, paddingBottom: 10, borderBottom: '1px solid #E7E5DF' }}>
            <span style={{ ...eyebrowStyle, flex: 1 }}>Function</span>
            <span style={{ ...eyebrowStyle, width: 100, flex: 'none', textAlign: 'right' }}>Budget</span>
            <span style={{ ...eyebrowStyle, width: 100, flex: 'none', textAlign: 'right' }}>Spend</span>
            <span style={{ ...eyebrowStyle, width: 100, flex: 'none', textAlign: 'right' }}>Remaining</span>
            <span style={{ ...eyebrowStyle, width: 44, flex: 'none', textAlign: 'right' }}>Used</span>
          </div>
          {watchlist.map((f) => (
            <div key={f.name} style={{ display: 'flex', alignItems: 'baseline', gap: 16, padding: '11px 0', borderBottom: '1px solid #F3F1EC' }}>
              <span style={{ flex: 1, fontSize: 12.5, color: '#1B2430', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.name}
              </span>
              <span style={{ width: 100, flex: 'none', textAlign: 'right', fontSize: 12, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>
                {f.budgetFmt}
              </span>
              <span style={{ width: 100, flex: 'none', textAlign: 'right', fontSize: 12, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>
                {f.spentFmt}
              </span>
              <span style={{ width: 100, flex: 'none', textAlign: 'right', fontSize: 12, color: f.remainingColor, fontVariantNumeric: 'tabular-nums' }}>
                {f.remainingFmt}
              </span>
              <span style={{ width: 44, flex: 'none', textAlign: 'right', fontSize: 12, color: '#39424F', fontVariantNumeric: 'tabular-nums' }}>
                {f.usedFmt}
              </span>
            </div>
          ))}
        </div>
        </div>
      </div>

      {/* Key account drilldowns — per-account live MYOB pull (from the backend
          metric registry, so the list stays in sync). Each row triggers a
          scoped, read-only journal drilldown and shows the fresh net debit +
          journals scanned in place once pulled. */}
      {drilldowns.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
            <div style={eyebrowStyle}>Key account drilldowns {'—'} live MYOB pull</div>
            <div style={{ fontFamily: FONT, fontSize: 9.5, color: '#B7BAC0', letterSpacing: '.04em' }}>
              net debit · journals scanned
            </div>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '22px 24px' }}>
            {drilldowns.map((d, i) => {
              const fresh = freshById[d.id];
              const indexed = indexedByCode.get(d.code);
              return (
                <div
                  key={d.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 16,
                    padding: '13px 0',
                    borderTop: i === 0 ? 'none' : '1px solid #F3F1EC',
                  }}
                >
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12.5,
                      color: '#1B2430',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {d.label}
                  </span>
                  <span
                    style={{
                      width: 130,
                      flex: 'none',
                      textAlign: 'right',
                      fontSize: 12.5,
                      color: fresh ? '#1B2430' : '#B7BAC0',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fresh ? (
                      <>
                        {fresh.netFmt}{' '}
                        <span style={{ color: '#B7BAC0' }}>· {fresh.journalsScanned}</span>
                      </>
                    ) : indexed ? (
                      <>
                        {fmtF(indexed.journal_net)}{' '}
                        <span style={{ color: '#B7BAC0' }}>· {indexed.journal_lines}</span>
                      </>
                    ) : (
                      'not pulled'
                    )}
                  </span>
                  <span style={{ flex: 'none' }}>
                    <MetricRefreshControl
                      id={d.id}
                      endpoint={`/myob/metrics/${d.id}/pull`}
                      onRefreshed={(doc) => applyFresh(d.id, doc)}
                    />
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

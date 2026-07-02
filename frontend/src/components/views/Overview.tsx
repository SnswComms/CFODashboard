'use client';

// Overview ("Command centre") view — faithful JSX port of the design template
// (template.html lines 228–335) with data wired to GET /api/command-centre/overview
// (kpis, dash cards, alerts, freshness) and GET /api/command-centre/functions
// (budget-vs-spend bars) per the frontend/backend contract. Renders
// pixel-identical from the designData fallback when the backend is unreachable.

import type { CSSProperties } from 'react';
import { useApiGet } from '@/lib/api';
import { color, tint, FONT } from '@/lib/format';
import { OPERATING_FALLBACK } from '@/lib/commandCentre';
import type { KpiTone, OperatingPayload } from '@/lib/commandCentre';
import {
  dashDefs,
  alerts as designAlerts,
  freshness as designFreshness,
} from '@/lib/designData';

// ---------------------------------------------------------------------------
// Contract payload types (§1 GET /api/command-centre/overview)
// ---------------------------------------------------------------------------

interface OverviewPayload {
  generated_at: string | null;
  kpis: Array<{ eyebrow: string; value: string; note: string; tone: KpiTone }>;
  dash_cards: Array<{ id: string; title: string; desc: string; status: string; tone: KpiTone }>;
  alerts: Array<{ title: string; body: string; tone: KpiTone }>;
  freshness: Array<{ name: string; status: string; tone: KpiTone }>;
}

const toneFromColor = (c: string): KpiTone =>
  c === '#3E7A55' ? 'good' : c === '#8A6A2A' ? 'warn' : c === '#A8443B' ? 'bad' : 'neutral';

const FALLBACK: OverviewPayload = {
  generated_at: null,
  // kpis intentionally empty: with no reachable backend the metric cards fall
  // back to the hardcoded design cards (metricCards below, sparklines intact).
  kpis: [],
  dash_cards: dashDefs.map((d) => ({ id: d.id, title: d.title, desc: d.desc, status: d.status, tone: d.tone })),
  alerts: designAlerts.map((a) => ({ title: a.title, body: a.body, tone: toneFromColor(a.color) })),
  freshness: designFreshness.map((f) => ({ name: f.name, status: f.status, tone: toneFromColor(f.color) })),
};

// ---------------------------------------------------------------------------
// Operating trend chart (GA-style analytics) — ported verbatim from app-script.js
// ---------------------------------------------------------------------------

const gaMonths = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const annI = 8032932;
const annE = 7896544;
const maxY = 9000000;
const GW = 680;
const GH = 240;
const gpL = 54;
const gpR = 14;
const gpT = 16;
const gpB = 26;
const gx = (m: number) => gpL + (m / 11) * (GW - gpL - gpR);
const gy = (v: number) => GH - gpB - (v / maxY) * (GH - gpT - gpB);
const incA: number[] = [];
const expA: number[] = [];
for (let m = 0; m < 12; m++) {
  const f = (m + 1) / 12;
  incA.push(Math.round(annI * f * (0.98 + 0.02 * f)));
  expA.push(Math.round(annE * f * (1.04 - 0.04 * f)));
}
const aIdx = 4;
const gyb = gy(0).toFixed(1);
const gpts = (arr: number[], a: number, b: number) => {
  const r: string[] = [];
  for (let m = a; m <= b; m++) r.push(gx(m).toFixed(1) + ',' + gy(arr[m]).toFixed(1));
  return r.join(' ');
};
const garea = (arr: number[], a: number, b: number) => {
  let d = 'M ' + gx(a).toFixed(1) + ',' + gyb;
  for (let m = a; m <= b; m++) d += ' L ' + gx(m).toFixed(1) + ',' + gy(arr[m]).toFixed(1);
  d += ' L ' + gx(b).toFixed(1) + ',' + gyb + ' Z';
  return d;
};
const trend = {
  expAreaSolid: garea(expA, 0, aIdx),
  expAreaProj: garea(expA, aIdx, 11),
  expLineSolid: gpts(expA, 0, aIdx),
  expLineProj: gpts(expA, aIdx, 11),
  incLineSolid: gpts(incA, 0, aIdx),
  incLineProj: gpts(incA, aIdx, 11),
  gridY: [0, 3000000, 6000000, 9000000].map((v) => ({
    y: gy(v).toFixed(1),
    label: v === 0 ? '$0' : '$' + v / 1e6 + 'M',
  })),
  xticks: gaMonths.map((mm, i) => ({ x: gx(i).toFixed(1), label: mm })),
  markerX: gx(aIdx).toFixed(1),
};

// ---------------------------------------------------------------------------
// Metric cards + sparklines — ported verbatim from app-script.js
// ---------------------------------------------------------------------------

const spark = (vals: number[]) => {
  const w = 104;
  const h = 30;
  const p = 3;
  const mn = Math.min(...vals);
  const mx = Math.max(...vals);
  const rng = mx - mn || 1;
  const X = (i: number) => p + (i / (vals.length - 1)) * (w - 2 * p);
  const Y = (v: number) => h - p - ((v - mn) / rng) * (h - 2 * p);
  const line = vals.map((v, i) => X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join(' ');
  const area =
    'M ' + X(0).toFixed(1) + ',' + (h - p) +
    ' L ' + line.split(' ').join(' L ') +
    ' L ' + X(vals.length - 1).toFixed(1) + ',' + (h - p) + ' Z';
  return { line, area };
};

const metricCards = [
  { label: 'Operating income · YTD', value: '$3.28M', delta: '▲ 3.2% vs last period', deltaColor: '#3E7A55', color: '#3E7A55', spark: spark([3.0, 3.05, 3.1, 3.14, 3.2, 3.22, 3.26, 3.28]) },
  { label: 'Operating spend · YTD', value: '$3.42M', delta: '▲ 5.1% vs last period', deltaColor: '#8A6A2A', color: '#8A6A2A', spark: spark([3.0, 3.08, 3.16, 3.25, 3.3, 3.36, 3.4, 3.42]) },
  { label: 'Operating net · YTD', value: '($139K)', delta: '▼ below +$136K target', deltaColor: '#A8443B', color: '#A8443B', spark: spark([0.02, -0.01, -0.03, -0.06, -0.09, -0.11, -0.13, -0.139]) },
  { label: 'Functions on watch', value: '2', delta: 'Properties · Big Camp', deltaColor: '#757C86', color: '#41566C', spark: spark([1, 1, 2, 2, 2, 1.4, 2, 2]) },
];

// ---------------------------------------------------------------------------
// Shared style fragments
// ---------------------------------------------------------------------------

const SECTION_TITLE: CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Overview() {
  const data = useApiGet<OverviewPayload>('/command-centre/overview', FALLBACK);
  const operating = useApiGet<OperatingPayload>('/command-centre/functions', OPERATING_FALLBACK);

  // Shell owns view state and listens for 'cc:navigate' window events; the
  // handler validates the id and calls setView(id) (design: setView in app-script.js).
  const navigate = (id: string) => {
    window.dispatchEvent(new CustomEvent('cc:navigate', { detail: id }));
  };

  // Metric cards: fetched kpis when present, hardcoded design cards otherwise.
  // Sparklines are decorative (no backing series in the payload) and keep the
  // design paths either way.
  const cards = data.kpis?.length
    ? data.kpis.map((k, i) => ({
        label: k.eyebrow,
        value: k.value,
        delta: k.note,
        deltaColor: k.tone === 'neutral' ? '#757C86' : color(k.tone),
        color: k.tone === 'neutral' ? '#41566C' : color(k.tone),
        spark: metricCards[i % metricCards.length].spark,
      }))
    : metricCards;

  // Budget vs spend bars from GET /command-centre/functions (design math kept:
  // track/fill scaled to the largest budget, | marker at elapsed-year pace).
  const elapsed = operating.period?.elapsed_pct ?? 42;
  const fns = operating.functions ?? OPERATING_FALLBACK.functions;
  const chartMax = Math.max(...fns.map((f) => f.budget), 1);
  const functionBars = [...fns]
    .sort((a, b) => b.budget - a.budget)
    .map((f) => ({
      name: f.name,
      usedFmt: f.used_pct + '%',
      trackW: ((f.budget / chartMax) * 100).toFixed(1) + '%',
      fillW: ((f.spent / chartMax) * 100).toFixed(1) + '%',
      paceW: (((f.budget * (elapsed / 100)) / chartMax) * 100).toFixed(1) + '%',
      color: f.status === 'over' ? '#A8443B' : f.status === 'tight' ? '#8A6A2A' : '#1B2430',
    }));

  const alerts = data.alerts ?? FALLBACK.alerts;
  const freshness = data.freshness ?? FALLBACK.freshness;
  const dashCards = (data.dash_cards ?? FALLBACK.dash_cards).map((d) => ({
    ...d,
    statusColor: d.tone === 'neutral' ? '#757C86' : color(d.tone),
    statusTint: d.tone === 'neutral' ? '#F1EFEA' : tint(d.tone),
  }));

  return (
    <div>
      <p
        style={{
          fontSize: 15,
          lineHeight: 1.55,
          color: '#5B626C',
          margin: '0 0 30px',
          maxWidth: 640,
          fontWeight: 300,
        }}
      >
        The single place to read the conference&#39;s financial position — operating pressure,
        budget capacity, staffing, cash and the health of every data source feeding these pages.
      </p>

      {/* Metric cards with sparklines */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 22 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '17px 17px 13px' }}
          >
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9.5,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: '#9AA0A8',
                fontWeight: 500,
              }}
            >
              {c.label}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 8,
                marginTop: 11,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: FONT,
                    fontWeight: 300,
                    fontSize: 28,
                    lineHeight: 1,
                    color: '#1B2430',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {c.value}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: c.deltaColor,
                    marginTop: 7,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {c.delta}
                </div>
              </div>
              <svg
                viewBox="0 0 104 30"
                width={104}
                height={30}
                preserveAspectRatio="none"
                style={{ display: 'block', flex: 'none' }}
              >
                <path d={c.spark.area} fill={c.color} fillOpacity={0.1} />
                <polyline
                  points={c.spark.line}
                  fill="none"
                  stroke={c.color}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        ))}
      </div>

      {/* Operating trend */}
      <div style={{ marginBottom: 34 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <div style={SECTION_TITLE}>Operating trend · FY2026 cumulative</div>
          <div style={{ display: 'flex', gap: 16 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#5B626C' }}>
              <span style={{ width: 16, height: 2, background: '#3E7A55', display: 'inline-block', borderRadius: 2 }} />
              Income
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#5B626C' }}>
              <span
                style={{
                  width: 16,
                  height: 8,
                  background: '#1B2430',
                  opacity: 0.85,
                  display: 'inline-block',
                  borderRadius: 2,
                }}
              />
              Expense
            </span>
          </div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '20px 22px' }}>
          <svg viewBox="0 0 680 240" width="100%" height="auto" style={{ display: 'block' }}>
            <defs>
              <linearGradient id="cc-expg" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#1B2430" stopOpacity="0.15" />
                <stop offset="1" stopColor="#1B2430" stopOpacity="0" />
              </linearGradient>
            </defs>
            {trend.gridY.map((g) => (
              <g key={g.y}>
                <line x1={54} y1={g.y} x2={666} y2={g.y} stroke="#EFEDE7" strokeWidth={1} />
                <text
                  x={46}
                  y={g.y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={9}
                  fill="#9AA0A8"
                  style={{ fontFamily: FONT }}
                >
                  {g.label}
                </text>
              </g>
            ))}
            <path d={trend.expAreaSolid} fill="url(#cc-expg)" />
            <path d={trend.expAreaProj} fill="#1B2430" fillOpacity={0.045} />
            <line
              x1={trend.markerX}
              y1={16}
              x2={trend.markerX}
              y2={214}
              stroke="#C9A24B"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={trend.markerX}
              y={12}
              textAnchor="middle"
              fontSize={8.5}
              fill="#A0885E"
              letterSpacing="0.5"
              style={{ fontFamily: FONT }}
            >
              AS OF MAY
            </text>
            <polyline
              points={trend.expLineProj}
              fill="none"
              stroke="#1B2430"
              strokeWidth={2}
              strokeDasharray="4 3"
              opacity={0.35}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={trend.expLineSolid}
              fill="none"
              stroke="#1B2430"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={trend.incLineProj}
              fill="none"
              stroke="#3E7A55"
              strokeWidth={2}
              strokeDasharray="4 3"
              opacity={0.35}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={trend.incLineSolid}
              fill="none"
              stroke="#3E7A55"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {trend.xticks.map((t, i) => (
              <text
                key={i}
                x={t.x}
                y={235}
                textAnchor="middle"
                fontSize={9}
                fill="#9AA0A8"
                style={{ fontFamily: FONT }}
              >
                {t.label}
              </text>
            ))}
          </svg>
        </div>
      </div>

      {/* Budget vs spend + attention / freshness */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.55fr 1fr', gap: 26, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 18 }}>
            <div style={SECTION_TITLE}>Budget vs spend by function</div>
            <div style={{ fontFamily: FONT, fontSize: 9.5, color: '#B7BAC0', letterSpacing: '.04em' }}>
              | = elapsed-year pace
            </div>
          </div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '22px 24px' }}>
            {functionBars.map((f) => (
              <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 15 }}>
                <span
                  style={{
                    width: 150,
                    flex: 'none',
                    fontSize: 12.5,
                    color: '#1B2430',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.name}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 11,
                    background: '#F3F1EC',
                    borderRadius: 6,
                    position: 'relative',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: f.trackW,
                      background: '#E4E1DA',
                      borderRadius: 6,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      height: '100%',
                      width: f.fillW,
                      background: f.color,
                      borderRadius: 6,
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      left: f.paceW,
                      top: -2,
                      width: 1.5,
                      height: 15,
                      background: '#AEB2BA',
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 42,
                    flex: 'none',
                    textAlign: 'right',
                    fontSize: 12,
                    color: '#757C86',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {f.usedFmt}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ ...SECTION_TITLE, marginBottom: 16 }}>Needs attention</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 28 }}>
            {alerts.map((a) => (
              <div
                key={a.title}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E7E5DF',
                  borderLeft: `3px solid ${color(a.tone)}`,
                  borderRadius: 8,
                  padding: '13px 15px',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 500, color: '#1B2430', marginBottom: 4 }}>{a.title}</div>
                <div style={{ fontSize: 12, lineHeight: 1.45, color: '#757C86' }}>{a.body}</div>
              </div>
            ))}
          </div>
          <div style={{ ...SECTION_TITLE, marginBottom: 14 }}>Source freshness</div>
          <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 8, overflow: 'hidden' }}>
            {freshness.map((f) => (
              <div
                key={f.name}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  padding: '11px 14px',
                  borderBottom: '1px solid #EFEDE7',
                }}
              >
                <span style={{ fontSize: 12.5, color: '#39424F' }}>{f.name}</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontFamily: FONT,
                    fontSize: 9.5,
                    letterSpacing: '.06em',
                    textTransform: 'uppercase',
                    color: color(f.tone),
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: color(f.tone) }} />
                  {f.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Jump to a dashboard */}
      <div style={{ marginTop: 34 }}>
        <div style={{ ...SECTION_TITLE, marginBottom: 14 }}>Jump to a dashboard</div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, overflow: 'hidden' }}>
          {dashCards.map((d) => (
            <button
              key={d.id}
              className="navbtn"
              onClick={() => navigate(d.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                width: '100%',
                textAlign: 'left',
                border: 0,
                borderBottom: '1px solid #EFEDE7',
                background: 'transparent',
                padding: '14px 20px',
                cursor: 'pointer',
                fontFamily: FONT,
              }}
            >
              <span style={{ width: 190, flex: 'none', fontSize: 13.5, fontWeight: 500, color: '#1B2430' }}>
                {d.title}
              </span>
              <span style={{ flex: 1, fontSize: 12.5, color: '#757C86', lineHeight: 1.4 }}>{d.desc}</span>
              <span
                style={{
                  flex: 'none',
                  fontSize: 10,
                  fontFamily: FONT,
                  letterSpacing: '.04em',
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: d.statusTint,
                  color: d.statusColor,
                  whiteSpace: 'nowrap',
                }}
              >
                {d.status}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

'use client';

// "Operating position" view — faithful port of the design's operating section
// (template.html lines 338-416): 4-column KPI grid, observation sentence,
// expense donut + budget-vs-spend composition bars, and function pace bars.
// Data: GET /api/command-centre/functions with a designData-shaped fallback so
// the view renders the exact design figures when the backend is unreachable.

import { useApiGet } from '@/lib/api';
import { fmtC, color, FONT } from '@/lib/format';
// Contract types (GET /api/command-centre/functions, §2) and the design-figure
// fallback are shared with the Overview view via lib/commandCentre.
import { OPERATING_FALLBACK as FALLBACK } from '@/lib/commandCentre';
import type { OperatingPayload, OpFunction } from '@/lib/commandCentre';

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

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Operating() {
  const data = useApiGet<OperatingPayload>('/command-centre/functions', FALLBACK);

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

  const sortedFns = [...fns].sort((a, b) => b.budget - a.budget);
  const chartMax = Math.max(...sortedFns.map((f) => f.budget), 1);
  const functionBars = sortedFns.slice(0, 8).map((f) => ({
    name: f.name,
    usedFmt: f.used_pct + '%',
    budgetFmt: fmtC(f.budget),
    spentFmt: fmtC(f.spent),
    trackW: ((f.budget / chartMax) * 100).toFixed(1) + '%',
    fillW: ((f.spent / chartMax) * 100).toFixed(1) + '%',
    paceW: (((f.budget * (elapsed / 100)) / chartMax) * 100).toFixed(1) + '%',
    color: f.status === 'over' ? '#A8443B' : f.status === 'tight' ? '#8A6A2A' : '#1B2430',
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
      {/* Operating KPI grid (template.html lines 340-348) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 34, borderTop: '1px solid #E7E5DF', paddingTop: 28, marginBottom: 38 }}>
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

      {/* Donut + composition */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 44, alignItems: 'start', marginBottom: 44 }}>
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
          <div style={eyebrowStyle}>Function budgets {'—'} size &amp; spend</div>
          <div style={{ fontFamily: FONT, fontSize: 9.5, color: '#B7BAC0', letterSpacing: '.04em' }}>| = elapsed-year pace</div>
        </div>
        <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '22px 24px' }}>
          {functionBars.map((f) => (
            <div key={f.name} style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 15 }}>
              <span style={{ width: 170, flex: 'none', fontSize: 12.5, color: '#1B2430', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.name}
              </span>
              <div style={{ flex: 1, height: 11, background: '#F3F1EC', borderRadius: 6, position: 'relative', overflow: 'hidden' }}>
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: f.trackW, background: '#E4E1DA', borderRadius: 6 }} />
                <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: f.fillW, background: f.color, borderRadius: 6 }} />
                <div style={{ position: 'absolute', left: f.paceW, top: -2, width: 1.5, height: 15, background: '#AEB2BA' }} />
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
  );
}

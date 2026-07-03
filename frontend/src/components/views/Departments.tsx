'use client';

// "Department budgets" view — faithful port of the design's departments section
// (template.html lines 419-448) plus the department drilldown modal (654-688).
// Data: GET /api/command-centre/departments with a designData-built fallback so
// the view renders the exact design figures when the backend is down. Pace
// lines come from GET /api/budget/departments/pace (empty fallback: no pace
// rows means the view renders exactly as before).

import { useCallback, useState } from 'react';
import { useApiGet } from '@/lib/api';
import MetricRefreshControl from '@/components/MetricRefreshControl';
import type { MetricRefreshDoc } from '@/lib/useMetricRefresh';
import { deptRaw } from '@/lib/designData';
import { color, fmtF, tint, FONT } from '@/lib/format';

interface DeptLine {
  line: string;
  budget: number;
  spent: number;
  remaining: number;
}

interface Dept {
  name: string;
  budget: number;
  used_pct: number;
  spent: number;
  remaining: number;
  status: 'ok' | 'tight' | 'over';
  lines: DeptLine[];
}

interface DepartmentsPayload {
  generated_at: string;
  departments: Dept[];
  // Additive live-only fields — absent from the synthetic contract payload
  // and from the fallback, so their absence means "design figures".
  period?: { label: string; elapsed_pct: number };
  source_note?: string;
}

// Row shape of GET /api/budget/departments/pace (budgetService.getDepartmentsPace).
// expected_at_elapsed is null when the report has no elapsed-period basis
// ("No pace basis") — those rows render nothing.
interface PaceRow {
  name: string;
  budget: number;
  spent: number;
  expected_at_elapsed: number | null;
  pace_variance: number;
  pace_label: string;
  used_pct: number | null;
  current_pace_target: number;
}

// Roll-up summary a "departments-spend" per-metric pull hands back
// (backend metricPullService: doc.value = { summary, department_count }). Only
// the aggregate income / spend / net across all departments is a live metric —
// individual department rows are NOT, so a pull swaps only these totals in place.
interface DepartmentsSpendSummary {
  income: number;
  spend: number;
  net: number;
  cash: unknown[];
}

interface DepartmentsSpendValue {
  summary: DepartmentsSpendSummary;
  department_count: number;
}

// Pace rows are keyed by the UPPERCASE approved-budget department key while
// this view's departments carry display names; the mapping mirrors
// backend/src/constants/commandCentre.js FUNCTION_DEPT_KEYS (names do not
// match case- or word-for-word, e.g. "Faith FM" → "FAITH FM ADMINISTRATION").
const DISPLAY_TO_REPORT_KEY: Record<string, string> = {
  'Field': 'FIELD',
  'Adventist Alpine Village': 'ADVENTIST ALPINE VILLAGE',
  'Administration': 'ADMINISTRATION',
  'Youth Ministry': 'YOUTH MINISTRY',
  'Big Camp': 'BIG CAMP',
  'Ministerial': 'MINISTERIAL',
  'Communications': 'COMMUNICATIONS',
  'Faith FM': 'FAITH FM ADMINISTRATION',
  'Evangelism': 'EVANGELISM',
  'Personal Ministries': 'PERSONAL MINISTRIES / DEPARTMENT LIAISONS',
  'Properties': 'PROPERTIES',
  'Other Operations': 'OTHER OPERATIONS',
};

// Stable module-level fallback (useApiGet requires a constant fallback).
const PACE_FALLBACK: PaceRow[] = [];

// Fallback shaped exactly like the contract payload, derived from designData.
const fallbackPayload: DepartmentsPayload = {
  generated_at: '2026-05-31T10:00:00',
  departments: deptRaw.map((d) => {
    const spent = Math.round((d.budget * d.used) / 100);
    const remaining = d.budget - spent;
    return {
      name: d.name,
      budget: d.budget,
      used_pct: d.used,
      spent,
      remaining,
      status: remaining < 0 ? 'over' : d.used >= 85 ? 'tight' : 'ok',
      lines: d.lines.map(([line, lb]) => {
        const ls = Math.round((lb * d.used) / 100);
        return { line, budget: lb, spent: ls, remaining: lb - ls };
      }),
    };
  }),
};

const statusCls = (status: Dept['status']): 'good' | 'warn' | 'bad' =>
  status === 'over' ? 'bad' : status === 'tight' ? 'warn' : 'good';

export default function Departments() {
  const payload = useApiGet<DepartmentsPayload>('/command-centre/departments', fallbackPayload);
  const paceRows = useApiGet<PaceRow[]>('/api/budget/departments/pace', PACE_FALLBACK);
  const [search, setSearch] = useState('');
  const [modalName, setModalName] = useState<string | null>(null);

  const depts =
    payload && Array.isArray(payload.departments) && payload.departments.length > 0
      ? payload.departments
      : fallbackPayload.departments;

  // Fresh roll-up from a per-metric "departments-spend" pull. Held locally so a
  // refresh overlays ONLY the summary totals in place, without refetching the
  // whole payload or touching shared caches — the per-department rows below keep
  // rendering from the base payload untouched.
  const [freshSummary, setFreshSummary] = useState<DepartmentsSpendSummary | null>(null);

  // One stable callback (mirrors Overview.applyFresh): reads doc.value.summary
  // and records it. Stable identity keeps MetricRefreshControl's onRefreshed
  // effect from re-firing.
  const applyFresh = useCallback((doc: MetricRefreshDoc) => {
    const value = doc.value as unknown as DepartmentsSpendValue;
    const summary = value?.summary;
    if (!summary || typeof summary.spend !== 'number') return;
    setFreshSummary(summary);
  }, []);

  // Base roll-up totals derived from the department payload. `income` is not a
  // per-department field here, so the base income falls back to null (dash) —
  // spend and net (as budget − spend) still read directly, and any live pull
  // overlays all three from the fresh summary.
  const baseSpend = depts.reduce((sum, d) => sum + d.spent, 0);
  const baseBudget = depts.reduce((sum, d) => sum + d.budget, 0);
  const summary = {
    income: freshSummary ? freshSummary.income : null,
    spend: freshSummary ? freshSummary.spend : baseSpend,
    net: freshSummary ? freshSummary.net : baseBudget - baseSpend,
  };

  // Elapsed-year pace by display name; only rows with a real elapsed-period
  // expectation surface (null expected_at_elapsed = "No pace basis").
  const paceByKey = new Map(
    (Array.isArray(paceRows) ? paceRows : []).map((row) => [row.name, row])
  );
  const paceFor = (displayName: string): PaceRow | undefined => {
    const row = paceByKey.get(DISPLAY_TO_REPORT_KEY[displayName] ?? '');
    return row && row.expected_at_elapsed != null ? row : undefined;
  };

  // ---- bars: one horizontal display per department. The full track is that
  // department's allocated budget (light status tint); the fill is spend as a
  // share of its OWN budget (strong status colour), so allocated-vs-spent reads
  // directly. Over-budget clamps the fill to 100% (whole bar reads bad-red).
  const q = search.toLowerCase().trim();
  const bars = depts
    .map((d) => {
      const cls = statusCls(d.status);
      const pace = paceFor(d.name);
      return {
        name: d.name,
        paceLabel: pace ? pace.pace_label : null,
        paceColor: pace && pace.pace_variance < 0 ? '#A8443B' : '#9AA0A8',
        usedFmt: d.used_pct + '%',
        remainingFmt: fmtF(d.remaining),
        spentW: Math.max(0, Math.min(100, d.used_pct)).toFixed(1) + '%',
        allocColor: tint(cls),
        spentColor: color(cls),
        dotColor: color(cls),
        remColor: d.status === 'over' ? '#A8443B' : '#9AA0AC',
        _s: d.budget,
      };
    })
    .sort((a, b) => b._s - a._s)
    .filter((d) => !q || d.name.toLowerCase().includes(q));

  // ---- drilldown modal (ported modal) ----
  const modalDept = modalName ? depts.find((x) => x.name === modalName) : undefined;
  const modalPace = modalDept ? paceFor(modalDept.name) : undefined;
  const modal = modalDept
    ? {
        name: modalDept.name,
        summary:
          'Budget ' +
          fmtF(modalDept.budget) +
          '  ·  Spend ' +
          fmtF(modalDept.spent) +
          '  ·  Remaining ' +
          fmtF(modalDept.remaining) +
          '  ·  ' +
          modalDept.used_pct +
          '% used' +
          (modalPace ? '  ·  ' + modalPace.pace_label : ''),
        lines: modalDept.lines.map((l) => ({
          line: l.line,
          budgetFmt: fmtF(l.budget),
          spentFmt: fmtF(l.spent),
          remainingFmt: fmtF(l.remaining),
          remColor: l.remaining < 0 ? '#A8443B' : '#39424F',
        })),
      }
    : null;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 20,
          marginBottom: 24,
          flexWrap: 'wrap',
        }}
      >
        <p style={{ fontSize: 13.5, color: '#757C86', margin: 0, maxWidth: 520, lineHeight: 1.5 }}>
          {payload?.source_note
            ? `Approved FY2026 authority against live MYOB actuals — ${payload.source_note}. Click any department to drill into its budget lines.`
            : 'Approved FY2026 authority against illustrative spend. Click any department to drill into its budget lines.'}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          {payload?.period && (
            <span
              style={{
                fontFamily: FONT,
                fontSize: 10.5,
                letterSpacing: '.06em',
                textTransform: 'uppercase',
                color: '#757C86',
                background: '#F5F4EF',
                border: '1px solid #E7E5DF',
                borderRadius: 999,
                padding: '5px 12px',
                whiteSpace: 'nowrap',
              }}
            >
              {payload.period.label} · {payload.period.elapsed_pct}% elapsed
            </span>
          )}
          <input
            className="num-input"
            style={{ width: 280, maxWidth: '100%' }}
            placeholder="Search departments…"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
        </div>
      </div>
      {/* Roll-up summary across all departments. The per-metric refresh control
          is bound to "departments-spend"; a successful pull overlays ONLY these
          totals in place (income / spend / net) from doc.value.summary, leaving
          the per-department rows below untouched. */}
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E7E5DF',
          borderRadius: 12,
          padding: '17px 20px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 20,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: 40, flexWrap: 'wrap' }}>
          {[
            { label: 'Income · all departments', value: summary.income, tone: 'good' as const },
            { label: 'Spend · all departments', value: summary.spend, tone: 'warn' as const },
            { label: 'Net · all departments', value: summary.net, tone: '' as const },
          ].map((s) => (
            <div key={s.label}>
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
                {s.label}
              </div>
              <div
                style={{
                  fontFamily: FONT,
                  fontWeight: 300,
                  fontSize: 26,
                  lineHeight: 1,
                  marginTop: 9,
                  color:
                    s.value == null
                      ? '#9AA0AC'
                      : s.tone === ''
                        ? s.value < 0
                          ? color('bad')
                          : '#1B2430'
                        : color(s.tone),
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {s.value == null ? '—' : fmtF(s.value)}
              </div>
            </div>
          ))}
        </div>
        <MetricRefreshControl
          id="departments-spend"
          endpoint="/myob/metrics/departments-spend/pull"
          onRefreshed={applyFresh}
        />
      </div>

      <div className="cc-scroll-x">
        <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px 12px',
          fontFamily: FONT,
          fontSize: 9.5,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: '#9AA0A8',
        }}
      >
        <span style={{ width: 170, flex: 'none' }}>Department</span>
        <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span>Spend within budget</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{ width: 10, height: 10, borderRadius: 3, background: color('good') }}
            />
            <span>Spent</span>
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: tint('good'),
                border: '1px solid rgba(27,36,48,.12)',
              }}
            />
            <span>Allocated</span>
          </span>
        </span>
        <span style={{ width: 44, flex: 'none', textAlign: 'right' }}>Used</span>
        <span style={{ width: 104, flex: 'none', textAlign: 'right' }}>Remaining</span>
      </div>
      <div
        style={{
          background: '#FFFFFF',
          border: '1px solid #E7E5DF',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {bars.map((d) => (
          <button
            key={d.name}
            className="navbtn"
            onClick={() => setModalName(d.name)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              width: '100%',
              textAlign: 'left',
              border: 0,
              borderBottom: '1px solid #EFEDE7',
              background: 'transparent',
              padding: '15px 20px',
              cursor: 'pointer',
              fontFamily: FONT,
            }}
          >
            <span
              style={{
                width: 170,
                flex: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: d.dotColor,
                  flex: 'none',
                }}
              />
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: 'block',
                    fontSize: 13.5,
                    color: '#1B2430',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {d.name}
                </span>
                {d.paceLabel && (
                  <span
                    style={{
                      display: 'block',
                      fontSize: 11,
                      color: d.paceColor,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {d.paceLabel}
                  </span>
                )}
              </span>
            </span>
            <span
              style={{
                flex: 1,
                display: 'block',
                height: 14,
                background: d.allocColor,
                border: '1px solid rgba(27,36,48,.06)',
                borderRadius: 7,
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: d.spentW,
                  background: d.spentColor,
                  borderRadius: 7,
                }}
              />
            </span>
            <span
              style={{
                width: 44,
                flex: 'none',
                textAlign: 'right',
                fontSize: 12.5,
                color: '#757C86',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {d.usedFmt}
            </span>
            <span
              style={{
                width: 104,
                flex: 'none',
                textAlign: 'right',
                fontSize: 13,
                color: d.remColor,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {d.remainingFmt}
            </span>
          </button>
        ))}
      </div>
        </div>
      </div>

      {modal && (
        <div
          onClick={() => setModalName(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(27,36,48,.32)',
            backdropFilter: 'blur(4px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 32,
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(720px,96vw)',
              maxHeight: '86vh',
              overflow: 'auto',
              background: '#FFFFFF',
              border: '1px solid #E7E5DF',
              borderRadius: 14,
              boxShadow: '0 30px 60px rgba(27,36,48,.22)',
              padding: '28px 30px',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 20,
                marginBottom: 6,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: 10,
                    letterSpacing: '.12em',
                    textTransform: 'uppercase',
                    color: '#A0885E',
                    fontWeight: 500,
                    marginBottom: 8,
                  }}
                >
                  Department drilldown
                </div>
                <h2
                  style={{
                    fontFamily: FONT,
                    fontWeight: 300,
                    fontSize: 26,
                    lineHeight: 1.1,
                    color: '#1B2430',
                    margin: 0,
                  }}
                >
                  {modal.name}
                </h2>
              </div>
              <button
                onClick={() => setModalName(null)}
                style={{
                  background: '#F5F4EF',
                  border: '1px solid #E7E5DF',
                  borderRadius: 8,
                  padding: '8px 13px',
                  fontSize: 12.5,
                  color: '#39424F',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  flex: 'none',
                }}
              >
                Close
              </button>
            </div>
            <div
              style={{
                fontSize: 13,
                color: '#757C86',
                margin: '0 0 22px',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {modal.summary}
            </div>
            <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
              <thead>
                <tr>
                  <th
                    style={{
                      textAlign: 'left',
                      fontFamily: FONT,
                      fontSize: 9.5,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: '#9AA0A8',
                      fontWeight: 500,
                      padding: '0 0 12px',
                      borderBottom: '1px solid #E7E5DF',
                    }}
                  >
                    Line / activity
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      fontFamily: FONT,
                      fontSize: 9.5,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: '#9AA0A8',
                      fontWeight: 500,
                      padding: '0 0 12px 16px',
                      borderBottom: '1px solid #E7E5DF',
                    }}
                  >
                    Budget
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      fontFamily: FONT,
                      fontSize: 9.5,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: '#9AA0A8',
                      fontWeight: 500,
                      padding: '0 0 12px 16px',
                      borderBottom: '1px solid #E7E5DF',
                    }}
                  >
                    Spend
                  </th>
                  <th
                    style={{
                      textAlign: 'right',
                      fontFamily: FONT,
                      fontSize: 9.5,
                      letterSpacing: '.08em',
                      textTransform: 'uppercase',
                      color: '#9AA0A8',
                      fontWeight: 500,
                      padding: '0 0 12px 16px',
                      borderBottom: '1px solid #E7E5DF',
                    }}
                  >
                    Remaining
                  </th>
                </tr>
              </thead>
              <tbody>
                {modal.lines.map((l) => (
                  <tr key={l.line}>
                    <td
                      style={{
                        padding: '12px 0',
                        borderBottom: '1px solid #EFEDE7',
                        fontSize: 13.5,
                        color: '#1B2430',
                      }}
                    >
                      {l.line}
                    </td>
                    <td
                      style={{
                        padding: '12px 0 12px 16px',
                        borderBottom: '1px solid #EFEDE7',
                        fontSize: 13.5,
                        color: '#39424F',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {l.budgetFmt}
                    </td>
                    <td
                      style={{
                        padding: '12px 0 12px 16px',
                        borderBottom: '1px solid #EFEDE7',
                        fontSize: 13.5,
                        color: '#39424F',
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {l.spentFmt}
                    </td>
                    <td
                      style={{
                        padding: '12px 0 12px 16px',
                        borderBottom: '1px solid #EFEDE7',
                        fontSize: 13.5,
                        color: l.remColor,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {l.remainingFmt}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

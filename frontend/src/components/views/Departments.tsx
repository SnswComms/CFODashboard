'use client';

// "Department budgets" view — faithful port of the design's departments section
// (template.html lines 419-448) plus the department drilldown modal (654-688).
// Data: GET /api/command-centre/departments with a designData-built fallback so
// the view renders the exact design figures when the backend is down.

import { useState } from 'react';
import { useApiGet } from '@/lib/api';
import { deptRaw } from '@/lib/designData';
import { color, fmtF, FONT } from '@/lib/format';

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
}

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
  const [search, setSearch] = useState('');
  const [modalName, setModalName] = useState<string | null>(null);

  const depts =
    payload && Array.isArray(payload.departments) && payload.departments.length > 0
      ? payload.departments
      : fallbackPayload.departments;

  // ---- bars (ported deptBars): sorted by budget desc, filtered by search ----
  const dmax = depts.length > 0 ? Math.max(...depts.map((d) => d.budget)) : 1;
  const q = search.toLowerCase().trim();
  const bars = depts
    .map((d) => {
      const cls = statusCls(d.status);
      return {
        name: d.name,
        usedFmt: d.used_pct + '%',
        remainingFmt: fmtF(d.remaining),
        trackW: ((d.budget / dmax) * 100).toFixed(1) + '%',
        fillW: ((d.spent / dmax) * 100).toFixed(1) + '%',
        color: color(cls),
        dotColor: color(cls),
        remColor: d.status === 'over' ? '#A8443B' : '#9AA0AC',
        _s: d.budget,
      };
    })
    .sort((a, b) => b._s - a._s)
    .filter((d) => !q || d.name.toLowerCase().includes(q));

  // ---- drilldown modal (ported modal) ----
  const modalDept = modalName ? depts.find((x) => x.name === modalName) : undefined;
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
          '% used',
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
          Approved FY2026 authority against illustrative spend. Click any department to drill into
          its budget lines.
        </p>
        <input
          className="num-input"
          style={{ width: 280 }}
          placeholder="Search departments…"
          value={search}
          onChange={(e) => setSearch(e.currentTarget.value)}
        />
      </div>
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
        <span style={{ flex: 1 }}>Spend within budget</span>
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
              <span
                style={{
                  fontSize: 13.5,
                  color: '#1B2430',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {d.name}
              </span>
            </span>
            <span
              style={{
                flex: 1,
                display: 'block',
                height: 12,
                background: '#F3F1EC',
                borderRadius: 6,
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
                  width: d.trackW,
                  background: '#E4E1DA',
                  borderRadius: 6,
                }}
              />
              <span
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: d.fillW,
                  background: d.color,
                  borderRadius: 6,
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

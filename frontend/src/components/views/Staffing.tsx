'use client';

// Staffing scenario view — faithful port of template.html lines 506-542 and the
// staffing block of app-script.js. Baselines come from
// GET /api/command-centre/staffing-baseline with a designData fallback; all
// scenario math is computed client-side per the contract (§6).

import { useEffect, useRef, useState } from 'react';
import { apiGet } from '@/lib/api';
import { staffingBaseline } from '@/lib/designData';
import { color, fmtF } from '@/lib/format';

const FONT = "var(--font-poppins), 'Poppins', sans-serif";

/** Contract payload for GET /api/command-centre/staffing-baseline. */
interface StaffingBaselinePayload {
  generated_at?: string;
  base_field: number;
  base_office: number;
  vacant_posts: number;
  defaults: { tithe: number; ratio: number; package: number };
}

const FALLBACK: StaffingBaselinePayload = {
  base_field: staffingBaseline.baseField,
  base_office: staffingBaseline.baseOffice,
  vacant_posts: staffingBaseline.vacantPosts,
  defaults: { ...staffingBaseline.defaults },
};

interface StaffState {
  tithe: number;
  ratio: number;
  package: number;
  extraField: number;
  extraOffice: number;
}

/** Render a possibly-NaN numeric state value into a controlled input. */
function numVal(n: number): number | '' {
  return Number.isNaN(n) ? '' : n;
}

export default function Staffing() {
  const [staff, setStaff] = useState<StaffState>({
    tithe: FALLBACK.defaults.tithe,
    ratio: FALLBACK.defaults.ratio,
    package: FALLBACK.defaults.package,
    extraField: 0,
    extraOffice: 0,
  });
  const [baseField, setBaseField] = useState<number>(FALLBACK.base_field);
  const [baseOffice, setBaseOffice] = useState<number>(FALLBACK.base_office);
  const [vacantPosts, setVacantPosts] = useState<number>(FALLBACK.vacant_posts);
  const touched = useRef(false);

  useEffect(() => {
    let alive = true;
    apiGet<StaffingBaselinePayload>('/command-centre/staffing-baseline', FALLBACK).then((d) => {
      if (!alive) return;
      setBaseField(d.base_field);
      setBaseOffice(d.base_office);
      // Only seed the editable defaults if the user hasn't started editing.
      if (!touched.current) {
        setVacantPosts(d.vacant_posts);
        setStaff((st) => ({
          ...st,
          tithe: d.defaults.tithe,
          ratio: d.defaults.ratio,
          package: d.defaults.package,
        }));
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const mkStaff =
    (key: keyof StaffState) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      touched.current = true;
      const v = Number(e.target.value);
      setStaff((st) => ({ ...st, [key]: v }));
    };

  const onVacant = (e: React.ChangeEvent<HTMLInputElement>) => {
    touched.current = true;
    setVacantPosts(Number(e.target.value));
  };

  // ---- staffing math (verbatim port of app-script.js) ----
  const s = staff;
  const totalFte = baseField + baseOffice + Number(s.extraField || 0) + Number(s.extraOffice || 0);
  const projected = totalFte * Number(s.package || 0);
  const maxCost = Number(s.tithe || 0) * Number(s.ratio || 0);
  const headroom = maxCost - projected;
  const fte = s.package ? headroom / Number(s.package) : 0;
  let sCls: string;
  let headline: string;
  if (fte >= 0.5) {
    sCls = 'good';
    headline = 'Room for about ' + fte.toFixed(1) + ' more FTE before governance and cash checks.';
  } else if (fte <= -0.5) {
    sCls = 'bad';
    headline = 'Over the tithe-only ceiling by about ' + Math.abs(fte).toFixed(1) + ' FTE.';
  } else {
    sCls = 'warn';
    headline = 'No meaningful FTE headroom at this package.';
  }
  const scaleMax = Math.max(projected, maxCost) * 1.15 || 1;
  const staffOut = {
    color: color(sCls),
    headline,
    projFmt: fmtF(projected),
    maxFmt: fmtF(maxCost),
    projW: Math.min(100, (projected / scaleMax) * 100) + '%',
    maxW: Math.min(100, (maxCost / scaleMax) * 100) + '%',
    detail:
      'Projected staff cost ' +
      fmtF(projected) +
      ' against a ceiling of ' +
      fmtF(maxCost) +
      ' at ' +
      Math.round(Number(s.ratio) * 100) +
      '% of a ' +
      fmtF(Number(s.tithe)) +
      ' tithe target. Headroom ' +
      fmtF(headroom) +
      '.',
  };
  const staffCounts: Array<{ label: string; value: number; note: string }> = [
    { label: 'Field FTE', value: baseField + Number(s.extraField || 0), note: 'incl. scenario adds' },
    { label: 'Office FTE', value: baseOffice + Number(s.extraOffice || 0), note: 'incl. scenario adds' },
    { label: 'Vacant posts', value: vacantPosts, note: 'field / TBD' },
  ];

  const fieldLabel: React.CSSProperties = { fontSize: 12, color: '#5B626C', marginBottom: 6 };
  const fieldHint: React.CSSProperties = { fontSize: 11, color: '#9AA0A8', marginTop: 5, lineHeight: 1.4 };
  const cardEyebrow: React.CSSProperties = {
    fontFamily: FONT,
    fontSize: 10,
    letterSpacing: '.12em',
    textTransform: 'uppercase',
    color: '#9AA0A8',
    fontWeight: 500,
  };

  return (
    <div>
      <div
        className="cc-grid-stack"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1.4fr',
          gap: 32,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E7E5DF',
            borderRadius: 12,
            padding: 24,
          }}
        >
          <div style={{ ...cardEyebrow, marginBottom: 18 }}>Scenario inputs</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'block' }}>
              <div style={fieldLabel}>Tithe target (annual)</div>
              <input
                className="num-input"
                type="number"
                step={100000}
                value={numVal(staff.tithe)}
                onChange={mkStaff('tithe')}
              />
              <div style={fieldHint}>Total tithe income you expect for the year.</div>
            </label>
            <label style={{ display: 'block' }}>
              <div style={fieldLabel}>Staff-cost ceiling (share of tithe)</div>
              <input
                className="num-input"
                type="number"
                step={0.05}
                value={numVal(staff.ratio)}
                onChange={mkStaff('ratio')}
              />
              <div style={fieldHint}>Max share of tithe allowed for staff. Enter 0.75 for 75%.</div>
            </label>
            <label style={{ display: 'block' }}>
              <div style={fieldLabel}>Package cost per FTE</div>
              <input
                className="num-input"
                type="number"
                step={5000}
                value={numVal(staff.package)}
                onChange={mkStaff('package')}
              />
              <div style={fieldHint}>All-in yearly cost of one full-time staff member.</div>
            </label>
            <div className="cc-grid-2" style={{ gap: 12 }}>
              <label style={{ display: 'block' }}>
                <div style={fieldLabel}>+ Field FTE</div>
                <input
                  className="num-input"
                  type="number"
                  step={1}
                  value={numVal(staff.extraField)}
                  onChange={mkStaff('extraField')}
                />
                <div style={fieldHint}>Extra field staff to test.</div>
              </label>
              <label style={{ display: 'block' }}>
                <div style={fieldLabel}>+ Office FTE</div>
                <input
                  className="num-input"
                  type="number"
                  step={1}
                  value={numVal(staff.extraOffice)}
                  onChange={mkStaff('extraOffice')}
                />
                <div style={fieldHint}>Extra office staff to test.</div>
              </label>
            </div>
            <label style={{ display: 'block' }}>
              <div style={fieldLabel}>Vacant posts</div>
              <input
                className="num-input"
                type="number"
                step={1}
                value={numVal(vacantPosts)}
                onChange={onVacant}
              />
              <div style={fieldHint}>Open positions not yet filled (field / TBD).</div>
            </label>
          </div>
        </div>
        <div>
          <div
            style={{
              background: '#FFFFFF',
              border: '1px solid #E7E5DF',
              borderRadius: 12,
              padding: 24,
              marginBottom: 16,
            }}
          >
            <div style={{ ...cardEyebrow, marginBottom: 12 }}>Decision readout</div>
            <div
              style={{
                fontFamily: FONT,
                fontWeight: 300,
                fontSize: 23,
                lineHeight: 1.3,
                color: staffOut.color,
                marginBottom: 16,
              }}
            >
              {staffOut.headline}
            </div>
            <div style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11.5,
                  color: '#757C86',
                  marginBottom: 6,
                }}
              >
                <span>Projected staff cost</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{staffOut.projFmt}</span>
              </div>
              <div
                style={{
                  height: 8,
                  borderRadius: 4,
                  background: '#ECEAE4',
                  overflow: 'hidden',
                  marginBottom: 10,
                }}
              >
                <div style={{ height: '100%', width: staffOut.projW, background: staffOut.color }} />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11.5,
                  color: '#757C86',
                  marginBottom: 6,
                }}
              >
                <span>Ceiling at ratio</span>
                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{staffOut.maxFmt}</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: '#ECEAE4', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: staffOut.maxW, background: '#1B2430' }} />
              </div>
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#757C86' }}>
              {staffOut.detail}
            </div>
          </div>
          <div className="cc-grid-stack" style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
            {staffCounts.map((c) => (
              <div
                key={c.label}
                style={{
                  background: '#FFFFFF',
                  border: '1px solid #E7E5DF',
                  borderRadius: 10,
                  padding: 16,
                }}
              >
                <div
                  style={{
                    fontFamily: FONT,
                    fontSize: 9,
                    letterSpacing: '.1em',
                    textTransform: 'uppercase',
                    color: '#9AA0A8',
                    fontWeight: 500,
                    marginBottom: 8,
                  }}
                >
                  {c.label}
                </div>
                <div style={{ fontSize: 22, color: '#1B2430', fontVariantNumeric: 'tabular-nums' }}>
                  {c.value}
                </div>
                <div style={{ fontSize: 11, color: '#9AA0A8', marginTop: 4 }}>{c.note}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

// Shared evidence drawer — port of the EvidenceObject panel from
// generate_cfo_entity_pages.py (renderEvidence): title, value, summary,
// period/basis, breakdown, people, caveats, sources. Caveats render as a
// prominent amber block (the "basis differs" / "register needed" cautions are
// the point of the drawer). Legacy dashboard links are deliberately de-linked:
// the .html targets do not exist in this app, so they render as plain
// references instead of dead anchors.

import { useEffect } from 'react';
import { fmtF, FONT } from '@/lib/format';

export interface EvidenceBreakdownRow {
  label: string;
  budget: number | null;
  actual: number | null;
  variance: number | string | null;
  used: number | string | null;
}

export interface EvidencePersonRow {
  name: string;
  staff_id: string;
  area: string;
  cost: number | null;
  match: string;
}

export interface EvidenceLink {
  label: string;
  url: string;
  note: string;
}

export interface EvidenceSourceRef {
  label: string;
  locator: string;
  detail: string;
  kind: string;
}

export interface EvidenceObject {
  title: string;
  value: string;
  summary: string;
  period: string;
  basis: string;
  breakdown: EvidenceBreakdownRow[];
  people: EvidencePersonRow[];
  links: EvidenceLink[];
  sources: EvidenceSourceRef[];
  caveats: string[];
}

const sectionLabelStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
  margin: '26px 0 10px',
};

const metaBoxStyle: React.CSSProperties = {
  background: '#F5F4EF',
  border: '1px solid #E7E5DF',
  borderRadius: 10,
  padding: '10px 12px',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: FONT,
  fontSize: 9.5,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
  padding: '0 12px 10px 0',
  borderBottom: '1px solid #E7E5DF',
};

const tdStyle: React.CSSProperties = {
  padding: '10px 12px 10px 0',
  borderBottom: '1px solid #EFEDE7',
  fontSize: 12.5,
  color: '#39424F',
  verticalAlign: 'top',
};

const numTd: React.CSSProperties = {
  ...tdStyle,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
};

// Explicit nulls stay visibly missing ('—'); a number never silently becomes
// $0. Strings (e.g. "payroll lane", "3 people") pass through verbatim.
function moneyCell(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'number' ? fmtF(value) : String(value);
}

function usedCell(value: number | string | null): string {
  if (value === null || value === undefined) return '—';
  return typeof value === 'number' ? `${value.toFixed(1)}%` : String(value);
}

export default function EvidenceDrawer({
  evidence,
  onClose,
}: {
  evidence: EvidenceObject | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!evidence) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(27,36,48,.32)',
        backdropFilter: 'blur(4px)',
        zIndex: 60,
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 'min(680px,96vw)',
          overflowY: 'auto',
          background: '#FFFFFF',
          borderLeft: '1px solid #E7E5DF',
          boxShadow: '-24px 0 60px rgba(27,36,48,.22)',
          padding: '28px 30px',
          fontFamily: FONT,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 20 }}>
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
              Evidence
            </div>
            <h2 style={{ fontFamily: FONT, fontWeight: 300, fontSize: 24, lineHeight: 1.15, color: '#1B2430', margin: 0 }}>
              {evidence.title}
            </h2>
          </div>
          <button
            onClick={onClose}
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

        <div style={{ fontSize: 21, color: '#1B2430', margin: '14px 0 8px', fontVariantNumeric: 'tabular-nums' }}>
          {evidence.value}
        </div>
        <p style={{ fontSize: 13, color: '#757C86', margin: '0 0 18px', lineHeight: 1.5 }}>{evidence.summary}</p>

        <div className="cc-grid-2" style={{ gap: 10 }}>
          <div style={metaBoxStyle}>
            <div style={{ ...sectionLabelStyle, margin: '0 0 5px' }}>Period</div>
            <div style={{ fontSize: 12.5, color: '#39424F', lineHeight: 1.45 }}>{evidence.period}</div>
          </div>
          <div style={metaBoxStyle}>
            <div style={{ ...sectionLabelStyle, margin: '0 0 5px' }}>Basis</div>
            <div style={{ fontSize: 12.5, color: '#39424F', lineHeight: 1.45 }}>{evidence.basis}</div>
          </div>
        </div>

        {/* Caveats first and amber: the whole point of the drawer is that the
            caution travels with the figure, not below the fold. */}
        {evidence.caveats.length > 0 && (
          <div
            style={{
              marginTop: 14,
              background: '#F7F1E6',
              border: '1px solid rgba(201,162,75,.4)',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ ...sectionLabelStyle, margin: '0 0 8px', color: '#8A6A2A' }}>Caveats / open questions</div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {evidence.caveats.map((caveat) => (
                <li key={caveat} style={{ fontSize: 12.5, color: '#8A6A2A', lineHeight: 1.5, marginBottom: 4 }}>
                  {caveat}
                </li>
              ))}
            </ul>
          </div>
        )}

        {evidence.breakdown.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Breakdown behind this figure</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Item</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Budget</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Actual / spend</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Variance</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Used</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.breakdown.map((row, i) => (
                    <tr key={`${row.label}-${i}`}>
                      <td style={{ ...tdStyle, color: '#1B2430' }}>{row.label}</td>
                      <td style={numTd}>{moneyCell(row.budget)}</td>
                      <td style={numTd}>{moneyCell(row.actual)}</td>
                      <td style={numTd}>{moneyCell(row.variance)}</td>
                      <td style={numTd}>{usedCell(row.used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {evidence.people.length > 0 && (
          <>
            <div style={sectionLabelStyle}>People / payroll behind this figure</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Person</th>
                    <th style={thStyle}>Staff ID</th>
                    <th style={thStyle}>Area / role</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Cost</th>
                    <th style={thStyle}>Match</th>
                  </tr>
                </thead>
                <tbody>
                  {evidence.people.map((person, i) => (
                    <tr key={`${person.name}-${i}`}>
                      <td style={{ ...tdStyle, color: '#1B2430' }}>{person.name}</td>
                      <td style={tdStyle}>{person.staff_id}</td>
                      <td style={tdStyle}>{person.area}</td>
                      <td style={numTd}>{moneyCell(person.cost)}</td>
                      <td style={tdStyle}>{person.match}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {evidence.links.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Related dashboards (legacy references)</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {evidence.links.map((link) => (
                <div
                  key={link.label}
                  style={{ background: '#F5F4EF', border: '1px solid #E7E5DF', borderRadius: 10, padding: '10px 12px' }}
                >
                  <div style={{ fontSize: 12.5, color: '#1B2430', fontWeight: 500 }}>{link.label}</div>
                  <div style={{ fontSize: 12, color: '#757C86', lineHeight: 1.45, marginTop: 2 }}>{link.note}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {evidence.sources.length > 0 && (
          <>
            <div style={sectionLabelStyle}>Source references</div>
            <div style={{ display: 'grid', gap: 8 }}>
              {evidence.sources.map((source, i) => (
                <div
                  key={`${source.label}-${i}`}
                  style={{ background: '#F5F4EF', border: '1px solid #E7E5DF', borderRadius: 10, padding: '10px 12px' }}
                >
                  <div style={{ fontSize: 12.5, color: '#1B2430', fontWeight: 500 }}>{source.label}</div>
                  {source.locator && (
                    <code
                      style={{
                        display: 'block',
                        fontSize: 11,
                        color: '#757C86',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        margin: '4px 0',
                      }}
                    >
                      {source.locator}
                    </code>
                  )}
                  <div style={{ fontSize: 12, color: '#757C86', lineHeight: 1.45, marginTop: 2 }}>{source.detail}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

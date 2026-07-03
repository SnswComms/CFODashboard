'use client';

// Per-entity detail page — port of the generate_cfo_entity_pages.py pages.
// Data: GET /api/entities/:entityId (entitiesService.buildEntityDetail) with a
// null fallback: when the backend is down or the id is unknown, an explicit
// "detail unavailable" card renders — no design figures are invented.
// Python data-honesty rule: a null value renders the literal word
// "Placeholder", never fmtF(null) (which would print a false $0).

import { useState } from 'react';
import Link from 'next/link';
import { useApiGet } from '@/lib/api';
import { fmtF, FONT, color } from '@/lib/format';
import EvidenceDrawer from '@/components/EvidenceDrawer';
import type { EvidenceObject } from '@/components/EvidenceDrawer';

interface DetailCard {
  title: string;
  value: number | string | null;
  note: string;
  tone: string;
  evidence: EvidenceObject;
}

interface DetailTile {
  title: string;
  body: string;
  tone: string;
  evidence: EvidenceObject;
}

interface DetailTable {
  title: string;
  headers: string[];
  rows: Array<Array<string | number | null>>;
  // Additive parallel evidence list (SNC function-pressure table); when
  // present, row i's Evidence button opens row_evidence[i].
  row_evidence?: EvidenceObject[];
}

interface EntityDetailPayload {
  id: string;
  title: string;
  subtitle: string;
  cards: DetailCard[];
  tiles: DetailTile[];
  tables: DetailTable[];
}

const eyebrowStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
};

const cardStyle: React.CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E7E5DF',
  borderRadius: 12,
  padding: '20px 22px',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const evidenceButtonStyle: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 'auto',
  background: '#F5F4EF',
  border: '1px solid #E7E5DF',
  borderRadius: 999,
  padding: '4px 12px',
  fontFamily: FONT,
  fontSize: 11,
  fontWeight: 500,
  color: '#8A6A2A',
  cursor: 'pointer',
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: FONT,
  fontSize: 9.5,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
  padding: '0 16px 12px 0',
  borderBottom: '1px solid #E7E5DF',
};

// Python parity: money() for dollar figures, pct() for "used" figures (the
// header/title is the only unit marker the payload carries), strings verbatim,
// null as the literal word "Placeholder".
function formatValue(unitHint: string, value: number | string | null): { text: string; placeholder: boolean } {
  if (value === null || value === undefined) return { text: 'Placeholder', placeholder: true };
  if (typeof value === 'number') {
    return { text: /used/i.test(unitHint) ? `${value.toFixed(1)}%` : fmtF(value), placeholder: false };
  }
  return { text: String(value), placeholder: false };
}

export default function EntityDetail({ entityId }: { entityId: string }) {
  const payload = useApiGet<EntityDetailPayload | null>(`/api/entities/${encodeURIComponent(entityId)}`, null);
  const [drawer, setDrawer] = useState<EvidenceObject | null>(null);

  return (
    <div>
      <Link
        href="/entities"
        style={{ ...eyebrowStyle, color: '#8A6A2A', textDecoration: 'none', display: 'inline-block', marginBottom: 18 }}
      >
        ← All entities
      </Link>

      {!payload ? (
        <div style={cardStyle}>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#1B2430' }}>Entity detail unavailable</div>
          <p style={{ fontSize: 13, color: '#757C86', margin: 0, lineHeight: 1.5 }}>
            The backend did not return a detail page for {'“'}{entityId}{'”'}. It may be an unknown entity id, or the
            backend may be unreachable. No figures are shown rather than inventing placeholders.
          </p>
        </div>
      ) : (
        <>
          <h2 style={{ fontFamily: FONT, fontWeight: 300, fontSize: 24, lineHeight: 1.15, color: '#1B2430', margin: 0 }}>
            {payload.title}
          </h2>
          <p style={{ fontSize: 13.5, color: '#757C86', margin: '8px 0 28px', maxWidth: 720, lineHeight: 1.5 }}>
            {payload.subtitle}
          </p>

          {payload.cards.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
                gap: 14,
                marginBottom: 30,
              }}
            >
              {payload.cards.map((card) => {
                const value = formatValue(card.title, card.value);
                return (
                  <div key={card.title} style={{ ...cardStyle, minHeight: 150 }}>
                    <div style={eyebrowStyle}>{card.title}</div>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 300,
                        color: value.placeholder ? '#9AA0A8' : color(card.tone),
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {value.text}
                    </div>
                    <div style={{ fontSize: 12, color: '#757C86', lineHeight: 1.45 }}>{card.note}</div>
                    <button style={evidenceButtonStyle} onClick={() => setDrawer(card.evidence)}>
                      Evidence
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {payload.tiles.length > 0 && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 14,
                marginBottom: 30,
              }}
            >
              {payload.tiles.map((tile) => (
                <div key={tile.title} style={{ ...cardStyle, minHeight: 118 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 500, color: color(tile.tone) }}>{tile.title}</div>
                  <div style={{ fontSize: 12.5, color: '#757C86', lineHeight: 1.5 }}>{tile.body}</div>
                  <button style={evidenceButtonStyle} onClick={() => setDrawer(tile.evidence)}>
                    Evidence
                  </button>
                </div>
              ))}
            </div>
          )}

          {payload.tables.map((table) => (
            <div key={table.title} style={{ marginBottom: 30 }}>
              <div style={{ ...eyebrowStyle, marginBottom: 14 }}>{table.title}</div>
              <div style={{ ...cardStyle, padding: '22px 24px' }}>
                <div className="cc-scroll-x">
                  <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0 }}>
                  <thead>
                    <tr>
                      {table.headers.map((header, col) => (
                        <th key={header} style={{ ...thStyle, textAlign: col === 0 ? 'left' : 'right' }}>
                          {header}
                        </th>
                      ))}
                      {table.row_evidence && <th style={{ ...thStyle, textAlign: 'right' }}>Evidence</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {table.rows.map((row, i) => (
                      <tr key={`${String(row[0])}-${i}`}>
                        {row.map((cell, col) => {
                          const value = formatValue(table.headers[col] ?? '', cell);
                          return (
                            <td
                              key={`${table.headers[col]}-${col}`}
                              style={{
                                padding: col === 0 ? '11px 16px 11px 0' : '11px 0 11px 16px',
                                borderBottom: '1px solid #EFEDE7',
                                fontSize: 13,
                                color: value.placeholder ? '#9AA0A8' : col === 0 ? '#1B2430' : '#39424F',
                                textAlign: col === 0 ? 'left' : 'right',
                                fontVariantNumeric: 'tabular-nums',
                                whiteSpace: col === 0 ? 'normal' : 'nowrap',
                              }}
                            >
                              {value.text}
                            </td>
                          );
                        })}
                        {table.row_evidence && (
                          <td
                            style={{
                              padding: '11px 0 11px 16px',
                              borderBottom: '1px solid #EFEDE7',
                              textAlign: 'right',
                            }}
                          >
                            {table.row_evidence[i] ? (
                              <button
                                style={{ ...evidenceButtonStyle, marginTop: 0 }}
                                onClick={() => setDrawer(table.row_evidence![i])}
                              >
                                Evidence
                              </button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  </table>
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      <EvidenceDrawer evidence={drawer} onClose={() => setDrawer(null)} />
    </div>
  );
}

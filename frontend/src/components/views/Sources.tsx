'use client';

// "Data sources" view — evidence registry + source freshness.
// Faithful port of template.html lines 621-645 (isSources section) and the
// sources block of app-script.js. Data: GET /api/command-centre/sources with
// designData fallback (per contract §9).

import { useApiGet } from '@/lib/api';
import { color, FONT } from '@/lib/format';
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

export default function Sources() {
  const payload = useApiGet<SourcesPayload>('/command-centre/sources', FALLBACK);
  const rows = { evidence: toEvidenceRows(payload), freshness: toFreshnessRows(payload) };

  return (
    <div>
      <p style={{ fontSize: 13.5, color: '#757C86', margin: '0 0 28px', maxWidth: 640, lineHeight: 1.5 }}>
        Every figure traces to a source. This registry tracks what is source-backed now, its
        confidence, and which feeds still need a refresh.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 26, alignItems: 'start' }}>
        <div>
          <div style={colLabelStyle}>Evidence registry</div>
          <div style={cardStyle}>
            {rows.evidence.map((e) => (
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
                </div>
                <div style={{ textAlign: 'right', flex: 'none' }}>
                  <div style={{ fontSize: 16, color: '#1B2430', fontVariantNumeric: 'tabular-nums' }}>
                    {e.value}
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
            ))}
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
    </div>
  );
}

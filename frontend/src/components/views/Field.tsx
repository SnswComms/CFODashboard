'use client';

// Field & pastoral view — faithful JSX port of template.html lines 545-572.
// Data: GET /api/command-centre/field (contract §7) with designData fallback.

import { useApiGet } from '@/lib/api';
import { color } from '@/lib/format';
import { fieldStats, loadBuckets } from '@/lib/designData';

// Defined locally (not imported from Shell) to avoid a view -> Shell import
// cycle; next/font renames the family, so the CSS variable must come first.
const FONT = "var(--font-poppins), 'Poppins', sans-serif";

type BucketTone = 'good' | 'warn' | 'bad' | 'muted';

interface FieldStatDto {
  label: string;
  value: string;
}

interface LoadBucketDto {
  label: string;
  count: string;
  pct: number; // 0–100
  tone: BucketTone;
}

interface FieldPayload {
  generated_at?: string;
  stats: FieldStatDto[];
  load_buckets: LoadBucketDto[];
}

// designData keeps the design-native shape (pct '53%', color hex); the API
// speaks numbers + tones, so map the fallback into the contract shape here.
const COLOR_TO_TONE: Record<string, BucketTone> = {
  '#3E7A55': 'good',
  '#8A6A2A': 'warn',
  '#A8443B': 'bad',
  '#B7BAC0': 'muted',
};

const FALLBACK: FieldPayload = {
  stats: fieldStats.map((s) => ({ label: s.label, value: s.value })),
  load_buckets: loadBuckets.map((b) => ({
    label: b.label,
    count: b.count,
    pct: parseFloat(b.pct),
    tone: COLOR_TO_TONE[b.color] ?? 'muted',
  })),
};

/** Bucket bar colour: contract tones via color(), `muted` owned by the frontend. */
function bucketColor(tone: BucketTone): string {
  return tone === 'muted' ? '#B7BAC0' : color(tone);
}

export default function Field() {
  const data = useApiGet<FieldPayload>('/command-centre/field', FALLBACK);

  return (
    <div>
      <p
        style={{
          fontSize: 13.5,
          color: '#757C86',
          margin: '0 0 28px',
          maxWidth: 640,
          lineHeight: 1.5,
        }}
      >
        Church coverage and pastoral load across the conference. Names are held in the local
        source only; this view shows structure and distribution.
      </p>

      {/* Field stat tiles */}
      <div className="cc-scroll-x" style={{ marginBottom: 34 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5,1fr)',
          gap: 1,
          background: '#E7E5DF',
          border: '1px solid #E7E5DF',
          borderRadius: 12,
          overflow: 'hidden',
        }}
      >
        {data.stats.map((s) => (
          <div key={s.label} style={{ background: '#FFFFFF', padding: 20 }}>
            <div
              style={{
                fontFamily: FONT,
                fontSize: 9,
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
                fontSize: 32,
                color: '#1B2430',
                fontVariantNumeric: 'tabular-nums',
                marginTop: 12,
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
      </div>

      <div
        className="cc-grid-2"
        style={{
          gap: 26,
          alignItems: 'start',
        }}
      >
        {/* Pastoral load distribution */}
        <div>
          <div
            style={{
              fontFamily: FONT,
              fontSize: 10,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: '#9AA0A8',
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            Pastoral load distribution
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {data.load_buckets.map((b) => (
              <div key={b.label}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    marginBottom: 7,
                  }}
                >
                  <span style={{ fontSize: 13.5, color: '#1B2430' }}>{b.label}</span>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: '#757C86',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {b.count}
                  </span>
                </div>
                <div
                  style={{
                    height: 8,
                    borderRadius: 4,
                    background: '#ECEAE4',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      height: '100%',
                      width: `${b.pct}%`,
                      background: bucketColor(b.tone),
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coverage note */}
        <div
          style={{
            background: '#FFFFFF',
            border: '1px solid #E7E5DF',
            borderRadius: 12,
            padding: 22,
          }}
        >
          <div
            style={{
              fontFamily: FONT,
              fontSize: 10,
              letterSpacing: '.12em',
              textTransform: 'uppercase',
              color: '#9AA0A8',
              fontWeight: 500,
              marginBottom: 14,
            }}
          >
            Coverage note
          </div>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: '#5B626C',
              margin: '0 0 16px',
              fontWeight: 300,
            }}
          >
            Six districts are vacant or awaiting appointment. Each vacancy is both a cost saving
            and a gap in ministry capacity — read the field budget and person-cost pages
            together, never as one number.
          </p>
          <div
            style={{
              borderTop: '1px solid #EFEDE7',
              paddingTop: 14,
              fontSize: 12.5,
              color: '#9AA0A8',
              lineHeight: 1.5,
            }}
          >
            Source: canonical pastoral-map snapshot · sanitized assignments · attendance import.
          </div>
        </div>
      </div>
    </div>
  );
}

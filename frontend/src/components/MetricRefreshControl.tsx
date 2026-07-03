'use client';

// Reusable per-metric refresh control. Sits inside a dashboard card, bound to
// that card's backend metric id, and drives a scoped read-only MYOB pull via
// the shared useMetricRefresh hook. Shows a loading spinner while the pull runs,
// a brief success tick, an error tone on failure, and an "as of <timestamp>"
// provenance line once a fresh value has landed. Independent per instance, so
// two cards can refresh concurrently.
//
// Visual language matches the design cards (Overview.tsx / MyobRefreshPanel.tsx):
// uppercase micro-labels in #9AA0A8, status colours via format.color, the same
// ink/neutral palette. Renders inline (no layout jump) so it can tuck into a
// card's header row.

import { useEffect, type CSSProperties } from 'react';
import { FONT, color } from '@/lib/format';
import { useMetricRefresh } from '@/lib/useMetricRefresh';
import type { MetricRefreshDoc } from '@/lib/useMetricRefresh';

interface Props {
  /** Backend metric id — MUST match the backend registry exactly. */
  id: string;
  /** Scoped pull endpoint (relative to the /api base). */
  endpoint: string;
  /**
   * Called with the fresh doc on a successful pull so the parent card can swap
   * its displayed figure(s) in place from `doc.value`. The control itself only
   * owns the status affordance + provenance line.
   */
  onRefreshed?: (result: MetricRefreshDoc) => void;
}

// "as of 2026-07-03 14:02" — trims the ISO string the way MyobRefreshPanel does.
function asOfLabel(asOf: string | null): string {
  if (!asOf) return '';
  return 'as of ' + asOf.replace('T', ' ').slice(0, 16);
}

const buttonBase: CSSProperties = {
  fontFamily: FONT,
  fontSize: 9.5,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 500,
  border: '1px solid #E7E5DF',
  borderRadius: 6,
  background: '#FFFFFF',
  padding: '4px 9px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  whiteSpace: 'nowrap',
  lineHeight: 1,
};

const provenanceStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 9.5,
  letterSpacing: '.04em',
  color: '#9AA0A8',
  marginTop: 6,
  lineHeight: 1.4,
};

export default function MetricRefreshControl({ id, endpoint, onRefreshed }: Props) {
  const { phase, result, error, refresh } = useMetricRefresh(id, endpoint);

  const handleClick = async () => {
    if (phase === 'loading') return;
    await refresh();
  };

  // Forward each fresh doc to the parent card so it can swap its figure in
  // place. Keyed on `result` identity: the hook mints a new object per
  // successful pull, so this fires once per refresh, never in a render loop.
  useEffect(() => {
    if (phase === 'success' && result && onRefreshed) onRefreshed(result);
    // onRefreshed is a stable callback in every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const label =
    phase === 'loading' ? 'Refreshing' : phase === 'success' ? 'Refreshed' : phase === 'error' ? 'Retry' : 'Refresh';

  const dotColor =
    phase === 'success' ? color('good') : phase === 'error' ? color('bad') : '#9AA0A8';

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={phase === 'loading'}
        aria-label={`Refresh ${id} from MYOB`}
        style={{
          ...buttonBase,
          color: phase === 'error' ? color('bad') : '#5B626C',
          cursor: phase === 'loading' ? 'default' : 'pointer',
          opacity: phase === 'loading' ? 0.7 : 1,
        }}
      >
        {phase === 'loading' ? (
          <span
            aria-hidden
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              border: '1.5px solid #C9CDD3',
              borderTopColor: '#5B626C',
              display: 'inline-block',
              animation: 'mrc-spin 0.7s linear infinite',
            }}
          />
        ) : (
          <span
            aria-hidden
            style={{ width: 5, height: 5, borderRadius: '50%', background: dotColor, display: 'inline-block' }}
          />
        )}
        {label}
      </button>

      {phase === 'error' && error && (
        <div style={{ ...provenanceStyle, color: color('bad') }}>{error}</div>
      )}
      {phase === 'success' && result && (
        <div style={provenanceStyle}>
          {asOfLabel(result.as_of)}
          {result.provenance?.source ? ` · ${result.provenance.source}` : ''}
        </div>
      )}

      {/* Local keyframes for the spinner; scoped by the unique animation name. */}
      <style>{`@keyframes mrc-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

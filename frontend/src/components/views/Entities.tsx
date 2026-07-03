'use client';

// Entity statements view — faithful port of template.html lines 575-596.
// Data: GET /api/command-centre/entities (contract §8) with designData fallback.

import Link from 'next/link';
import { useApiGet } from '@/lib/api';
import { entDefs } from '@/lib/designData';
import { fmtF, FONT } from '@/lib/format';

interface EntityRow {
  name: string;
  scope: string;
  income: number;
  expense: number;
  net: number;
}

interface EntitiesPayload {
  generated_at?: string;
  entities: EntityRow[];
  total: { income: number; expense: number; net: number };
}

// Seven-entity health strip — GET /api/entities (entitiesService.getEntitiesList).
// Signals are workbook-extract reconciliation figures; null means "not extracted
// yet" and must render as the literal word "Placeholder", never as $0.
interface EntitySignalRow {
  id: string;
  title: string;
  operating_signal: number | null;
  cash_on_hand: number | null;
  staff_cost_signal: number | null;
  status: string;
  data_state: string;
}

interface EntitySignalsPayload {
  entities: EntitySignalRow[];
  total: number;
  limit: number;
  offset: number;
}

// Empty fallback: with no rows the signals section renders nothing, so the
// view is unchanged when the backend is down (no design figures to invent).
const signalsFallback: EntitySignalsPayload = { entities: [], total: 0, limit: 100, offset: 0 };

const fallback: EntitiesPayload = (() => {
  const entities = entDefs.map((e) => ({
    name: e.name,
    scope: e.scope,
    income: e.income,
    expense: e.expense,
    net: e.income - e.expense,
  }));
  const income = entDefs.reduce((a, e) => a + e.income, 0);
  const expense = entDefs.reduce((a, e) => a + e.expense, 0);
  return { entities, total: { income, expense, net: income - expense } };
})();

const cellLabelStyle = (color: string): React.CSSProperties => ({
  fontFamily: FONT,
  fontSize: 9,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color,
  fontWeight: 500,
  marginBottom: 5,
});

const cellValueStyle = (color: string): React.CSSProperties => ({
  fontSize: 17,
  color,
  fontVariantNumeric: 'tabular-nums',
});

// display:grid + gridTemplateColumns move to the .cc-grid-entity utility class so
// the row can collapse (3-col metric band at tablet, 1-col at phone) without
// changing desktop pixels. Every row that used this object also gets that class.
const rowGridStyle: React.CSSProperties = {
  borderRadius: 12,
  padding: '22px 24px',
  gap: 20,
  alignItems: 'center',
};

const eyebrowStyle: React.CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
};

const pillStyle = (fg: string, bg: string): React.CSSProperties => ({
  display: 'inline-block',
  fontFamily: FONT,
  fontSize: 10.5,
  fontWeight: 500,
  color: fg,
  background: bg,
  borderRadius: 999,
  padding: '3px 10px',
  whiteSpace: 'nowrap',
});

// Python parity: a null signal is a not-extracted-yet placeholder — render the
// word, never fmtF(null) (which would print a false $0).
const SignalCell = ({ value }: { value: number | null }) =>
  value === null ? (
    <span style={{ fontSize: 12, color: '#9AA0A8' }}>Placeholder</span>
  ) : (
    <span style={{ fontSize: 12, color: '#39424F', fontVariantNumeric: 'tabular-nums' }}>{fmtF(value)}</span>
  );

export default function Entities() {
  const fetched = useApiGet<EntitiesPayload>('/command-centre/entities', fallback);
  const payload = fetched && Array.isArray(fetched.entities) && fetched.total ? fetched : fallback;

  const { entities, total } = payload;

  const signalsFetched = useApiGet<EntitySignalsPayload>('/api/entities', signalsFallback);
  const signalRows = Array.isArray(signalsFetched?.entities) ? signalsFetched.entities : [];

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
        Approved FY2026 income and expense by reporting entity. The conference and Adventist
        Alpine Village are budgeted separately, then consolidated.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
        {entities.map((e) => (
          <div
            key={e.name}
            className="cc-grid-entity"
            style={{
              ...rowGridStyle,
              background: '#FFFFFF',
              border: '1px solid #E7E5DF',
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#1B2430' }}>{e.name}</div>
              <div style={{ fontSize: 12, color: '#9AA0A8', marginTop: 3 }}>{e.scope}</div>
            </div>
            <div>
              <div style={cellLabelStyle('#9AA0A8')}>Income</div>
              <div style={cellValueStyle('#1B2430')}>{fmtF(e.income)}</div>
            </div>
            <div>
              <div style={cellLabelStyle('#9AA0A8')}>Expense</div>
              <div style={cellValueStyle('#1B2430')}>{fmtF(e.expense)}</div>
            </div>
            <div>
              <div style={cellLabelStyle('#9AA0A8')}>Net</div>
              <div style={cellValueStyle(e.net < 0 ? '#A8443B' : '#3E7A55')}>{fmtF(e.net)}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="cc-grid-entity" style={{ ...rowGridStyle, background: '#1B2430' }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 500, color: '#FFFFFF' }}>Consolidated</div>
          <div style={{ fontSize: 12, color: '#9AA6B2', marginTop: 3 }}>
            All entities · FY2026 approved
          </div>
        </div>
        <div>
          <div style={cellLabelStyle('#8894A2')}>Income</div>
          <div style={cellValueStyle('#FFFFFF')}>{fmtF(total.income)}</div>
        </div>
        <div>
          <div style={cellLabelStyle('#8894A2')}>Expense</div>
          <div style={cellValueStyle('#FFFFFF')}>{fmtF(total.expense)}</div>
        </div>
        <div>
          <div style={cellLabelStyle('#8894A2')}>Net</div>
          <div style={cellValueStyle('#7FB99A')}>{fmtF(total.net)}</div>
        </div>
      </div>
      {/* Seven-entity health strip (GET /api/entities). Hidden entirely when the
          fetch fails — the empty fallback has no rows, so nothing is invented. */}
      {signalRows.length > 0 && (
        <div style={{ marginTop: 44 }}>
          <div style={{ ...eyebrowStyle, marginBottom: 18 }}>Entity signals</div>
          {/* Wide fixed-column flex table: transparent on desktop, horizontal-scroll
              container below tablet so the fixed 110/140px columns don't crush. */}
          <div className="cc-scroll-x">
          <div style={{ background: '#FFFFFF', border: '1px solid #E7E5DF', borderRadius: 12, padding: '22px 24px' }}>
            <div style={{ display: 'flex', gap: 16, paddingBottom: 10, borderBottom: '1px solid #E7E5DF' }}>
              <span style={{ ...eyebrowStyle, flex: 1 }}>Entity</span>
              <span style={{ ...eyebrowStyle, width: 110, flex: 'none', textAlign: 'right' }}>Operating signal</span>
              <span style={{ ...eyebrowStyle, width: 110, flex: 'none', textAlign: 'right' }}>Cash on hand</span>
              <span style={{ ...eyebrowStyle, width: 110, flex: 'none', textAlign: 'right' }}>Staff-cost signal</span>
              <span style={{ ...eyebrowStyle, width: 140, flex: 'none', textAlign: 'right' }}>Status</span>
            </div>
            {signalRows.map((row) => (
              <div key={row.id} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '11px 0', borderBottom: '1px solid #F3F1EC' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
                  {/* Row title opens the per-entity detail page (evidence drawers live there). */}
                  <Link
                    href={`/entities/${row.id}`}
                    style={{
                      fontSize: 12.5,
                      color: '#1B2430',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      textDecoration: 'underline',
                      textDecorationColor: '#D8D4CB',
                      textUnderlineOffset: 3,
                    }}
                  >
                    {row.title}
                  </Link>
                  <span style={{ ...eyebrowStyle, fontSize: 8.5, flex: 'none' }}>{row.data_state}</span>
                </span>
                <span style={{ width: 110, flex: 'none', textAlign: 'right' }}>
                  <SignalCell value={row.operating_signal} />
                </span>
                <span style={{ width: 110, flex: 'none', textAlign: 'right' }}>
                  <SignalCell value={row.cash_on_hand} />
                </span>
                <span style={{ width: 110, flex: 'none', textAlign: 'right' }}>
                  <SignalCell value={row.staff_cost_signal} />
                </span>
                <span style={{ width: 140, flex: 'none', textAlign: 'right' }}>
                  <span
                    style={
                      row.status === 'watch'
                        ? pillStyle('#8A6A2A', 'rgba(201,162,75,.16)')
                        : pillStyle('#757C86', '#F1EFEA')
                    }
                  >
                    {row.status}
                  </span>
                </span>
              </div>
            ))}
          </div>
          </div>
          <p style={{ fontSize: 12, color: '#9AA0A8', margin: '12px 0 0', lineHeight: 1.5 }}>
            Cash-on-hand figures are workbook-extract based reconciliation signals, not statement
            balances {'—'} see the Cash page for the source rule.
          </p>
        </div>
      )}
      <p style={{ fontSize: 12.5, color: '#9AA0A8', margin: '18px 0 0', lineHeight: 1.5 }}>
        Education, Community Services and Faith FM roll into the conference statement. The entity
        signal model {signalRows.length > 0 ? 'above ' : ''}is served live from indexed workbook
        extracts; {'“'}Placeholder{'”'} means a figure has not been extracted yet {'—'} it is not
        zero and not safe.
      </p>
    </div>
  );
}

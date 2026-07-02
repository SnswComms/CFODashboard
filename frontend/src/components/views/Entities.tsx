'use client';

// Entity statements view — faithful port of template.html lines 575-596.
// Data: GET /api/command-centre/entities (contract §8) with designData fallback.

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

const rowGridStyle: React.CSSProperties = {
  borderRadius: 12,
  padding: '22px 24px',
  display: 'grid',
  gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
  gap: 20,
  alignItems: 'center',
};

export default function Entities() {
  const fetched = useApiGet<EntitiesPayload>('/command-centre/entities', fallback);
  const payload = fetched && Array.isArray(fetched.entities) && fetched.total ? fetched : fallback;

  const { entities, total } = payload;

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
      <div style={{ ...rowGridStyle, background: '#1B2430' }}>
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
      <p style={{ fontSize: 12.5, color: '#9AA0A8', margin: '18px 0 0', lineHeight: 1.5 }}>
        Education, Community Services and Faith FM roll into the conference statement; standalone
        entity pages appear here once their source workbooks are indexed.
      </p>
    </div>
  );
}

'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useApiGet } from '@/lib/api';
import { useDateRange } from '@/lib/dateRange';
import { fmtC, fmtF, FONT } from '@/lib/format';
import { titheChurches, titheConference } from '@/lib/designData';

const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const eyebrowStyle: CSSProperties = {
  fontFamily: FONT,
  fontSize: 10,
  letterSpacing: '.12em',
  textTransform: 'uppercase',
  color: '#9AA0A8',
  fontWeight: 500,
};

const cardStyle: CSSProperties = {
  background: '#FFFFFF',
  border: '1px solid #E7E5DF',
  borderRadius: 12,
};

const TABLE_PAGE_SIZE = 12;
const COMPARISON_COLORS = ['#3E7A55', '#8A6A2A', '#2F6690', '#A8443B', '#6A5D9B', '#B56B35', '#25736F', '#6E7783'];

const sum = (values: number[]) => values.reduce((acc, value) => acc + value, 0);

function monthIndex(label: string) {
  return MONTHS_SHORT.findIndex((month) => month.toLowerCase() === String(label).slice(0, 3).toLowerCase());
}

function asOfMonthIndex(asOf: string, monthly: Array<{ month: string; current: number }>) {
  const fromLabel = MONTHS_FULL.findIndex((month) => String(asOf).toLowerCase().includes(month.toLowerCase()));
  if (fromLabel >= 0) return fromLabel;
  const lastReported = monthly.reduce((latest, row, index) => (Number(row.current) > 0 ? index : latest), -1);
  return lastReported >= 0 ? lastReported : 0;
}

function monthRangeForPreset(key: string, asOfIndex: number) {
  if (key === 'month') return { from: asOfIndex, to: asOfIndex };
  if (key === 'quarter') {
    const quarterStart = Math.floor(asOfIndex / 3) * 3;
    return { from: quarterStart, to: asOfIndex };
  }
  if (key === 'year' || key === '12m') return { from: 0, to: 11 };
  return { from: 0, to: asOfIndex };
}

function monthInCustomRange(label: string, from: string, to: string) {
  const index = monthIndex(label);
  if (index < 0) return true;
  const monthStart = `2026-${String(index + 1).padStart(2, '0')}-01`;
  return monthStart >= from.slice(0, 7) + '-01' && monthStart <= to.slice(0, 7) + '-01';
}

function filterMonthly<T extends { month: string; current: number }>(monthly: T[], range: { key: string; from: string; to: string }, asOf: string) {
  if (range.key !== 'custom') {
    const bounds = monthRangeForPreset(range.key, asOfMonthIndex(asOf, monthly));
    return monthly.filter((row) => {
      const index = monthIndex(row.month);
      return index >= bounds.from && index <= bounds.to;
    });
  }
  const filtered = monthly.filter((row) => monthInCustomRange(row.month, range.from, range.to));
  return filtered.length > 0 ? filtered : monthly;
}

interface TitheDashboardChurch {
  id: string;
  name: string;
  district: string;
  pastor: string;
  members: number;
  recipient?: string;
  monthly: Array<{ month: string; current: number; prior: number; conference: number }>;
}

interface TitheDashboardPayload {
  generated_at: string | null;
  conference: {
    name: string;
    as_of: string;
    monthly_email: string;
    churches_reporting: number;
    churches_total: number;
    year_target: number;
    prior_year_total: number;
  };
  churches: TitheDashboardChurch[];
  default_church_id: string | null;
  email_automation: {
    cadence: string;
    trigger: string;
    endpoint: string;
    mode: string;
  };
}

const FALLBACK: TitheDashboardPayload = {
  generated_at: null,
  conference: {
    name: titheConference.name,
    as_of: titheConference.asOf,
    monthly_email: titheConference.monthlyEmail,
    churches_reporting: titheConference.churchesReporting,
    churches_total: titheConference.churchesTotal,
    year_target: titheConference.yearTarget,
    prior_year_total: titheConference.priorYearTotal,
  },
  churches: titheChurches.map((church, index) => ({
    id: index === 0 ? 'wagga-wagga' : 'canberra-national',
    ...church,
  })),
  default_church_id: 'wagga-wagga',
  email_automation: {
    cadence: 'monthly',
    trigger: '5th business day after month close',
    endpoint: '/api/tithe/monthly-email/trigger',
    mode: 'dry-run',
  },
};

function pct(value: number) {
  return (value * 100).toFixed(1) + '%';
}

function clampPct(value: number) {
  return `${Math.max(0, Math.min(value, 1)) * 100}%`;
}

function periodCopy(key: string, selectedMonthCount: number) {
  if (key === 'month' || selectedMonthCount === 1) {
    return {
      noun: 'Month',
      label: 'Local tithe · month',
      comparison: 'vs same month last year',
      share: 'of conference this month',
      tableHeader: 'Month',
      sentence: 'for the selected month',
    };
  }
  if (key === 'quarter') {
    return {
      noun: 'Quarter',
      label: 'Local tithe · quarter',
      comparison: 'vs same quarter last year',
      share: 'of conference this quarter',
      tableHeader: 'Quarter',
      sentence: 'for the selected quarter',
    };
  }
  if (key === 'custom') {
    return {
      noun: 'Period',
      label: 'Local tithe · period',
      comparison: 'vs same period last year',
      share: 'of conference in this period',
      tableHeader: 'Period',
      sentence: 'for the selected period',
    };
  }
  return {
    noun: 'YTD',
    label: 'Local tithe · YTD',
    comparison: 'vs last year YTD',
    share: 'of conference YTD',
    tableHeader: 'YTD',
    sentence: 'year-to-date',
  };
}

function buildPath(values: number[], max: number, width: number, height: number, padX: number, padY: number) {
  const denom = Math.max(1, values.length - 1);
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;
  return values
    .map((value, i) => {
      const x = padX + (i / denom) * plotW;
      const y = padY + plotH - (value / max) * plotH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

export default function Tithe() {
  const dateRange = useDateRange();
  const data = useApiGet<TitheDashboardPayload>('/tithe/dashboard', FALLBACK);
  const defaultChurchId = data.default_church_id ?? data.churches[0]?.id ?? FALLBACK.default_church_id;
  const [selectedChurchId, setSelectedChurchId] = useState<string | null>(null);
  const [comparisonChurchIds, setComparisonChurchIds] = useState<string[]>([]);
  const [comparisonFilter, setComparisonFilter] = useState('');
  const [tablePage, setTablePage] = useState(0);
  const validChurchIds = new Set(data.churches.map((item) => item.id));
  const effectiveSelectedChurchId = selectedChurchId && validChurchIds.has(selectedChurchId) ? selectedChurchId : defaultChurchId;
  const defaultComparisonChurchIds = [defaultChurchId, data.churches.find((item) => item.id !== defaultChurchId)?.id]
    .filter((id): id is string => Boolean(id));
  const effectiveComparisonChurchIds = comparisonChurchIds.filter((id) => validChurchIds.has(id));
  const selectedComparisonIds = effectiveComparisonChurchIds.length > 0 ? effectiveComparisonChurchIds : defaultComparisonChurchIds;
  const church = data.churches.find((item) => item.id === effectiveSelectedChurchId) ?? data.churches[0] ?? FALLBACK.churches[0];
  const conference = data.conference;
  const selectedMonthly = filterMonthly(church.monthly, dateRange, conference.as_of);
  const selectedMonthCount = selectedMonthly.length;
  const currentYtd = sum(selectedMonthly.map((m) => m.current));
  const priorYtd = sum(selectedMonthly.map((m) => m.prior));
  const conferenceYtd = sum(selectedMonthly.map((m) => m.conference));
  const fullPrior = sum(church.monthly.map((m) => m.prior));
  const yoyDelta = currentYtd - priorYtd;
  const yoyPct = priorYtd ? yoyDelta / priorYtd : 0;
  const conferenceShare = conferenceYtd ? currentYtd / conferenceYtd : 0;
  const conferencePace = conferenceYtd / conference.year_target;
  const projectedFullYear = selectedMonthCount ? Math.round((currentYtd / selectedMonthCount) * 12) : 0;
  const projectedVsPrior = fullPrior ? projectedFullYear / fullPrior - 1 : 0;
  const lastSelected = selectedMonthly[selectedMonthly.length - 1] ?? church.monthly[0];
  const asOfIndex = monthIndex(lastSelected?.month ?? 'Jan');
  const asOfMonth = MONTHS_FULL[Math.max(0, asOfIndex)];
  const periodLabel = dateRange.key === 'fytd' ? `${asOfMonth} year-to-date` : dateRange.label;
  const copy = periodCopy(dateRange.key, selectedMonthCount);

  const filteredComparisonChurches = useMemo(() => {
    const term = comparisonFilter.trim().toLowerCase();
    if (!term) return data.churches;
    return data.churches.filter((item) =>
      [item.name, item.district, item.pastor].some((value) => String(value || '').toLowerCase().includes(term))
    );
  }, [comparisonFilter, data.churches]);

  const comparisonRows = data.churches
    .filter((item) => selectedComparisonIds.includes(item.id))
    .map((item) => {
      const months = filterMonthly(item.monthly, dateRange, conference.as_of);
      const current = sum(months.map((m) => m.current));
      const prior = sum(months.map((m) => m.prior));
      const conf = sum(months.map((m) => m.conference));
      return {
        church: item,
        months,
        current,
        prior,
        delta: current - prior,
        movement: prior ? current / prior - 1 : 0,
        share: conf ? current / conf : 0,
        average: months.length ? current / months.length : 0,
      };
    })
    .sort((a, b) => selectedComparisonIds.indexOf(a.church.id) - selectedComparisonIds.indexOf(b.church.id));
  const comparisonMonthLabels = comparisonRows[0]?.months.map((month) => month.month) ?? selectedMonthly.map((month) => month.month);
  const comparisonTotal = sum(comparisonRows.map((row) => row.current));
  const strongestComparison = [...comparisonRows].sort((a, b) => b.movement - a.movement)[0] ?? null;
  const comparisonPriorTotal = sum(comparisonRows.map((row) => row.prior));
  const comparisonDelta = comparisonTotal - comparisonPriorTotal;
  const comparisonYoY = comparisonPriorTotal ? comparisonDelta / comparisonPriorTotal : 0;

  const chartW = 680;
  const chartH = 250;
  const maxComparisonChart =
    Math.ceil(Math.max(...comparisonRows.flatMap((row) => row.months.map((month) => month.current)), 1) / 10000) * 10000;

  const toggleComparisonChurch = (churchId: string) => {
    setComparisonChurchIds((ids) => {
      const baseIds = ids.length > 0 ? ids : selectedComparisonIds;
      return baseIds.includes(churchId) ? baseIds.filter((id) => id !== churchId) : [...baseIds, churchId];
    });
  };

  const addPrimaryToComparison = (churchId: string) => {
    setSelectedChurchId(churchId);
    setComparisonChurchIds((ids) => (ids.includes(churchId) ? ids : [...ids, churchId]));
  };

  const kpis = [
    {
      label: copy.label,
      value: fmtC(currentYtd),
      note: `${yoyDelta >= 0 ? '+' : '-'}${fmtF(Math.abs(yoyDelta))} ${copy.comparison}`,
      color: yoyDelta >= 0 ? '#3E7A55' : '#A8443B',
    },
    {
      label: 'Year-over-year',
      value: pct(yoyPct),
      note: periodLabel,
      color: yoyPct >= 0 ? '#3E7A55' : '#A8443B',
    },
    {
      label: 'Conference share',
      value: pct(conferenceShare),
      note: `${church.name} ${copy.share}`,
      color: '#8A6A2A',
    },
    {
      label: 'Projected full year',
      value: fmtC(projectedFullYear),
      note: `${pct(projectedVsPrior)} vs FY2025`,
      color: projectedVsPrior >= 0 ? '#3E7A55' : '#A8443B',
    },
  ];

  const churchRows = data.churches.map((c) => {
    const months = filterMonthly(c.monthly, dateRange, conference.as_of);
    const ytd = sum(months.map((m) => m.current));
    const prior = sum(months.map((m) => m.prior));
    const conf = sum(months.map((m) => m.conference));
    return {
      name: c.name,
      district: c.district,
      ytd,
      prior,
      share: conf ? ytd / conf : 0,
      movement: prior ? ytd / prior - 1 : 0,
    };
  });
  const pageCount = Math.max(1, Math.ceil(churchRows.length / TABLE_PAGE_SIZE));
  const currentTablePage = Math.min(tablePage, pageCount - 1);
  const paginatedChurchRows = churchRows.slice(
    currentTablePage * TABLE_PAGE_SIZE,
    currentTablePage * TABLE_PAGE_SIZE + TABLE_PAGE_SIZE
  );
  const firstTableRow = churchRows.length ? currentTablePage * TABLE_PAGE_SIZE + 1 : 0;
  const lastTableRow = Math.min(churchRows.length, (currentTablePage + 1) * TABLE_PAGE_SIZE);
  const emailContents = [
    ['Local tracking', `${church.name} is ${pct(yoyPct)} year-over-year ${copy.sentence}.`],
    ['Conference context', `The church represents ${pct(conferenceShare)} ${copy.share}.`],
    ['Big picture', `${conference.churches_reporting} of ${conference.churches_total} churches have reported for ${conference.as_of}.`],
    ['Transparency note', 'Figures are draft until month-end close and treasury reconciliation are complete.'],
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'end', flexWrap: 'wrap', marginBottom: 30 }}>
        <p
          style={{
            fontSize: 15,
            lineHeight: 1.55,
            color: '#5B626C',
            margin: 0,
            maxWidth: 720,
            fontWeight: 300,
          }}
        >
          A monthly church-facing one-pager for tithe transparency: local giving against last year,
          month-by-month movement, and the church&apos;s share of the wider conference position.
        </p>
        <label style={{ display: 'grid', gap: 7, minWidth: 260 }}>
          <span style={eyebrowStyle}>Church</span>
          <select
            className="num-input"
            value={church.id}
            onChange={(event) => addPrimaryToComparison(event.target.value)}
            style={{ cursor: 'pointer' }}
          >
            {data.churches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div style={{ ...cardStyle, padding: 22, marginBottom: 30 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'start', flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <div style={eyebrowStyle}>Church comparison</div>
            <div style={{ marginTop: 8, fontSize: 13, color: '#5B626C' }}>
              {comparisonRows.length} selected · {periodLabel}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setComparisonChurchIds(data.churches.map((item) => item.id))}
              style={{
                border: '1px solid #E7E5DF',
                background: '#FFFFFF',
                color: '#1B2430',
                borderRadius: 8,
                padding: '8px 11px',
                cursor: 'pointer',
                fontFamily: FONT,
                fontSize: 12,
              }}
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => setComparisonChurchIds(church.id ? [church.id] : [])}
              style={{
                border: '1px solid #E7E5DF',
                background: '#FFFFFF',
                color: '#1B2430',
                borderRadius: 8,
                padding: '8px 11px',
                cursor: 'pointer',
                fontFamily: FONT,
                fontSize: 12,
              }}
            >
              Clear
            </button>
          </div>
        </div>

        <div className="cc-grid-2-wide" style={{ gap: 22, alignItems: 'start' }}>
          <div>
            <div className="cc-scroll-x">
              <div style={{ minWidth: 680 }}>
                <svg viewBox={`0 0 ${chartW} ${chartH}`} width="100%" height="auto" style={{ display: 'block' }}>
                  {[0, 0.25, 0.5, 0.75, 1].map((step) => {
                    const y = 24 + (1 - step) * (chartH - 48);
                    const value = maxComparisonChart * step;
                    return (
                      <g key={step}>
                        <line x1={46} y1={y} x2={660} y2={y} stroke="#EFEDE7" strokeWidth={1} />
                        <text x={38} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="#9AA0A8" style={{ fontFamily: FONT }}>
                          {fmtC(value)}
                        </text>
                      </g>
                    );
                  })}
                  {comparisonRows.map((row, rowIndex) => (
                    <polyline
                      key={row.church.id}
                      points={buildPath(
                        row.months.map((month) => month.current || 0),
                        maxComparisonChart,
                        chartW,
                        chartH,
                        46,
                        24
                      )}
                      fill="none"
                      stroke={COMPARISON_COLORS[rowIndex % COMPARISON_COLORS.length]}
                      strokeWidth={2.3}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                  {comparisonMonthLabels.map((month, i) => {
                    const denom = Math.max(1, comparisonMonthLabels.length - 1);
                    const x = 46 + (i / denom) * (chartW - 92);
                    return (
                      <text key={month} x={x} y={238} textAnchor="middle" fontSize={9} fill="#9AA0A8" style={{ fontFamily: FONT }}>
                        {month}
                      </text>
                    );
                  })}
                </svg>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 14 }}>
              {comparisonRows.map((row, rowIndex) => (
                <span key={row.church.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 11.5, color: '#5B626C' }}>
                  <span style={{ width: 16, height: 2, background: COMPARISON_COLORS[rowIndex % COMPARISON_COLORS.length], display: 'inline-block', borderRadius: 2 }} />
                  {row.church.name}
                </span>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gap: 14 }}>
            <div className="cc-grid-2" style={{ gap: 10 }}>
              <div style={{ border: '1px solid #EFEDE7', borderRadius: 8, padding: 14 }}>
                <div style={eyebrowStyle}>Selected total</div>
                <div style={{ fontFamily: FONT, fontWeight: 300, fontSize: 26, color: '#1B2430', marginTop: 8, fontVariantNumeric: 'tabular-nums' }}>
                  {fmtC(comparisonTotal)}
                </div>
                <div style={{ marginTop: 6, color: comparisonYoY >= 0 ? '#3E7A55' : '#A8443B', fontSize: 12 }}>
                  {comparisonDelta >= 0 ? '+' : '-'}{fmtF(Math.abs(comparisonDelta))} {copy.comparison}
                </div>
              </div>
              <div style={{ border: '1px solid #EFEDE7', borderRadius: 8, padding: 14 }}>
                <div style={eyebrowStyle}>Strongest YoY</div>
                <div style={{ fontFamily: FONT, fontWeight: 300, fontSize: 26, color: '#1B2430', marginTop: 8 }}>
                  {strongestComparison ? pct(strongestComparison.movement) : '0.0%'}
                </div>
                <div style={{ marginTop: 6, color: '#757C86', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {strongestComparison?.church.name ?? 'No church selected'}
                </div>
              </div>
            </div>

            <input
              className="num-input"
              value={comparisonFilter}
              onChange={(event) => setComparisonFilter(event.target.value)}
              placeholder="Search churches or districts"
              aria-label="Search churches for comparison"
            />
            <div style={{ maxHeight: 190, overflow: 'auto', border: '1px solid #EFEDE7', borderRadius: 8 }}>
              {filteredComparisonChurches.map((item) => (
                <label
                  key={item.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    borderBottom: '1px solid #F3F1EC',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={selectedComparisonIds.includes(item.id)}
                    onChange={() => toggleComparisonChurch(item.id)}
                    style={{ width: 15, height: 15, accentColor: '#1B2430', flex: 'none' }}
                  />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, color: '#1B2430', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#9AA0A8', marginTop: 2 }}>{item.district}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="cc-scroll-x" style={{ marginTop: 20 }}>
          <div style={{ minWidth: 760 }}>
            <div style={{ display: 'flex', gap: 18, paddingBottom: 10, borderBottom: '1px solid #E7E5DF' }}>
              <span style={{ ...eyebrowStyle, flex: 1 }}>Church</span>
              <span style={{ ...eyebrowStyle, width: 128, textAlign: 'right' }}>{copy.tableHeader}</span>
              <span style={{ ...eyebrowStyle, width: 110, textAlign: 'right' }}>Prior</span>
              <span style={{ ...eyebrowStyle, width: 90, textAlign: 'right' }}>YoY</span>
              <span style={{ ...eyebrowStyle, width: 100, textAlign: 'right' }}>Average</span>
              <span style={{ ...eyebrowStyle, width: 96, textAlign: 'right' }}>Share</span>
            </div>
            {comparisonRows.map((row, rowIndex) => (
              <div key={row.church.id} style={{ display: 'flex', alignItems: 'baseline', gap: 18, padding: '12px 0', borderBottom: '1px solid #F3F1EC' }}>
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 9 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: COMPARISON_COLORS[rowIndex % COMPARISON_COLORS.length], flex: 'none' }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, color: '#1B2430', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.church.name}</span>
                    <span style={{ display: 'block', fontSize: 11.5, color: '#9AA0A8', marginTop: 2 }}>{row.church.district}</span>
                  </span>
                </span>
                <span style={{ width: 128, textAlign: 'right', fontSize: 12, color: '#39424F', fontVariantNumeric: 'tabular-nums' }}>{fmtF(row.current)}</span>
                <span style={{ width: 110, textAlign: 'right', fontSize: 12, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>{fmtF(row.prior)}</span>
                <span style={{ width: 90, textAlign: 'right', fontSize: 12, color: row.movement >= 0 ? '#3E7A55' : '#A8443B', fontVariantNumeric: 'tabular-nums' }}>{pct(row.movement)}</span>
                <span style={{ width: 100, textAlign: 'right', fontSize: 12, color: '#39424F', fontVariantNumeric: 'tabular-nums' }}>{fmtF(row.average)}</span>
                <span style={{ width: 96, textAlign: 'right', fontSize: 12, color: '#8A6A2A', fontVariantNumeric: 'tabular-nums' }}>{pct(row.share)}</span>
              </div>
            ))}
            {comparisonRows.length === 0 && (
              <div style={{ padding: '20px 0 4px', color: '#757C86', fontSize: 12.5 }}>
                No churches selected.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="cc-grid-4" style={{ gap: 12, marginBottom: 30 }}>
        {kpis.map((k) => (
          <div key={k.label} style={{ ...cardStyle, padding: '17px 17px 15px' }}>
            <div style={eyebrowStyle}>{k.label}</div>
            <div
              style={{
                fontFamily: FONT,
                fontWeight: 300,
                fontSize: 31,
                lineHeight: 1,
                color: '#1B2430',
                fontVariantNumeric: 'tabular-nums',
                margin: '13px 0 8px',
              }}
            >
              {k.value}
            </div>
            <div style={{ fontSize: 12, color: k.color, lineHeight: 1.4 }}>{k.note}</div>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: 34 }}>
        <div style={{ ...eyebrowStyle, marginBottom: 14 }}>Conference-wide position</div>
        <div className="cc-grid-2" style={{ gap: 14, alignItems: 'stretch', marginBottom: 14 }}>
          <div style={{ ...cardStyle, padding: 22 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'baseline', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 13.5, color: '#1B2430', fontWeight: 500 }}>{conference.name}</div>
                <div style={{ fontSize: 12, color: '#757C86', marginTop: 4 }}>Tithe received to {conference.as_of}</div>
              </div>
              <div style={{ fontFamily: FONT, fontWeight: 300, fontSize: 28, color: '#1B2430', fontVariantNumeric: 'tabular-nums' }}>
                {fmtC(conferenceYtd)}
              </div>
            </div>
            <div style={{ height: 10, borderRadius: 6, background: '#ECEAE4', overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ width: clampPct(conferencePace), height: '100%', background: '#1B2430' }} />
            </div>
            <div style={{ fontSize: 11.5, color: '#9AA0A8' }}>{pct(conferencePace)} of {fmtC(conference.year_target)} annual conference target</div>
          </div>

          <div style={{ ...cardStyle, padding: 22 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 16 }}>Monthly email trigger</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#3E7A55', flex: 'none' }} />
              <div>
                <div style={{ fontSize: 13.5, color: '#1B2430', fontWeight: 500 }}>{data.email_automation.mode === 'live' ? 'Auto-send live' : 'Auto-send dry run'}</div>
                <div style={{ fontSize: 12, color: '#757C86', marginTop: 3 }}>{data.email_automation.trigger}</div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div style={{ borderTop: '1px solid #EFEDE7', paddingTop: 12 }}>
                <div style={eyebrowStyle}>Audience</div>
                <div style={{ fontSize: 20, color: '#1B2430', fontWeight: 300, marginTop: 7 }}>{conference.churches_total}</div>
                <div style={{ fontSize: 11.5, color: '#757C86' }}>church one-pagers</div>
              </div>
              <div style={{ borderTop: '1px solid #EFEDE7', paddingTop: 12 }}>
                <div style={eyebrowStyle}>Data status</div>
                <div style={{ fontSize: 20, color: '#1B2430', fontWeight: 300, marginTop: 7 }}>{conference.churches_reporting}/{conference.churches_total}</div>
                <div style={{ fontSize: 11.5, color: '#757C86' }}>reporting this month</div>
              </div>
            </div>
          </div>
        </div>

          <div style={{ ...cardStyle, padding: 22 }}>
            <div style={{ ...eyebrowStyle, marginBottom: 16 }}>One-page email contents</div>
            {emailContents.map(([title, body], i) => (
              <div key={title} style={{ padding: i === 0 ? '0 0 13px' : '13px 0', borderTop: i === 0 ? 'none' : '1px solid #EFEDE7' }}>
                <div style={{ fontSize: 13, color: '#1B2430', fontWeight: 500, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#757C86' }}>{body}</div>
              </div>
            ))}
          </div>
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', marginBottom: 14 }}>
          <div style={eyebrowStyle}>Church contribution comparison</div>
          <div style={{ fontSize: 11.5, color: '#757C86' }}>
            Showing {firstTableRow}-{lastTableRow} of {churchRows.length}
          </div>
        </div>
        <div className="cc-scroll-x">
          <div style={{ ...cardStyle, padding: '18px 22px', minWidth: 640 }}>
            <div style={{ display: 'flex', gap: 18, paddingBottom: 10, borderBottom: '1px solid #E7E5DF' }}>
              <span style={{ ...eyebrowStyle, flex: 1 }}>Church</span>
              <span style={{ ...eyebrowStyle, width: 138, textAlign: 'right' }}>{copy.tableHeader}</span>
              <span style={{ ...eyebrowStyle, width: 96, textAlign: 'right' }}>YoY</span>
              <span style={{ ...eyebrowStyle, width: 96, textAlign: 'right' }}>Share</span>
            </div>
            {paginatedChurchRows.map((row) => (
              <div key={row.name} style={{ display: 'flex', alignItems: 'baseline', gap: 18, padding: '12px 0', borderBottom: '1px solid #F3F1EC' }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 12.5, color: '#1B2430', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{row.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: '#9AA0A8', marginTop: 2 }}>{row.district}</span>
                </span>
                <span style={{ width: 138, textAlign: 'right', fontSize: 12, color: '#39424F', fontVariantNumeric: 'tabular-nums' }}>{fmtF(row.ytd)}</span>
                <span style={{ width: 96, textAlign: 'right', fontSize: 12, color: row.movement >= 0 ? '#3E7A55' : '#A8443B', fontVariantNumeric: 'tabular-nums' }}>{pct(row.movement)}</span>
                <span style={{ width: 96, textAlign: 'right', fontSize: 12, color: '#8A6A2A', fontVariantNumeric: 'tabular-nums' }}>{pct(row.share)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 14, paddingTop: 16 }}>
              <button
                type="button"
                onClick={() => setTablePage((page) => Math.max(0, page - 1))}
                disabled={currentTablePage === 0}
                style={{
                  border: '1px solid #E7E5DF',
                  background: '#FFFFFF',
                  color: currentTablePage === 0 ? '#B5B0A6' : '#1B2430',
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: currentTablePage === 0 ? 'default' : 'pointer',
                  fontFamily: FONT,
                  fontSize: 12,
                }}
              >
                Previous
              </button>
              <div style={{ fontSize: 12, color: '#757C86', fontVariantNumeric: 'tabular-nums' }}>
                Page {currentTablePage + 1} of {pageCount}
              </div>
              <button
                type="button"
                onClick={() => setTablePage((page) => Math.min(pageCount - 1, page + 1))}
                disabled={currentTablePage >= pageCount - 1}
                style={{
                  border: '1px solid #E7E5DF',
                  background: '#FFFFFF',
                  color: currentTablePage >= pageCount - 1 ? '#B5B0A6' : '#1B2430',
                  borderRadius: 8,
                  padding: '8px 12px',
                  cursor: currentTablePage >= pageCount - 1 ? 'default' : 'pointer',
                  fontFamily: FONT,
                  fontSize: 12,
                }}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

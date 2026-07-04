// Design source-of-truth data, ported VERBATIM from the design's app-script.js.
// This is the single fallback dataset every view renders when the backend API
// is unreachable. Do not "improve" the figures — they must match the design.

import { fmtC, fmtF } from './format';

// ---------------------------------------------------------------------------
// Views / navigation
// ---------------------------------------------------------------------------

export type ViewKey =
  | 'overview'
  | 'operating'
  | 'tithe'
  | 'departments'
  | 'decisions'
  | 'staffing'
  | 'field'
  | 'entities'
  | 'cash'
  | 'sources'
  | 'admin';

export interface NavGroupDef {
  label: string;
  items: Array<[ViewKey, string]>;
}

export const navGroupDefs: NavGroupDef[] = [
  { label: 'Overview', items: [['overview', 'Command centre']] },
  {
    label: 'Budget & spend',
    items: [
      ['operating', 'Operating position'],
      ['tithe', 'Tithe faithfulness'],
      ['departments', 'Department budgets'],
      ['decisions', 'Decision copilot'],
    ],
  },
  {
    label: 'People',
    items: [
      ['staffing', 'Staffing scenario'],
      ['field', 'Field & pastoral'],
    ],
  },
  { label: 'Entities', items: [['entities', 'Entity statements']] },
  {
    label: 'Treasury & data',
    items: [
      ['cash', 'Cash position'],
      ['sources', 'Data sources'],
    ],
  },
];

export const viewKeys: ViewKey[] = [
  'overview',
  'operating',
  'tithe',
  'departments',
  'decisions',
  'staffing',
  'field',
  'entities',
  'cash',
  'sources',
  'admin',
];

export function isViewKey(value: string): value is ViewKey {
  return (viewKeys as string[]).includes(value);
}

export const viewMetaMap: Record<ViewKey, { eyebrow: string; title: string }> = {
  overview: { eyebrow: 'Overview', title: 'Command centre' },
  operating: { eyebrow: 'Budget & spend', title: 'Operating position' },
  tithe: { eyebrow: 'Stewardship', title: 'Tithe faithfulness' },
  departments: { eyebrow: 'Budget & spend', title: 'Department budgets' },
  decisions: { eyebrow: 'Budget & spend', title: 'Decision copilot' },
  staffing: { eyebrow: 'People', title: 'Staffing scenario' },
  field: { eyebrow: 'People', title: 'Field & pastoral' },
  entities: { eyebrow: 'Entities', title: 'Entity statements' },
  cash: { eyebrow: 'Treasury', title: 'Cash position' },
  sources: { eyebrow: 'Data', title: 'Data sources' },
  admin: { eyebrow: 'Administration', title: 'User management' },
};

// ---------------------------------------------------------------------------
// Functions / departments / lanes / entities (raw figures)
// ---------------------------------------------------------------------------

export interface FunctionRaw {
  name: string;
  budget: number;
  /** Percent of budget consumed (elapsed-year pace illustration). */
  used: number;
}

export const functionsRaw: FunctionRaw[] = [
  { name: 'Field', budget: 3177120, used: 42 },
  { name: 'Adventist Alpine Village', budget: 2258427, used: 46 },
  { name: 'Administration', budget: 1549196, used: 44 },
  { name: 'Youth Ministry', budget: 274288, used: 58 },
  { name: 'Big Camp', budget: 193620, used: 88 },
  { name: 'Ministerial', budget: 128586, used: 39 },
  { name: 'Communications', budget: 99200, used: 51 },
  { name: 'Faith FM', budget: 82557, used: 47 },
  { name: 'Evangelism', budget: 62000, used: 71 },
  { name: 'Personal Ministries', budget: 52750, used: 33 },
  { name: 'Properties', budget: 11300, used: 106 },
  { name: 'Other Operations', budget: 7500, used: 20 },
];

export interface DeptRaw {
  name: string;
  budget: number;
  used: number;
  /** [line label, line budget] pairs. */
  lines: Array<[string, number]>;
}

export const deptRaw: DeptRaw[] = [
  {
    name: 'Field',
    budget: 3177120,
    used: 42,
    lines: [
      ['Wages Taxable', 1064871],
      ['Fringe Benefits', 816423],
      ['Travel & Motor Vehicle', 481083],
      ['Superannuation — ACAST', 255104],
      ['Tithe Expense', 234400],
      ['Removal', 70000],
      ['Book & Equipment Subsidy', 56104],
      ['Long Service Leave', 48567],
      ['Professional Development', 45000],
      ['Workers Compensation', 35521],
    ],
  },
  { name: 'Adventist Alpine Village', budget: 2258427, used: 46, lines: [['AAV Expenditure', 2258427]] },
  {
    name: 'Administration',
    budget: 1549196,
    used: 44,
    lines: [
      ['Fixed Expenses', 996396],
      ['Accounting / Overseas Services', 146500],
      ['Technology & Software', 142000],
      ['Travel Expense', 26600],
      ['President Discretionary', 20000],
      ['Property Usage', 20000],
      ['Depreciation', 15000],
      ['General Expense', 14200],
      ['Legal Expenses', 12000],
      ['Auditing Expense', 10748],
    ],
  },
  { name: 'Youth Ministry', budget: 274288, used: 58, lines: [['Youth & Family Life (APS 10)', 274288]] },
  { name: 'Big Camp', budget: 193620, used: 88, lines: [['Annual Convention Expense', 193620]] },
  { name: 'Ministerial', budget: 128586, used: 39, lines: [['Ministerial Department (APS 7)', 128586]] },
  { name: 'Communications', budget: 99200, used: 51, lines: [['Communications (APS 3)', 99200]] },
  {
    name: 'Faith FM',
    budget: 82557,
    used: 47,
    lines: [
      ['Faith FM fixed costs', 72557],
      ['Faith FM variable costs', 10000],
    ],
  },
  { name: 'Evangelism', budget: 62000, used: 71, lines: [['Pastoral & Lay Outreach', 62000]] },
  { name: 'Personal Ministries', budget: 52750, used: 33, lines: [['Department Liaisons (APS 1)', 52750]] },
  { name: 'Properties', budget: 11300, used: 106, lines: [['Conference House Expenses', 11300]] },
  { name: 'Other Operations', budget: 7500, used: 20, lines: [['Miscellaneous Activities', 7500]] },
];

export interface LaneRaw {
  id: string;
  title: string;
  hint: string;
  budget: number;
  spent: number;
  /** Default request amount pre-loaded on the slider. */
  request: number;
}

export const lanesRaw: LaneRaw[] = [
  {
    id: 'evangelism',
    title: 'An evangelism budget request came in — can we afford it?',
    hint: 'Evangelism / outreach lane',
    budget: 62000,
    spent: 44020,
    request: 5000,
  },
  {
    id: 'faith_fm',
    title: 'Faith FM needs new studio microphones — can we afford it?',
    hint: 'Faith FM / radio ministry lane',
    budget: 82557,
    spent: 38802,
    request: 2500,
  },
  {
    id: 'president',
    title: 'The President was invited to the USA — can we cover it?',
    hint: 'President / administration discretionary',
    budget: 20000,
    spent: 8600,
    request: 3500,
  },
  {
    id: 'youth',
    title: 'Can Youth Ministry absorb another request this year?',
    hint: 'Youth ministry lane',
    budget: 274288,
    spent: 159087,
    request: 3000,
  },
];

export interface EntDef {
  name: string;
  scope: string;
  income: number;
  expense: number;
}

export const entDefs: EntDef[] = [
  { name: 'SDA Church (SNSW) Ltd', scope: 'Conference operations', income: 5036632, expense: 5638117 },
  { name: 'Adventist Alpine Village', scope: 'Commercial · hospitality', income: 2996300, expense: 2258427 },
];

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface OverviewKpi {
  eyebrow: string;
  value: string;
  note: string;
  noteColor: string;
}

export const overviewKpis: OverviewKpi[] = [
  { eyebrow: 'Operating net · YTD', value: fmtC(-139000), note: 'Full-year target +$136K', noteColor: '#A8443B' },
  { eyebrow: 'Approved surplus · FY26', value: fmtC(136388), note: '$8.03M in · $7.90M out', noteColor: '#757C86' },
  { eyebrow: 'Functions over budget', value: '1', note: 'Properties', noteColor: '#8A6A2A' },
  { eyebrow: 'Data health', value: 'Watch', note: '2 sources pending refresh', noteColor: '#8A6A2A' },
];

export type DashTone = 'good' | 'warn' | 'bad' | 'neutral';

export interface DashDef {
  id: ViewKey;
  title: string;
  desc: string;
  status: string;
  tone: DashTone;
}

export const dashDefs: DashDef[] = [
  { id: 'operating', title: 'Operating position', desc: 'Income, spend and net against the approved FY2026 budget.', status: 'Watch', tone: 'warn' },
  { id: 'tithe', title: 'Tithe faithfulness', desc: 'Monthly church giving, year-over-year tracking and conference contribution share.', status: 'Monthly', tone: 'good' },
  { id: 'departments', title: 'Department budgets', desc: 'Budget authority, spend and remaining for every ministry function.', status: '1 over', tone: 'bad' },
  { id: 'decisions', title: 'Decision copilot', desc: 'Ask any budget question in plain language and get a grounded answer.', status: 'AI', tone: 'good' },
  { id: 'staffing', title: 'Staffing scenario', desc: '2027 FTE affordability against a tithe-only ceiling.', status: 'Scenario', tone: 'neutral' },
  { id: 'field', title: 'Field & pastoral', desc: 'Church coverage, pastoral load and vacant districts.', status: '6 vacant', tone: 'warn' },
  { id: 'entities', title: 'Entity statements', desc: 'Conference and Adventist Alpine Village income and expense.', status: '2 entities', tone: 'neutral' },
  { id: 'cash', title: 'Cash position', desc: 'Source-backed cash discipline across Westpac and CMF.', status: 'Pending', tone: 'warn' },
  { id: 'sources', title: 'Data sources', desc: 'MYOB cache health, evidence registry and source freshness.', status: 'Mixed', tone: 'neutral' },
];

export interface AlertDef {
  title: string;
  body: string;
  color: string;
}

export const alerts: AlertDef[] = [
  { title: 'Properties over budget', body: 'Full-year allocation exceeded by ~6% at May.', color: '#A8443B' },
  { title: 'Big Camp 88% committed', body: 'Annual Convention spend is front-loaded; little headroom left.', color: '#8A6A2A' },
  { title: 'MYOB cash not refreshed', body: 'No live cash-on-hand until the endpoints are re-probed.', color: '#8A6A2A' },
];

export interface FreshnessDef {
  name: string;
  status: string;
  color: string;
}

export const freshness: FreshnessDef[] = [
  { name: 'Final budget 2026.pdf', status: 'Current', color: '#3E7A55' },
  { name: 'Velixo report · May', status: 'Stale', color: '#8A6A2A' },
  { name: 'MYOB cash endpoints', status: 'Pending', color: '#A8443B' },
  { name: 'Operating summary · May', status: 'Current', color: '#3E7A55' },
];

// ---------------------------------------------------------------------------
// Operating
// ---------------------------------------------------------------------------

export const opKpis: OverviewKpi[] = [
  { eyebrow: 'Operating income · YTD', value: fmtC(3284000), note: '41% of $8.03M approved', noteColor: '#757C86' },
  { eyebrow: 'Operating spend · YTD', value: fmtC(3423000), note: '43% of $7.90M approved', noteColor: '#757C86' },
  { eyebrow: 'Operating net · YTD', value: fmtC(-139000), note: 'Full-year target +$136K', noteColor: '#A8443B' },
  { eyebrow: 'Functions on watch', value: '2', note: 'Big Camp · Properties', noteColor: '#8A6A2A' },
];

export interface CompositionDef {
  label: string;
  approved: number;
  spent: number;
  color: string;
}

export const compositionDefs: CompositionDef[] = [
  { label: 'Income', approved: 8032932, spent: 3284000, color: '#3E7A55' },
  { label: 'Expense', approved: 7896544, spent: 3423000, color: '#1B2430' },
];

export const obsSentence =
  'Properties has already overrun its full-year allocation, and Big Camp is 88% committed by May. Every other function still sits at or under elapsed-year pace.';

/** Donut composition items for the operating charts: [name, amount]. */
export const donutItems: Array<[string, number]> = [
  ['Field', 3177120],
  ['Adventist Alpine Village', 2258427],
  ['Administration', 1549196],
  ['Youth Ministry', 274288],
  ['Big Camp', 193620],
  ['Other functions', 443893],
];

// ---------------------------------------------------------------------------
// Staffing baseline
// ---------------------------------------------------------------------------

export interface StaffingBaseline {
  baseField: number;
  baseOffice: number;
  vacantPosts: number;
  defaults: { tithe: number; ratio: number; package: number };
}

export const staffingBaseline: StaffingBaseline = {
  baseField: 18,
  baseOffice: 11,
  vacantPosts: 6,
  defaults: { tithe: 5200000, ratio: 0.75, package: 150000 },
};

// ---------------------------------------------------------------------------
// Field & pastoral
// ---------------------------------------------------------------------------

export interface FieldStat {
  label: string;
  value: string;
}

export const fieldStats: FieldStat[] = [
  { label: 'Churches & companies', value: '78' },
  { label: 'Emerging groups', value: '14' },
  { label: 'Field pastors', value: '34' },
  { label: 'Vacant / TBD', value: '6' },
  { label: 'Attendance', value: '6.9K' },
];

export interface LoadBucket {
  label: string;
  count: string;
  pct: string;
  color: string;
}

export const loadBuckets: LoadBucket[] = [
  { label: '3+ churches / companies', count: '8 pastors', pct: '53%', color: '#A8443B' },
  { label: '2 churches / companies', count: '11 pastors', pct: '73%', color: '#8A6A2A' },
  { label: '1 church / company', count: '15 pastors', pct: '100%', color: '#3E7A55' },
  { label: 'Vacant / awaiting appointment', count: '6 districts', pct: '40%', color: '#B7BAC0' },
];

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export interface EvidenceDef {
  label: string;
  value: string;
  basis: string;
  conf: 'High' | 'Medium';
  confColor: string;
}

export const evidence: EvidenceDef[] = [
  { label: 'MYOB accounts cached', value: '433', basis: 'Read-only MYOB Account endpoint', conf: 'High', confColor: '#3E7A55' },
  { label: 'Journal transaction sample', value: '750', basis: 'JournalTransaction endpoint sample', conf: 'Medium', confColor: '#8A6A2A' },
  { label: 'Account 312510 balance', value: fmtF(-35572), basis: 'Benefits tracker summary', conf: 'High', confColor: '#3E7A55' },
  { label: 'Evangelism account 703430', value: '$0', basis: 'Account-specific drilldown, current sample', conf: 'Medium', confColor: '#8A6A2A' },
];

export interface FreshnessFullDef {
  name: string;
  status: string;
  color: string;
  note: string;
}

export const freshnessFull: FreshnessFullDef[] = [
  { name: 'Final budget 2026.pdf', status: 'Current', color: '#3E7A55', note: 'Board-approved 15 Feb 2026' },
  { name: 'Velixo operating report', status: 'Stale', color: '#8A6A2A', note: 'May 2026 — refresh before June decisions' },
  { name: 'MYOB cash endpoints', status: 'Pending', color: '#A8443B', note: 'Not yet probed for balances' },
  { name: 'CMF cash extractor', status: 'Pending', color: '#A8443B', note: 'Awaiting reconciliation match' },
  { name: 'Operating summary', status: 'Current', color: '#3E7A55', note: 'May 2026 whole-of-entity totals' },
];

// ---------------------------------------------------------------------------
// Decision copilot
// ---------------------------------------------------------------------------

export const thinkSteps: string[] = [
  'Reading the approved FY2026 budget…',
  'Checking function spend and elapsed-year pace…',
  'Assessing lane capacity and remaining headroom…',
  'Composing the answer…',
];

export const chipDefs: string[] = [
  'Can we afford a $5,000 evangelism request?',
  'Faith FM needs $2,500 for new microphones — can we cover it?',
  'The President was invited to the USA (~$3,500). Affordable?',
  'Which functions are most at risk of overspending?',
];

// ---------------------------------------------------------------------------
// Tithe faithfulness
// ---------------------------------------------------------------------------

export interface TitheMonth {
  month: string;
  current: number;
  prior: number;
  conference: number;
}

export interface TitheChurch {
  name: string;
  district: string;
  pastor: string;
  members: number;
  monthly: TitheMonth[];
}

export const titheConference = {
  name: 'South NSW Conference',
  asOf: 'June 2026',
  monthlyEmail: 'Scheduled for the 5th business day',
  churchesReporting: 72,
  churchesTotal: 78,
  yearTarget: 5600000,
  priorYearTotal: 5260000,
};

export const titheChurches: TitheChurch[] = [
  {
    name: 'Wagga Wagga Church',
    district: 'Riverina',
    pastor: 'District Pastor',
    members: 186,
    monthly: [
      { month: 'Jan', current: 42100, prior: 38900, conference: 421000 },
      { month: 'Feb', current: 39850, prior: 40200, conference: 407800 },
      { month: 'Mar', current: 44880, prior: 42150, conference: 438200 },
      { month: 'Apr', current: 46240, prior: 43210, conference: 449600 },
      { month: 'May', current: 43820, prior: 41740, conference: 432900 },
      { month: 'Jun', current: 47190, prior: 44980, conference: 461700 },
      { month: 'Jul', current: 0, prior: 43120, conference: 0 },
      { month: 'Aug', current: 0, prior: 45560, conference: 0 },
      { month: 'Sep', current: 0, prior: 43940, conference: 0 },
      { month: 'Oct', current: 0, prior: 46870, conference: 0 },
      { month: 'Nov', current: 0, prior: 47240, conference: 0 },
      { month: 'Dec', current: 0, prior: 49820, conference: 0 },
    ],
  },
  {
    name: 'Canberra National Church',
    district: 'ACT',
    pastor: 'District Pastor',
    members: 312,
    monthly: [
      { month: 'Jan', current: 73900, prior: 71200, conference: 421000 },
      { month: 'Feb', current: 70450, prior: 68900, conference: 407800 },
      { month: 'Mar', current: 76820, prior: 74100, conference: 438200 },
      { month: 'Apr', current: 78340, prior: 75600, conference: 449600 },
      { month: 'May', current: 75110, prior: 73950, conference: 432900 },
      { month: 'Jun', current: 80680, prior: 77900, conference: 461700 },
      { month: 'Jul', current: 0, prior: 76100, conference: 0 },
      { month: 'Aug', current: 0, prior: 79300, conference: 0 },
      { month: 'Sep', current: 0, prior: 78200, conference: 0 },
      { month: 'Oct', current: 0, prior: 80100, conference: 0 },
      { month: 'Nov', current: 0, prior: 81400, conference: 0 },
      { month: 'Dec', current: 0, prior: 84500, conference: 0 },
    ],
  },
];

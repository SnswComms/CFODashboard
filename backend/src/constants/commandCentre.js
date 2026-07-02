// CFO Command Centre design constants, ported verbatim from the design source
// (scratchpad/extracted/app-script.js) per CONTRACT.md v1.0. These are
// design/synthetic figures — meta.dataSource is always "synthetic".
// Frontend mirror: frontend/src/lib/designData.ts (same numbers).

const GENERATED_AT = "2026-05-31T10:00:00";

// Board-approved FY2026 totals (Final budget 2026.pdf, 15 Feb 2026).
const APPROVED_TOTALS = { income: 8032932, expense: 7896544, net: 136388 };

// { name, budget, used } — used is the illustrative elapsed-year used %.
const FUNCTIONS_RAW = [
  { name: "Field", budget: 3177120, used: 42 },
  { name: "Adventist Alpine Village", budget: 2258427, used: 46 },
  { name: "Administration", budget: 1549196, used: 44 },
  { name: "Youth Ministry", budget: 274288, used: 58 },
  { name: "Big Camp", budget: 193620, used: 88 },
  { name: "Ministerial", budget: 128586, used: 39 },
  { name: "Communications", budget: 99200, used: 51 },
  { name: "Faith FM", budget: 82557, used: 47 },
  { name: "Evangelism", budget: 62000, used: 71 },
  { name: "Personal Ministries", budget: 52750, used: 33 },
  { name: "Properties", budget: 11300, used: 106 },
  { name: "Other Operations", budget: 7500, used: 20 },
];

// { name, budget, used, lines: [line, budget][] } — [name, amount] pairs kept as
// 2-element arrays deliberately (design source shape).
const DEPT_RAW = [
  {
    name: "Field",
    budget: 3177120,
    used: 42,
    lines: [
      ["Wages Taxable", 1064871],
      ["Fringe Benefits", 816423],
      ["Travel & Motor Vehicle", 481083],
      ["Superannuation — ACAST", 255104],
      ["Tithe Expense", 234400],
      ["Removal", 70000],
      ["Book & Equipment Subsidy", 56104],
      ["Long Service Leave", 48567],
      ["Professional Development", 45000],
      ["Workers Compensation", 35521],
    ],
  },
  { name: "Adventist Alpine Village", budget: 2258427, used: 46, lines: [["AAV Expenditure", 2258427]] },
  {
    name: "Administration",
    budget: 1549196,
    used: 44,
    lines: [
      ["Fixed Expenses", 996396],
      ["Accounting / Overseas Services", 146500],
      ["Technology & Software", 142000],
      ["Travel Expense", 26600],
      ["President Discretionary", 20000],
      ["Property Usage", 20000],
      ["Depreciation", 15000],
      ["General Expense", 14200],
      ["Legal Expenses", 12000],
      ["Auditing Expense", 10748],
    ],
  },
  { name: "Youth Ministry", budget: 274288, used: 58, lines: [["Youth & Family Life (APS 10)", 274288]] },
  { name: "Big Camp", budget: 193620, used: 88, lines: [["Annual Convention Expense", 193620]] },
  { name: "Ministerial", budget: 128586, used: 39, lines: [["Ministerial Department (APS 7)", 128586]] },
  { name: "Communications", budget: 99200, used: 51, lines: [["Communications (APS 3)", 99200]] },
  { name: "Faith FM", budget: 82557, used: 47, lines: [["Faith FM fixed costs", 72557], ["Faith FM variable costs", 10000]] },
  { name: "Evangelism", budget: 62000, used: 71, lines: [["Pastoral & Lay Outreach", 62000]] },
  { name: "Personal Ministries", budget: 52750, used: 33, lines: [["Department Liaisons (APS 1)", 52750]] },
  { name: "Properties", budget: 11300, used: 106, lines: [["Conference House Expenses", 11300]] },
  { name: "Other Operations", budget: 7500, used: 20, lines: [["Miscellaneous Activities", 7500]] },
];

const LANES_RAW = [
  {
    id: "evangelism",
    title: "An evangelism budget request came in — can we afford it?",
    hint: "Evangelism / outreach lane",
    budget: 62000,
    spent: 44020,
    default_request: 5000,
  },
  {
    id: "faith_fm",
    title: "Faith FM needs new studio microphones — can we afford it?",
    hint: "Faith FM / radio ministry lane",
    budget: 82557,
    spent: 38802,
    default_request: 2500,
  },
  {
    id: "president",
    title: "The President was invited to the USA — can we cover it?",
    hint: "President / administration discretionary",
    budget: 20000,
    spent: 8600,
    default_request: 3500,
  },
  {
    id: "youth",
    title: "Can Youth Ministry absorb another request this year?",
    hint: "Youth ministry lane",
    budget: 274288,
    spent: 159087,
    default_request: 3000,
  },
];

const ENT_DEFS = [
  { name: "SDA Church (SNSW) Ltd", scope: "Conference operations", income: 5036632, expense: 5638117 },
  { name: "Adventist Alpine Village", scope: "Commercial · hospitality", income: 2996300, expense: 2258427 },
];

// Display name -> approved-budget department key (constants/approvedBudget.js).
// Joins live MYOB actuals (grouped via PREFIX_TO_DEPT) onto the design lists
// above; the synthetic figures never touch this map.
const FUNCTION_DEPT_KEYS = {
  "Field": "FIELD",
  "Adventist Alpine Village": "ADVENTIST ALPINE VILLAGE",
  "Administration": "ADMINISTRATION",
  "Youth Ministry": "YOUTH MINISTRY",
  "Big Camp": "BIG CAMP",
  "Ministerial": "MINISTERIAL",
  "Communications": "COMMUNICATIONS",
  "Faith FM": "FAITH FM ADMINISTRATION",
  "Evangelism": "EVANGELISM",
  "Personal Ministries": "PERSONAL MINISTRIES / DEPARTMENT LIAISONS",
  "Properties": "PROPERTIES",
  "Other Operations": "OTHER OPERATIONS",
};

// Entity attribution for live GL lines. AAV is not a branch on this tenant —
// its activity is carved out by subaccount prefix (its PREFIX_TO_DEPT
// department), so the dept map wins; branches map next, and lines on unmapped
// branches roll into the conference entity, whose scope is the whole
// conference book.
const DEPT_ENTITY_MAP = {
  "ADVENTIST ALPINE VILLAGE": "Adventist Alpine Village",
};
const BRANCH_ENTITY_MAP = {
  SNC: "SDA Church (SNSW) Ltd",
  SNU: "SDA Church (SNSW) Ltd",
};

// ---- Overview ----
const OVERVIEW_KPIS = [
  { eyebrow: "Operating net · YTD", value: "($139K)", note: "Full-year target +$136K", tone: "bad" },
  { eyebrow: "Approved surplus · FY26", value: "$136K", note: "$8.03M in · $7.90M out", tone: "neutral" },
  { eyebrow: "Functions over budget", value: "1", note: "Properties", tone: "warn" },
  { eyebrow: "Data health", value: "Watch", note: "2 sources pending refresh", tone: "warn" },
];

const DASH_CARDS = [
  { id: "operating", title: "Operating position", desc: "Income, spend and net against the approved FY2026 budget.", status: "Watch", tone: "warn" },
  { id: "departments", title: "Department budgets", desc: "Budget authority, spend and remaining for every ministry function.", status: "1 over", tone: "bad" },
  { id: "decisions", title: "Decision copilot", desc: "Ask any budget question in plain language and get a grounded answer.", status: "AI", tone: "good" },
  { id: "staffing", title: "Staffing scenario", desc: "2027 FTE affordability against a tithe-only ceiling.", status: "Scenario", tone: "neutral" },
  { id: "field", title: "Field & pastoral", desc: "Church coverage, pastoral load and vacant districts.", status: "6 vacant", tone: "warn" },
  { id: "entities", title: "Entity statements", desc: "Conference and Adventist Alpine Village income and expense.", status: "2 entities", tone: "neutral" },
  { id: "cash", title: "Cash position", desc: "Source-backed cash discipline across Westpac and CMF.", status: "Pending", tone: "warn" },
  { id: "sources", title: "Data sources", desc: "MYOB cache health, evidence registry and source freshness.", status: "Mixed", tone: "neutral" },
];

const ALERTS = [
  { title: "Properties over budget", body: "Full-year allocation exceeded by ~6% at May.", tone: "bad" },
  { title: "Big Camp 88% committed", body: "Annual Convention spend is front-loaded; little headroom left.", tone: "warn" },
  { title: "MYOB cash not refreshed", body: "No live cash-on-hand until the endpoints are re-probed.", tone: "warn" },
];

const FRESHNESS = [
  { name: "Final budget 2026.pdf", status: "Current", tone: "good" },
  { name: "Velixo report · May", status: "Stale", tone: "warn" },
  { name: "MYOB cash endpoints", status: "Pending", tone: "bad" },
  { name: "Operating summary · May", status: "Current", tone: "good" },
];

// ---- Operating ----
const PERIOD = { label: "FY2026 to date", elapsed_pct: 42 };

const OP_KPIS = [
  { eyebrow: "Operating income · YTD", value: "$3.28M", note: "41% of $8.03M approved", tone: "neutral" },
  { eyebrow: "Operating spend · YTD", value: "$3.42M", note: "43% of $7.90M approved", tone: "neutral" },
  { eyebrow: "Operating net · YTD", value: "($139K)", note: "Full-year target +$136K", tone: "bad" },
  { eyebrow: "Functions on watch", value: "2", note: "Big Camp · Properties", tone: "warn" },
];

const COMPOSITION = [
  { label: "Income", approved: 8032932, spent: 3284000, tone: "good" },
  { label: "Expense", approved: 7896544, spent: 3423000, tone: "neutral" },
];

const OBSERVATION =
  "Properties has already overrun its full-year allocation, and Big Camp is 88% committed by May. Every other function still sits at or under elapsed-year pace.";

// ---- Staffing ----
const STAFFING_BASELINE = {
  base_field: 18,
  base_office: 11,
  vacant_posts: 6,
  defaults: { tithe: 5200000, ratio: 0.75, package: 150000 },
};

// ---- Field ----
const FIELD_STATS = [
  { label: "Churches & companies", value: "78" },
  { label: "Emerging groups", value: "14" },
  { label: "Field pastors", value: "34" },
  { label: "Vacant / TBD", value: "6" },
  { label: "Attendance", value: "6.9K" },
];

const LOAD_BUCKETS = [
  { label: "3+ churches / companies", count: "8 pastors", pct: 53, tone: "bad" },
  { label: "2 churches / companies", count: "11 pastors", pct: 73, tone: "warn" },
  { label: "1 church / company", count: "15 pastors", pct: 100, tone: "good" },
  { label: "Vacant / awaiting appointment", count: "6 districts", pct: 40, tone: "muted" },
];

// ---- Sources ----
const EVIDENCE = [
  { label: "MYOB accounts cached", value: "433", basis: "Read-only MYOB Account endpoint", confidence: "High" },
  { label: "Journal transaction sample", value: "750", basis: "JournalTransaction endpoint sample", confidence: "Medium" },
  { label: "Account 312510 balance", value: "($35,572)", basis: "Benefits tracker summary", confidence: "High" },
  { label: "Evangelism account 703430", value: "$0", basis: "Account-specific drilldown, current sample", confidence: "Medium" },
];

const FRESHNESS_FULL = [
  { name: "Final budget 2026.pdf", status: "Current", tone: "good", note: "Board-approved 15 Feb 2026" },
  { name: "Velixo operating report", status: "Stale", tone: "warn", note: "May 2026 — refresh before June decisions" },
  { name: "MYOB cash endpoints", status: "Pending", tone: "bad", note: "Not yet probed for balances" },
  { name: "CMF cash extractor", status: "Pending", tone: "bad", note: "Awaiting reconciliation match" },
  { name: "Operating summary", status: "Current", tone: "good", note: "May 2026 whole-of-entity totals" },
];

module.exports = {
  GENERATED_AT,
  APPROVED_TOTALS,
  FUNCTIONS_RAW,
  DEPT_RAW,
  LANES_RAW,
  ENT_DEFS,
  FUNCTION_DEPT_KEYS,
  DEPT_ENTITY_MAP,
  BRANCH_ENTITY_MAP,
  OVERVIEW_KPIS,
  DASH_CARDS,
  ALERTS,
  FRESHNESS,
  PERIOD,
  OP_KPIS,
  COMPOSITION,
  OBSERVATION,
  STAFFING_BASELINE,
  FIELD_STATS,
  LOAD_BUCKETS,
  EVIDENCE,
  FRESHNESS_FULL,
};

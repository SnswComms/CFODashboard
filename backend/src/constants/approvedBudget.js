// Approved FY2026 budget authority, ported verbatim from the Python generators:
// - generate_cfo_budget_dashboard.py (APPROVED_TOTALS, APPROVED_TOP_EXPENSE_BUDGET,
//   APPROVED_TOP_INCOME_BUDGET, APPROVED_FUNCTION_BUDGETS, APPROVED_LANE_BUDGETS, DECISION_LANES)
// - generate_department_budget_dashboard.py (APPROVED_DEPARTMENT_BUDGETS,
//   APPROVED_DEPARTMENT_LINES, APPROVED_BUDGET_BASIS)
// - build_department_budget_myob_report.py (PREFIX_TO_DEPT)
// Source of truth: Final budget 2026.pdf, presented to Board 15 Feb 2026.

const APPROVED_BUDGET_BASIS =
  "FY2026 approved annual budget — Final budget 2026.pdf, presented to Board 15 Feb 2026";

const APPROVED_TOTALS = {
  income: 8032932.0, // 5,036,632 conference income/appropriations + 2,996,300 AAV income
  expense: 7896544.0, // 5,638,117 conference expenditure + 2,258,427 AAV expenditure
  net: 136388.0,
};

// [name, amount] pairs — serialized as 2-element arrays (Python tuples), preserved deliberately.
const APPROVED_TOP_EXPENSE_BUDGET = [
  ["Field Expense", 3177120.0],
  ["Adventist Alpine Village Expenditure", 2258427.0],
  ["Administration & General Expenses", 1549196.0],
  ["Departmental Activities", 554823.0],
  ["Annual Convention Expense", 193620.0],
  ["Faith FM Expenses", 82557.0],
  ["Evangelism / Pastoral & Lay Outreach", 62000.0],
  ["Conference House Expenses", 11300.0],
  ["Miscellaneous Expense", 7500.0],
  ["Appropriations Paid", 3000.0],
];

const APPROVED_TOP_INCOME_BUDGET = [
  ["Tithe available for use", 4086524.0],
  ["Adventist Alpine Village Income", 2996300.0],
  ["Education System Contribution", 511608.0],
  ["Appropriations & Interest", 202800.0],
  ["Annual Convention Income", 87500.0],
  ["Bible Worker Fund", 50000.0],
  ["Sundry Income", 35000.0],
  ["Conference House Rents", 20800.0],
];

const APPROVED_FUNCTION_BUDGETS = {
  "FIELD": 3177120.0,
  "ADVENTIST ALPINE VILLAGE": 2258427.0,
  "ADMINISTRATION": 1549196.0,
  "YOUTH MINISTRY": 274288.0,
  "BIG CAMP": 193620.0,
  "MINISTERIAL": 128586.0,
  "COMMUNICATIONS": 99200.0,
  "FAITH FM ADMINISTRATION": 82557.0,
  "FAITH FM": 82557.0,
  "EVANGELISM": 62000.0,
  "PERSONAL MINISTRIES": 52750.0,
  "PROPERTIES": 11300.0,
  "OTHER OPERATIONS": 7500.0,
};

const APPROVED_LANE_BUDGETS = {
  evangelism: 62000.0,
  faith_fm: 82557.0,
  youth: 274288.0,
  president_discretionary: 20000.0,
};

const DECISION_LANES = [
  {
    id: "evangelism",
    title: "Evangelism request",
    question: "An evangelism budget request came in. Can we afford it?",
    function_terms: ["EVANGELISM"],
    detail_terms: ["evangelism", "bible worker", "outreach", "atsim field evangelism"],
    exclude_terms: ["income"],
    default_request: 5000,
    owner_hint: "Evangelism / outreach lane",
  },
  {
    id: "president_discretionary",
    title: "President discretionary",
    question: "Justin was invited to the USA. Can the President afford it?",
    function_terms: ["ADMINISTRATION"],
    detail_terms: ["president"],
    exclude_terms: ["income"],
    default_request: 3500,
    owner_hint: "President / administration discretionary lane",
  },
  {
    id: "faith_fm",
    title: "Faith FM / studio equipment",
    question: "Faith FM needs microphones. Can we afford it?",
    function_terms: ["FAITH FM", "EVANGELISM"],
    detail_terms: ["faith fm", "radio", "canberra radio station", "media"],
    exclude_terms: ["income", "sale of goods"],
    default_request: 2500,
    owner_hint: "Faith FM / radio ministry lane",
  },
  {
    id: "youth",
    title: "Youth ministry",
    question: "Can Youth absorb this request?",
    function_terms: ["YOUTH"],
    detail_terms: ["youth"],
    exclude_terms: ["income"],
    default_request: 3000,
    owner_hint: "Youth ministry lane",
  },
];

const APPROVED_DEPARTMENT_BUDGETS = {
  "FIELD": 3177120.0,
  "ADVENTIST ALPINE VILLAGE": 2258427.0,
  "ADMINISTRATION": 1549196.0,
  "YOUTH MINISTRY": 274288.0,
  "BIG CAMP": 193620.0,
  "MINISTERIAL": 128586.0,
  "COMMUNICATIONS": 99200.0,
  "FAITH FM ADMINISTRATION": 82557.0,
  "EVANGELISM": 62000.0,
  "PERSONAL MINISTRIES / DEPARTMENT LIAISONS": 52750.0,
  "PROPERTIES": 11300.0,
  "OTHER OPERATIONS": 7500.0,
};

// [line, budget] pairs — Python tuples preserved as 2-element arrays.
const APPROVED_DEPARTMENT_LINES = {
  "FIELD": [
    ["Wages Taxable", 1064871.0],
    ["Fringe Benefits Budget", 816423.0],
    ["Travel & Motor Vehicle", 481083.0],
    ["Superannuation - ACAST", 255104.0],
    ["Tithe Expense", 234400.0],
    ["Removal", 70000.0],
    ["Book & Equipment Subsidy", 56104.0],
    ["LSL", 48567.0],
    ["Professional Development", 45000.0],
    ["ADSAFE Contributions", 38767.0],
    ["Workers Compensation", 35521.0],
    ["Telephone", 22080.0],
    ["Field Exp", 6200.0],
    ["Student Fees Discount", 3000.0],
  ],
  "ADMINISTRATION": [
    ["Fixed Expenses total", 996396.0],
    ["Accounting Fees/Overseas services", 146500.0],
    ["Technology Expense/Software", 142000.0],
    ["Travel Expense", 26600.0],
    ["President Discretionary Expenses", 20000.0],
    ["Property Usage", 20000.0],
    ["Depreciation", 15000.0],
    ["General Expense", 14200.0],
    ["Legal Expenses", 12000.0],
    ["Auditing Expense", 10748.0],
    ["Cleaning & Garden", 9360.0],
    ["Office Building Maintenance", 4000.0],
    ["Equipment R & M", 2500.0],
    ["Professional Development", 2500.0],
    ["Church Supplies", 1500.0],
    ["Stationery", 1500.0],
    ["Telephone", 1500.0],
    ["Postage & Freight", 1000.0],
    ["Student Fees Discount", 550.0],
    ["Trailer Expense", 400.0],
  ],
  "EVANGELISM": [["Pastoral & Lay Outreach", 62000.0]],
  "FAITH FM ADMINISTRATION": [
    ["Faith FM fixed costs", 72557.0],
    ["Faith FM variable costs", 10000.0],
  ],
  "YOUTH MINISTRY": [["APS 10 Youth & Family Life", 274288.0]],
  "MINISTERIAL": [["APS 7 Ministerial Department", 128586.0]],
  "COMMUNICATIONS": [["APS 3 Communications", 99200.0]],
  "PERSONAL MINISTRIES / DEPARTMENT LIAISONS": [["APS 1 Department Liaisons", 52750.0]],
  "BIG CAMP": [["Annual Convention Expense", 193620.0]],
  "ADVENTIST ALPINE VILLAGE": [["Adventist Alpine Village Expenditure", 2258427.0]],
  "PROPERTIES": [["Conference House Expenses", 11300.0]],
  "OTHER OPERATIONS": [["Miscellaneous Activities", 7500.0]],
};

// Department mapping from the first MYOB Subaccount segment/prefix.
const PREFIX_TO_DEPT = {
  ADM: "ADMINISTRATION",
  AAV: "ADVENTIST ALPINE VILLAGE",
  FLD: "FIELD",
  YTH: "YOUTH MINISTRY",
  FFM: "FAITH FM ADMINISTRATION",
  COM: "COMMUNICATIONS",
  MIN: "MINISTERIAL",
  EVA: "EVANGELISM",
  DEP: "PERSONAL MINISTRIES / DEPARTMENT LIAISONS",
  OTH: "OTHER OPERATIONS",
  BIG: "BIG CAMP",
  PRO: "PROPERTIES",
  PER: "PERSONAL MINISTRIES / DEPARTMENT LIAISONS",
  // FAM is not an approved department in the current PDF control list; keep visible.
  FAM: "UNMAPPED / FAMILY MINISTRIES",
};

const MAPPING_NOTES = [
  "Department mapping is from the first MYOB subaccount segment/prefix.",
  "JournalTransaction expense lines are the accounting actual source. AP Bill lines are evidence only unless explicitly enabled elsewhere.",
  "TrialBalance/Subaccount/Budget endpoint rights are still needed for a formal full financial-statement engine.",
];

module.exports = {
  APPROVED_BUDGET_BASIS,
  APPROVED_TOTALS,
  APPROVED_TOP_EXPENSE_BUDGET,
  APPROVED_TOP_INCOME_BUDGET,
  APPROVED_FUNCTION_BUDGETS,
  APPROVED_LANE_BUDGETS,
  DECISION_LANES,
  APPROVED_DEPARTMENT_BUDGETS,
  APPROVED_DEPARTMENT_LINES,
  PREFIX_TO_DEPT,
  MAPPING_NOTES,
};

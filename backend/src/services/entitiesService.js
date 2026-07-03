const { NotFoundError } = require("../lib/errors");
const { formatMoney } = require("../lib/format");
const { enumParam } = require("../lib/validate");
const { parsePagination, paginate } = require("../lib/pagination");
const { resolveData } = require("../repositories/dataSourceResolver");

const SESSION_YEARS = ["2005", "2008", "2011", "2014", "2017", "2021", "2025"];
const ENTITY_IDS = ["overview", "snc", "sne_border", "sne_mawson", "sne_narromine", "aav", "snu"];
const SNC_FUNCTION_NAMES = [
  "FIELD",
  "ADMINISTRATION",
  "OTHER OPERATIONS",
  "YOUTH MINISTRY",
  "MINISTERIAL",
  "EVANGELISM",
  "PROPERTIES",
];
const OFFICE_CATEGORIES = [
  "Admin / Executive",
  "Department director",
  "Finance",
  "Department support",
  "Other conference",
];
const HISTORY_INCLUDES = ["years", "claims", "summary"];
const CLAIM_PRIORITIES = ["high", "medium"];
const REGISTRY_STATUSES = ["source-backed"];
const REGISTRY_CONFIDENCES = ["high", "medium"];
const PASTORAL_MAP_URL = "http://127.0.0.1:8094/";
const PERIOD_BUDGET_ACTUAL = "FY2026 budget; May/YTD 2026 actuals from current operating dashboard extract";
const PERIOD_PAYROLL = "FY2025-26 payroll to current parsed pay-run range";

const SCHOOL_SPECS = {
  sne_border: { title: "SNE Border / BCC", school: "Border Christian College", lane: "Border/BCC" },
  sne_mawson: { title: "SNE Mawson / CCS", school: "Canberra Christian School / Mawson", lane: "Mawson/CCS" },
  sne_narromine: { title: "SNE Narromine / NCS", school: "Narromine Christian School", lane: "Narromine/NCS" },
};

// ---------------------------------------------------------------------------
// Loaders (every read goes through the shared resolver: live -> synthetic).
// ---------------------------------------------------------------------------

function loadConstituencyHistoryDoc() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "constituency-history-data.json" }],
    fixture: "constituency-history.json",
  });
}

function loadFieldPastoralDoc() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "field-pastoral-staffing-dashboard-data.json" }],
    fixture: "field-pastoral.json",
  });
}

function loadHistoryComparisonDoc() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "history-comparison-status-data.json" }],
    fixture: "history-comparison.json",
  });
}

function loadEvidenceRegistryDoc() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "evidence-registry-starter.json" }],
    fixture: "evidence-registry.json",
  });
}

function loadEmailIntelligenceDoc() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "email-intelligence-dashboard-data.json" }],
    fixture: "email-intelligence.json",
  });
}

function loadFinanceSourcesDoc() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "finance-source-status-data.json" }],
    fixture: "finance-sources.json",
  });
}

function loadEntityInputs() {
  // The entity pages have no JSON cache of their own: they are computed from
  // three upstream dashboard caches (mirrors generate_cfo_entity_pages.py).
  const budget = resolveData({
    candidates: [{ dirKey: "dashboards", file: "cfo-budget-decision-dashboard-data.json" }],
    fixture: "entities.json",
    transform: (raw) => raw.cfo_budget_dashboard ?? raw,
  });
  const staffing = resolveData({
    candidates: [{ dirKey: "dashboards", file: "field-pastoral-staffing-dashboard-data.json" }],
    fixture: "field-pastoral.json",
  });
  const staffCost = resolveData({
    candidates: [{ dirKey: "dashboards", file: "staff-cost-dashboard-data.json" }],
    fixture: "entities.json",
    transform: (raw) => raw.staff_cost_dashboard ?? raw,
  });
  return { budget, staffing, staffCost };
}

// ---------------------------------------------------------------------------
// Small helpers.
// ---------------------------------------------------------------------------

function toNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// Display formatting is only used inside EvidenceObject value/note strings to
// keep the legacy drawer contract readable; every structured field stays raw.
function money(value) {
  const numeric = toNumber(value);
  return numeric === null ? "—" : formatMoney(numeric);
}

function pct(value) {
  const numeric = toNumber(value);
  return numeric === null ? "—" : `${numeric.toFixed(1)}%`;
}

function sourceRef(label, locator, detail, kind = "source") {
  return { label, locator: locator || "", detail, kind };
}

// Shared shape for "generator document + one paginated rows array" endpoints:
// header fields from the document are kept alongside total/limit/offset.
function pagedDocList(loadDoc, rowsKey, query, { headerKeys = ["generated_at"], filterRows, maxLimit = 500 } = {}) {
  const pagination = parsePagination(query, { defaultLimit: 100, maxLimit });
  const { data, meta } = loadDoc();
  let rows = data && Array.isArray(data[rowsKey]) ? data[rowsKey] : [];
  if (filterRows) rows = filterRows(rows);
  const page = paginate(rows, pagination);
  const header = {};
  for (const key of headerKeys) header[key] = data ? data[key] ?? null : null;
  return {
    data: { ...header, [rowsKey]: page.rows, total: page.total, limit: page.limit, offset: page.offset },
    meta,
  };
}

// Shared "one row by key or 404" lookup over a document array.
function findInDoc(loadDoc, rowsKey, predicate, notFoundMessage) {
  const { data, meta } = loadDoc();
  const rows = data && Array.isArray(data[rowsKey]) ? data[rowsKey] : [];
  const match = rows.find(predicate);
  if (!match) {
    throw new NotFoundError(notFoundMessage);
  }
  return { data: match, meta };
}

function makeEvidence({
  title,
  value,
  summary,
  period = "Not specified",
  basis = "Source-backed dashboard figure",
  breakdown = [],
  people = [],
  links = [],
  sources = [],
  caveats = [],
}) {
  return { title, value, summary, period, basis, breakdown, people, links, sources, caveats };
}

function laneEvidence(label, locator, detail) {
  return makeEvidence({
    title: label,
    value: "Source lane",
    summary: "The source lane is known; a transaction/person breakdown is not attached yet.",
    period: "See source lane",
    basis: "Source-lane reference",
    sources: [sourceRef(label, locator, detail)],
    caveats: ["Attach detailed rows before treating this as decision-ready."],
  });
}

// ---------------------------------------------------------------------------
// Entity model computation (port of generate_cfo_entity_pages.py build()).
// ---------------------------------------------------------------------------

function computeEntityContext(inputs) {
  const budget = inputs.budget.data || {};
  const staffing = inputs.staffing.data || {};
  const staffCostDoc = inputs.staffCost.data || {};

  const summary = budget.summary || {};
  const actual = summary.actual || {};
  const cashRows = Array.isArray(summary.cash_rows) ? summary.cash_rows : null;
  const detail = budget.detail || {};
  const lines = Array.isArray(detail.lines) ? detail.lines : [];
  const functions = {};
  for (const fn of Array.isArray(detail.functions) ? detail.functions : []) {
    if (fn && fn.name) functions[fn.name] = fn;
  }

  const cashTotal = (predicate) => {
    if (cashRows === null) return null;
    return cashRows.filter(predicate).reduce((sum, row) => sum + (toNumber(row.may) ?? 0), 0);
  };
  const aavCash = cashTotal((row) => String(row.account || "").includes("Alpine"));
  const sncCash = cashTotal(
    (row) => String(row.account || "").includes("SDA Church") || String(row.account || "").includes("Conference")
  );

  const staffBlock = staffing.staff || {};
  const categories = Array.isArray(staffBlock.by_category) ? staffBlock.by_category : [];
  const categoryMap = {};
  for (const category of categories) categoryMap[category.category] = category;
  const fieldStaffCost = toNumber((categoryMap["Field / pastoral"] || {}).cost);
  const officeCost = categories.length
    ? OFFICE_CATEGORIES.reduce((sum, key) => sum + (toNumber((categoryMap[key] || {}).cost) ?? 0), 0)
    : null;
  const aavStaffCost = toNumber((categoryMap["AAV - exclude for now"] || {}).cost);
  const schoolStaffCost = toNumber((categoryMap["School - exclude"] || {}).cost);

  const fyRows = Array.isArray(staffCostDoc.fy) ? staffCostDoc.fy : [];
  const payrollFy = fyRows.length ? fyRows[fyRows.length - 1] : {};

  const summarySrc = summary.source ?? null;
  const detailSrc = detail.source ?? null;
  const staffSrc = Array.isArray(staffing.sources) && staffing.sources.length
    ? staffBlock.source || staffing.sources[0].path || null
    : staffBlock.source ?? null;
  const staffCostSrc = staffCostDoc.source ?? null;

  return {
    payrollSrc: staffSrc || staffCostSrc,
    actual,
    cashRows,
    lines,
    functions,
    aavCash,
    sncCash,
    categories,
    fieldStaffCost,
    officeCost,
    aavStaffCost,
    schoolStaffCost,
    fieldPeople: Array.isArray(staffBlock.field_people) ? staffBlock.field_people : [],
    allPeople: Array.isArray(staffBlock.all_people) ? staffBlock.all_people : [],
    payrollFy,
    summarySrc,
    detailSrc,
    staffSrc,
    staffCostSrc,
    fieldFn: functions.FIELD || {},
    aavFn: functions["ADVENTIST ALPINE VILLAGE"] || {},
    propsFn: functions.PROPERTIES || {},
  };
}

function lineRows(context, functionName, limit = 14) {
  const rows = context.lines
    .filter((row) => row.function === functionName)
    .sort((a, b) => Math.abs(toNumber(b.actual) ?? 0) - Math.abs(toNumber(a.actual) ?? 0))
    .slice(0, limit);
  return rows.map((row) => {
    const budgetValue = toNumber(row.budget);
    const actualValue = toNumber(row.actual);
    const used = budgetValue ? (Math.abs(actualValue ?? 0) / Math.abs(budgetValue)) * 100 : null;
    return {
      label: row.line ?? "",
      budget: budgetValue,
      actual: actualValue,
      variance: toNumber(row.variance),
      used,
    };
  });
}

function peopleRows(rows, limit = 30) {
  return rows
    .slice()
    .sort((a, b) => (toNumber(b.cost_25_26) ?? 0) - (toNumber(a.cost_25_26) ?? 0))
    .slice(0, limit)
    .map((row) => ({
      name: row.name ?? "",
      staff_id: row.staff_id ?? "",
      area: row.job_or_area || row.role || "",
      cost: toNumber(row.cost_25_26),
      match: `${row.match_name || ""} (${row.match_score || "—"})`,
    }));
}

function buildEvidenceKit(context) {
  const commonFinanceLinks = [
    {
      label: "SNC 2026 Budget Spend",
      url: "snc-2026-budget-spend-dashboard.html",
      note: "Budget/spend dashboard this figure came from or reconciles to.",
    },
    {
      label: "CFO Operating Dashboard",
      url: "cfo-budget-decision-dashboard.html",
      note: "Operating statement / function dashboard with wider budget context.",
    },
    {
      label: "MYOB Account Drilldown",
      url: "myob-account-drilldown-dashboard.html",
      note: "Use for MYOB-era account/journal/AP detail when account mapping is known.",
    },
  ];
  const payrollLinks = [
    {
      label: "Field Pastoral Staffing",
      url: "field-pastoral-staffing-dashboard.html",
      note: "Pastoral/field people rows and funding context.",
    },
    {
      label: "Staff Cost Dashboard",
      url: "staff-cost-dashboard.html",
      note: "Full payroll/staff-cost dashboard and category mapping.",
    },
    {
      label: "Office Staff Map",
      url: "office-staff-modelling-map.html",
      note: "Conference staff role/category mapping where relevant.",
    },
  ];

  const schoolPlaceholderDetail =
    "Placeholder. Needs school-location source pack: enrolments, operating result, staffing/FTE, funding, cash/liquidity, and inter-entity charges for Border/BCC, Mawson/CCS, and Narromine/NCS.";
  const snuPlaceholderDetail =
    "Placeholder. Needs property register, rental/property usage charge basis, recovery/payment status, loan register, securities, and inter-entity agreements. Current SNC budget source includes a property usage expense line only; it is not enough for SNU economics.";

  const kit = {};

  kit.schoolPlaceholder = laneEvidence("SNE school financial lane needed", null, schoolPlaceholderDetail);
  kit.snuPlaceholder = laneEvidence("SNU property/loan lane needed", null, snuPlaceholderDetail);
  kit.srcSummary = laneEvidence(
    "Operating statement summary / cash rows",
    context.summarySrc,
    "Extracted from existing derived CFO operating dashboard JSON. Cash is May row where present; basis remains source-labelled, not reinterpreted."
  );
  kit.srcDetail = laneEvidence(
    "Velixo function detail",
    context.detailSrc,
    "Extracted from Rpt B-Functions in selected Velixo workbook via existing CFO dashboard generator."
  );
  kit.srcStaff = laneEvidence(
    "Payroll and staff category mapping",
    context.payrollSrc,
    "Derived from current parsed payroll/staffing dashboards. Category mapping is operational and may need accountant review before board use."
  );
  kit.assumptionsRegister = laneEvidence(
    "Assumptions register",
    null,
    "Do not present missing values as zero. Use the drawer/source-lane pattern until extraction is complete."
  );
  kit.entityHealthEvidence = makeEvidence({
    title: "Entity health",
    value: "Mixed",
    summary: "SNC/AAV have partial operating evidence; SNE/SNU are still source-lane placeholders.",
    period: "See source lanes",
    basis: "Source-lane reference",
    sources: [
      sourceRef(
        "Velixo function detail",
        context.detailSrc,
        "Extracted from Rpt B-Functions in selected Velixo workbook via existing CFO dashboard generator."
      ),
      sourceRef("SNE school financial lane needed", null, schoolPlaceholderDetail),
      sourceRef("SNU property/loan lane needed", null, snuPlaceholderDetail),
    ],
    caveats: ["Attach detailed rows before treating this as decision-ready."],
  });

  kit.functionEvidence = (functionName) => {
    const fn = context.functions[functionName] || {};
    return makeEvidence({
      title: `${functionName.toLowerCase().replace(/\b\w/g, (ch) => ch.toUpperCase())} function spend`,
      value: `${money(fn.actual)} actual / ${money(fn.budget)} budget`,
      summary: `This explains the ${functionName} row by showing the underlying Velixo function lines that roll into the displayed budget, actual and used percentage.`,
      period: PERIOD_BUDGET_ACTUAL,
      basis: "Velixo Rpt B-Functions function-level budget vs actual extract",
      breakdown: lineRows(context, functionName),
      links: commonFinanceLinks,
      sources: [
        sourceRef(
          "Velixo function detail",
          context.detailSrc,
          "Rpt B-Functions lines grouped by function; current dashboard cache generated from the workbook.",
          "excel_workbook"
        ),
      ],
      caveats: [
        "This is a function-level accounting breakdown, not yet a MYOB invoice/AP drilldown unless account mapping has been attached.",
      ],
    });
  };

  kit.fieldSpendEvidence = () => {
    const fn = context.fieldFn;
    return makeEvidence({
      title: "Field budget usage + separate pastoral payroll lane",
      value: `${pct(fn.used_pct)} used — ${money(fn.actual)} actual vs ${money(fn.budget)} budget; separate payroll people-cost lane ${money(context.fieldStaffCost)}`,
      summary:
        "This explains two related but separate figures: the Field function budget/spend signal from Velixo, and the named pastoral people-cost lane from payroll. Use this as a bridge, not as one combined number.",
      period: PERIOD_BUDGET_ACTUAL,
      basis: "Function budget/actual from Velixo plus separate payroll/person cross-reference from staffing dashboard",
      breakdown: lineRows(context, "FIELD"),
      people: peopleRows(context.fieldPeople),
      links: commonFinanceLinks.concat(payrollLinks),
      sources: [
        sourceRef(
          "Velixo function detail",
          context.detailSrc,
          "FIELD function lines: salaries, motor vehicle allowances, telephone allowances and other function-level costs.",
          "excel_workbook"
        ),
        sourceRef(
          "Field/pastoral staffing dashboard cache",
          context.payrollSrc,
          "Mapped Field / pastoral people and FY25-26 payroll cost rows.",
          "payroll_csv"
        ),
      ],
      caveats: [
        "The function actual and the payroll category are related but not identical ledgers; use this as a bridge, not a final audit reconciliation.",
        "MYOB invoice-level drilldown requires account/subaccount mapping for the selected function line.",
      ],
    });
  };

  kit.pastoralPayrollEvidence = () =>
    makeEvidence({
      title: "Pastoral payroll lane",
      value: `${money(context.fieldStaffCost)} across ${context.fieldPeople.length} mapped Field / pastoral people`,
      summary: "Exact people currently mapped into the Field / pastoral payroll category behind the displayed payroll lane.",
      period: PERIOD_PAYROLL,
      basis: "Parsed payroll/staff allocation file with role/category overrides",
      people: peopleRows(context.fieldPeople, 40),
      links: payrollLinks,
      sources: [
        sourceRef(
          "Payroll/staff allocation CSV",
          context.payrollSrc,
          "Current staff allocation file with overrides and field/pastoral category mapping.",
          "payroll_csv"
        ),
      ],
      caveats: ["Category mapping is operational and may need accountant review before board publication."],
    });

  kit.churchMinistryMapEvidence = () =>
    makeEvidence({
      title: "Where to click for pastoral people and costs",
      value: `${context.fieldPeople.length} mapped Field / pastoral people — ${money(context.fieldStaffCost)} FY2025-26 payroll lane`,
      summary:
        "For an executive or Conference President: use the field staffing dashboard for exact names/costs and the local ministers mapping app for pastoral/church assignment context. These are related views, not the same ledger as the approved Field department budget.",
      period: PERIOD_PAYROLL,
      basis: "Payroll/staff allocation extract plus local pastoral/ministers map link",
      people: peopleRows(context.fieldPeople, 40),
      links: [
        {
          label: "Field Pastoral Staffing Dashboard",
          url: "field-pastoral-staffing-dashboard.html",
          note: "Open this first for exact people, FY2025-26 costs, and the difference between budget and named-person payroll.",
        },
        {
          label: "2027 Staffing Scenario App",
          url: "staffing-budget-app.html",
          note: "Scenario modelling linked to pastoral staffing assumptions.",
        },
        {
          label: "Pastoral / Ministers Mapping App",
          url: PASTORAL_MAP_URL,
          note: "Local mapping app on port 8094; if it is not running, start the local app before using this link.",
        },
      ],
      sources: [
        sourceRef(
          "Payroll/staff allocation CSV",
          context.payrollSrc,
          "Current staff allocation file with overrides and Field / pastoral category mapping.",
          "payroll_csv"
        ),
      ],
      caveats: [
        "The map app shows assignment/navigation context; the payroll dashboard is the source for exact cost rows.",
        "Do not combine department spend budget and payroll people cost without reconciling source basis.",
      ],
    });

  kit.conferenceNetEvidence = () =>
    makeEvidence({
      title: "Conference net",
      value: money(context.actual.conference_net),
      summary: "Conference income less expense from the operating statement summary dashboard extract.",
      period: "May 2026 operating statement summary extract",
      basis: "Summary dashboard cells: conference income, conference expense, conference net",
      breakdown: [
        { label: "Conference income", budget: null, actual: toNumber(context.actual.conference_income), variance: null, used: null },
        { label: "Conference expense", budget: null, actual: toNumber(context.actual.conference_expense), variance: null, used: null },
        { label: "Conference net", budget: null, actual: toNumber(context.actual.conference_net), variance: null, used: null },
      ],
      links: commonFinanceLinks,
      sources: [
        sourceRef(
          "Operating statement summary / cash rows",
          context.summarySrc,
          "Conference income, expense and net extracted from existing derived CFO operating dashboard JSON.",
          "excel_workbook"
        ),
      ],
    });

  kit.cashEvidence = (title, total, terms) => {
    const rows = context.cashRows || [];
    const matched = rows.filter((row) =>
      terms.some((term) => String(row.account || "").toLowerCase().includes(term.toLowerCase()))
    );
    return makeEvidence({
      title,
      value: money(total),
      summary: "Cash-on-hand card built from the May operating summary cash rows matched to the named entity/account terms below.",
      period: "May 2026 operating summary cash rows",
      basis: "Operating summary cash table; rows matched by account/entity wording",
      breakdown: matched.map((row) => ({
        label: row.account ?? "",
        budget: null,
        actual: toNumber(row.may),
        variance: null,
        used: row.type ?? "",
      })),
      links: commonFinanceLinks,
      sources: [
        sourceRef(
          "Operating statement summary / cash rows",
          context.summarySrc,
          "Cash balances extracted from the operating summary cash section; not a bank reconciliation or restricted-cash analysis.",
          "excel_workbook"
        ),
      ],
      caveats: [
        "This is a dashboard cash signal, not a final cash-control reconciliation.",
        "Restricted-purpose cash still needs separate policy/source confirmation before decisions.",
      ],
    });
  };

  kit.staffCostPressureEvidence = () =>
    makeEvidence({
      title: "Staff cost pressure",
      value: money(context.payrollFy.total_cost),
      summary: "Whole payroll/staff-cost signal with the largest current category lanes and links to the exact people views.",
      period: PERIOD_PAYROLL,
      basis: "Parsed staff-cost dashboard JSON plus current staff allocation/category mapping",
      breakdown: context.categories.slice(0, 10).map((category) => ({
        label: category.category ?? "",
        budget: null,
        actual: toNumber(category.cost),
        variance: `${category.people ?? "—"} people`,
        used: "payroll lane",
      })),
      people: peopleRows(context.allPeople, 20),
      links: payrollLinks.concat([
        {
          label: "History / prior-year status",
          url: "history-comparison-status.html",
          note: "Shows which staff/office prior-year comparisons are indexed.",
        },
      ]),
      sources: [
        sourceRef(
          "Staff cost dashboard cache",
          context.staffCostSrc,
          "FY payroll totals and unique staff count from generated staff-cost dashboard data.",
          "payroll_csv"
        ),
        sourceRef("Current staff allocation CSV", context.staffSrc, "Current person/category mapping with overrides.", "payroll_csv"),
      ],
      caveats: ["Staff category mapping is operational and may need accountant review before board publication."],
    });

  return kit;
}

function buildEntityList(context) {
  const conferenceNet = toNumber(context.actual.conference_net);
  const aavNet = toNumber(context.actual.aav_net);
  const propsActual = toNumber(context.propsFn.actual);
  const payrollTotal = toNumber(context.payrollFy.total_cost);
  const overviewCash = context.cashRows === null ? null : (context.sncCash ?? 0) + (context.aavCash ?? 0);
  const dataState = (...signals) => (signals.some((signal) => signal !== null) ? "partial" : "placeholder");

  return [
    {
      id: "overview",
      title: "CFO Overview",
      operating_signal: conferenceNet,
      cash_on_hand: overviewCash,
      staff_cost_signal: payrollTotal,
      status: "watch",
      data_state: dataState(conferenceNet, overviewCash, payrollTotal),
    },
    {
      id: "snc",
      title: "SNC Conference & Churches",
      operating_signal: conferenceNet,
      cash_on_hand: context.sncCash,
      staff_cost_signal: context.fieldStaffCost,
      status: "watch",
      data_state: dataState(conferenceNet, context.sncCash, context.fieldStaffCost),
    },
    {
      id: "sne_border",
      title: "SNE Border / BCC",
      operating_signal: null,
      cash_on_hand: null,
      staff_cost_signal: null,
      status: "source lane needed",
      data_state: "placeholder",
    },
    {
      id: "sne_mawson",
      title: "SNE Mawson / CCS",
      operating_signal: null,
      cash_on_hand: null,
      staff_cost_signal: null,
      status: "source lane needed",
      data_state: "placeholder",
    },
    {
      id: "sne_narromine",
      title: "SNE Narromine / NCS",
      operating_signal: null,
      cash_on_hand: null,
      staff_cost_signal: null,
      status: "source lane needed",
      data_state: "placeholder",
    },
    {
      id: "aav",
      title: "AAV Campground",
      operating_signal: aavNet,
      cash_on_hand: context.aavCash,
      staff_cost_signal: context.aavStaffCost,
      status: "partial evidence",
      data_state: dataState(aavNet, context.aavCash, context.aavStaffCost),
    },
    {
      id: "snu",
      title: "SNU Property & Loans",
      operating_signal: propsActual,
      cash_on_hand: null,
      staff_cost_signal: null,
      status: "register needed",
      data_state: "placeholder",
    },
  ];
}

function buildOverviewDetail(context, kit) {
  const conferenceNet = toNumber(context.actual.conference_net);
  const aavNet = toNumber(context.actual.aav_net);
  const payrollTotal = toNumber(context.payrollFy.total_cost);
  const cards = [
    {
      title: "SNC cash on hand",
      value: context.sncCash,
      note: "SDA Church SNSW Ltd CMF + Conference Inc Westpac rows where present.",
      tone: context.sncCash ? "good" : "warn",
      evidence: kit.cashEvidence("SNC cash on hand", context.sncCash, ["SDA Church", "Conference"]),
    },
    {
      title: "SNE cash on hand",
      value: null,
      note: "School cash not extracted by location yet.",
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
    {
      title: "AAV cash on hand",
      value: context.aavCash,
      note: "AAV CMF + Westpac rows from May dashboard cash section.",
      tone: "good",
      evidence: kit.cashEvidence("AAV cash on hand", context.aavCash, ["Alpine", "AAV"]),
    },
    {
      title: "SNU cash on hand",
      value: null,
      note: "Property/loan entity liquidity not extracted yet.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
    {
      title: "Entity health",
      value: "Mixed",
      note: "SNC/AAV have partial operating evidence; SNE/SNU still source-lane placeholders.",
      tone: "warn",
      evidence: kit.entityHealthEvidence,
    },
    {
      title: "Staff cost pressure",
      value: payrollTotal,
      note: `FY25-26 parsed payroll, ${context.payrollFy.unique_staff ?? "—"} unique staff to date.`,
      tone: "warn",
      evidence: kit.staffCostPressureEvidence(),
    },
    {
      title: "SNC operating result",
      value: conferenceNet,
      note: "Conference net from summary dashboard cells.",
      tone: (conferenceNet ?? 0) < 0 ? "bad" : "good",
      evidence: kit.srcSummary,
    },
    {
      title: "AAV operating result",
      value: aavNet,
      note: "AAV net from summary dashboard cells.",
      tone: (aavNet ?? 0) > 0 ? "good" : "bad",
      evidence: kit.srcSummary,
    },
  ];
  const tiles = [
    {
      title: "SNC church/ministry",
      body: `Field budget-spend signal ${pct(context.fieldFn.used_pct)} used. Separate pastoral people-cost lane: ${money(context.fieldStaffCost)}.`,
      tone: (toNumber(context.fieldFn.used_pct) ?? 0) > 90 ? "warn" : "",
      evidence: kit.fieldSpendEvidence(),
    },
    {
      title: "SNE schools",
      body: "Location split not extracted yet. Treat as missing-data lane, not a zero or safe result.",
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
    {
      title: "AAV campground",
      body: `Function actual net ${money(context.aavFn.actual)}; cash rows total ${money(context.aavCash)}.`,
      tone: (toNumber(context.aavFn.actual) ?? 0) > 0 ? "good" : "warn",
      evidence: kit.functionEvidence("ADVENTIST ALPINE VILLAGE"),
    },
    {
      title: "SNU property/loans",
      body: `Properties function actual ${money(context.propsFn.actual)}; property usage budget line exists but SNU register is not extracted.`,
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
    {
      title: "Staff cost pressure",
      body: `FY25-26 parsed payroll ${money(context.payrollFy.total_cost)}; office mapped cost ${money(context.officeCost)}.`,
      tone: "warn",
      evidence: kit.staffCostPressureEvidence(),
    },
    {
      title: "Missing evidence",
      body: "Cash-on-hand for SNE/SNU and school-location results are placeholders until source lanes are indexed.",
      tone: "bad",
      evidence: kit.assumptionsRegister,
    },
  ];
  const tables = [
    {
      title: "Entity health strip",
      headers: ["Entity", "Operating signal", "Cash-on-hand", "Staff-cost signal", "Status"],
      rows: [
        ["SNC Conference & Churches", conferenceNet, context.sncCash, context.fieldStaffCost, "watch"],
        ["SNE Border / BCC", null, null, null, "source lane needed"],
        ["SNE Mawson / CCS", null, null, null, "source lane needed"],
        ["SNE Narromine / NCS", null, null, null, "source lane needed"],
        ["AAV Campground", aavNet, context.aavCash, context.aavStaffCost, "partial evidence"],
        ["SNU Property & Loans", toNumber(context.propsFn.actual), null, null, "register needed"],
      ],
    },
  ];
  return {
    id: "overview",
    title: "CFO Overview",
    subtitle: "Cash, operating pressure, staff cost, and missing source lanes — with evidence one click away.",
    cards,
    tiles,
    tables,
  };
}

function buildSncDetail(context, kit) {
  const conferenceNet = toNumber(context.actual.conference_net);
  const cards = [
    {
      title: "Conference net",
      value: conferenceNet,
      note: "Summary dashboard conference income less expense.",
      tone: "bad",
      evidence: kit.conferenceNetEvidence(),
    },
    {
      title: "Field spend used",
      value: toNumber(context.fieldFn.used_pct),
      note: "Function-level spend signal; high usage by current point in year.",
      tone: "warn",
      evidence: kit.fieldSpendEvidence(),
    },
    {
      title: "Pastoral payroll lane",
      value: context.fieldStaffCost,
      note: "Mapped Field / pastoral FY25-26 payroll cost.",
      tone: "warn",
      evidence: kit.pastoralPayrollEvidence(),
    },
    {
      title: "Church/ministry map",
      value: "Linked",
      note: "Click for exact pastoral people/costs and the local map link.",
      tone: "",
      evidence: kit.churchMinistryMapEvidence(),
    },
  ];
  const tiles = [
    {
      title: "Tithe + attendance trend",
      body: "Needs church-level trend extraction before growth/shrink claims by congregation.",
      tone: "warn",
      evidence: laneEvidence(
        "Church trend lane",
        null,
        "Use church financials + attendance survey normalized source. Do not infer congregation growth from staffing alone."
      ),
    },
    {
      title: "Pastoral load",
      body: "Existing map has pastor/church assignments; next step is load scoring tied to attendance/tithe.",
      tone: "warn",
      evidence: kit.srcStaff,
    },
    {
      title: "Restricted/direct tithe",
      body: "Treatment should remain explicit; no unrestricted-cash assumption.",
      tone: "warn",
      evidence: laneEvidence(
        "Restricted tithe policy lane",
        null,
        "Needs finance policy/source confirmation before board-facing statements."
      ),
    },
  ];
  const tables = [
    {
      title: "Function pressure",
      headers: ["Function", "Budget", "Actual", "Used"],
      rows: SNC_FUNCTION_NAMES.map((name) => {
        const fn = context.functions[name] || {};
        return [name, toNumber(fn.budget), toNumber(fn.actual), toNumber(fn.used_pct)];
      }),
      // Parallel per-row EvidenceObject list (the legacy page attached an
      // Evidence button to every function row). Additive: `rows` keeps its
      // bare-array shape so existing consumers are untouched.
      row_evidence: SNC_FUNCTION_NAMES.map((name) => kit.functionEvidence(name)),
    },
  ];
  return {
    id: "snc",
    title: "SNC Conference & Churches",
    subtitle: "Conference/church operating entity view with current real signals and honest placeholders for church-level trends.",
    cards,
    tiles,
    tables,
  };
}

function buildSchoolDetail(entityId, context, kit) {
  const spec = SCHOOL_SPECS[entityId];
  const cards = [
    {
      title: "Cash on hand",
      value: null,
      note: `${spec.lane} cash/liquidity not extracted yet.`,
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
    {
      title: "Enrolment trend",
      value: null,
      note: `${spec.lane} enrolment trend source lane required.`,
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
    {
      title: "Staff cost",
      value: null,
      note: `${spec.lane} staff cost/FTE split not extracted; one generic school-exclude payroll signal exists only.`,
      tone: "warn",
      evidence: kit.srcStaff,
    },
    {
      title: "Operating result",
      value: null,
      note: `${spec.lane} budget vs actual not extracted by school location.`,
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
  ];
  const tiles = [
    {
      title: "Finance pack",
      body: "Budget, actuals, YTD result, cash, funding and inter-entity charges for this location.",
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
    {
      title: "Operational pack",
      body: "Enrolment, staffing/FTE, student-staff ratio, occupancy/campus constraints.",
      tone: "warn",
      evidence: kit.schoolPlaceholder,
    },
    {
      title: "Governance caution",
      body: "Education funds are not assumed transferable to church operations.",
      tone: "warn",
      evidence: laneEvidence(
        "Entity boundary lane",
        null,
        "SNE school economics should stay separated from SNC conference/church cash decisions unless confirmed by governance/accounting advice."
      ),
    },
  ];
  const tables = [
    {
      title: "Placeholder table",
      headers: ["Location", "Income/funding", "Staff cost", "Net result", "Status"],
      rows: [[spec.school, null, null, null, "Source lane not indexed"]],
    },
  ];
  return {
    id: entityId,
    title: spec.title,
    subtitle: `Entity placeholder page for ${spec.school}. It is deliberately not pretending school-location data has been extracted.`,
    cards,
    tiles,
    tables,
  };
}

function buildAavDetail(context, kit) {
  const aavNet = toNumber(context.actual.aav_net);
  const functionActual = toNumber(context.aavFn.actual);
  const cards = [
    {
      title: "Cash on hand",
      value: context.aavCash,
      note: "AAV CMF + Westpac May cash rows.",
      tone: "good",
      evidence: kit.srcSummary,
    },
    {
      title: "Operating result",
      value: aavNet,
      note: "AAV result from operating statement summary dashboard.",
      tone: (aavNet ?? 0) > 0 ? "good" : "bad",
      evidence: kit.srcSummary,
    },
    {
      title: "Function actual",
      value: functionActual,
      note: "Velixo function-level actual; basis differs from summary and should be reconciled.",
      tone: (functionActual ?? 0) > 0 ? "good" : "warn",
      evidence: kit.srcDetail,
    },
    {
      title: "Staff cost lane",
      value: context.aavStaffCost,
      note: "Current payroll category: AAV - exclude for now.",
      tone: "warn",
      evidence: kit.srcStaff,
    },
  ];
  const tiles = [
    {
      title: "Revenue / cost trend",
      body: `Function income actual ${money(context.aavFn.income_actual)}; expense actual ${money(context.aavFn.expense_actual)}.`,
      tone: "warn",
      evidence: kit.srcDetail,
    },
    {
      title: "Occupancy / booking trend",
      body: "Not extracted yet. Needed before interpreting campground demand.",
      tone: "warn",
      evidence: laneEvidence("AAV bookings lane", null, "Needs booking/occupancy/usage source, if available."),
    },
    {
      title: "Maintenance / capex pressure",
      body: "Not extracted yet. Keep visible because campground profit can be overstated if maintenance backlog is ignored.",
      tone: "warn",
      evidence: laneEvidence("AAV capex-maintenance lane", null, "Needs asset/capex/maintenance source and any commitments."),
    },
  ];
  return {
    id: "aav",
    title: "AAV Campground",
    subtitle: "Campground/commercial-ministry page with cash/result evidence and visible gaps for occupancy and maintenance.",
    cards,
    tiles,
    tables: [],
  };
}

function buildSnuDetail(context, kit) {
  const cards = [
    {
      title: "Cash on hand",
      value: null,
      note: "SNU liquidity not extracted yet.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
    {
      title: "Property usage signal",
      value: toNumber(context.propsFn.actual),
      note: "SNC Properties function actual only; not a full SNU result.",
      tone: "warn",
      evidence: kit.srcDetail,
    },
    {
      title: "Loan register",
      value: null,
      note: "Loan balances/securities not indexed yet.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
    {
      title: "Recovery status",
      value: null,
      note: "Rental/property usage charge recovery not extracted yet.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
  ];
  const tiles = [
    {
      title: "Property register",
      body: "Property, owner/entity, occupant/ministry, rental basis, agreement status.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
    {
      title: "Loan register",
      body: "Loan, lender, secured property, repayment terms, guarantee/support links.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
    {
      title: "Under-recovery flags",
      body: "Compare charged, paid, recovered, waived, and missing agreements.",
      tone: "warn",
      evidence: kit.snuPlaceholder,
    },
  ];
  const tables = [
    {
      title: "Current extracted property-related line",
      headers: ["Lane", "Budget", "Actual", "Used", "Caution"],
      rows: [
        [
          "Properties function",
          toNumber(context.propsFn.budget),
          toNumber(context.propsFn.actual),
          toNumber(context.propsFn.used_pct),
          "Partial SNC signal only",
        ],
      ],
    },
  ];
  return {
    id: "snu",
    title: "SNU Property & Loans",
    subtitle: "Property/rent/loan placeholder page. It names the registers needed and avoids pretending the SNU economics are already known.",
    cards,
    tiles,
    tables,
  };
}

function buildEntityDetail(entityId, context) {
  const kit = buildEvidenceKit(context);
  if (entityId === "overview") return buildOverviewDetail(context, kit);
  if (entityId === "snc") return buildSncDetail(context, kit);
  if (entityId === "aav") return buildAavDetail(context, kit);
  if (entityId === "snu") return buildSnuDetail(context, kit);
  return buildSchoolDetail(entityId, context, kit);
}

function combineEntityMeta(inputs) {
  const parts = { budget: inputs.budget.meta, staffing: inputs.staffing.meta, staffCost: inputs.staffCost.meta };
  const kinds = Object.values(parts).map((meta) => meta.dataSource);
  const dataSource = kinds.includes("live-cache") ? "live-cache" : kinds.includes("synthetic") ? "synthetic" : "missing";
  const warnings = Object.entries(parts)
    .filter(([, meta]) => meta.dataSource === "missing")
    .map(([name]) => `${name} input missing; explicit null placeholders returned`);
  return {
    dataSource,
    sourcePath: parts.budget.sourcePath,
    generated_at: parts.budget.generated_at,
    warnings,
    extra: {
      inputs: {
        budget: parts.budget.dataSource,
        staffing: parts.staffing.dataSource,
        staffCost: parts.staffCost.dataSource,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Public service functions.
// ---------------------------------------------------------------------------

function getEntitiesList(query) {
  const pagination = parsePagination(query, { defaultLimit: 100, maxLimit: 100 });
  const inputs = loadEntityInputs();
  const context = computeEntityContext(inputs);
  const page = paginate(buildEntityList(context), pagination);
  return {
    data: { entities: page.rows, total: page.total, limit: page.limit, offset: page.offset },
    meta: combineEntityMeta(inputs),
  };
}

function getEntity(entityId) {
  if (!ENTITY_IDS.includes(entityId)) {
    throw new NotFoundError(`unknown entity: ${entityId}`);
  }
  const inputs = loadEntityInputs();
  const context = computeEntityContext(inputs);
  return { data: buildEntityDetail(entityId, context), meta: combineEntityMeta(inputs) };
}

function trimYearCatalogue(year) {
  const { all_files: _allFiles, ...rest } = year;
  return rest;
}

function getConstituencyHistory(query) {
  const includeRaw = query.include;
  let sections = null;
  if (includeRaw !== undefined) {
    const joined = Array.isArray(includeRaw) ? includeRaw.join(",") : String(includeRaw);
    const tokens = joined
      .split(",")
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => enumParam(token, HISTORY_INCLUDES, "include"));
    sections = new Set(tokens);
  }
  const { data, meta } = loadConstituencyHistoryDoc();
  if (!data) return { data: null, meta };
  const trimmed = {
    generated_at: data.generated_at ?? null,
    generator: data.generator ?? null,
    source_root: data.source_root ?? null,
    source_root_url: data.source_root_url ?? null,
    method: data.method ?? null,
    warnings: data.warnings ?? [],
    all_evidence_count: data.all_evidence_count ?? null,
  };
  if (sections === null) {
    // Default view: full document but each year's large all_files list omitted.
    trimmed.years = (data.years || []).map(trimYearCatalogue);
    trimmed.claims = data.claims || [];
  } else {
    if (sections.has("years")) trimmed.years = data.years || [];
    if (sections.has("claims")) trimmed.claims = data.claims || [];
  }
  return { data: trimmed, meta };
}

function getConstituencyYear(yearParam) {
  const year = String(yearParam);
  if (!SESSION_YEARS.includes(year)) {
    throw new NotFoundError(`year ${year} is not in the session catalogue (${SESSION_YEARS.join(", ")})`);
  }
  return findInDoc(
    loadConstituencyHistoryDoc,
    "years",
    (entry) => String(entry.year) === year,
    `year ${year} is not present in the constituency history data`
  );
}

// Mirrors the in-browser question box in constituency-investigations-layer.html:
// term-score each claim over question/why/search_terms/evidence text, keep the
// top four matches.
function scoreClaims(claims, question) {
  const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const scored = claims
    .map((claim) => {
      const haystack = [
        claim.question || "",
        claim.why || "",
        (claim.search_terms || []).join(" "),
        (claim.evidence || []).map((item) => `${item.relative_path ?? ""} ${item.source_status ?? ""}`).join(" "),
      ]
        .join(" ")
        .toLowerCase();
      const score = terms.reduce((count, term) => count + (haystack.includes(term) ? 1 : 0), 0);
      return { ...claim, score };
    })
    .filter((claim) => claim.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4);
}

function getConstituencyClaims(query) {
  const priority = enumParam(query.priority, CLAIM_PRIORITIES, "priority");
  const question = typeof query.q === "string" && query.q.trim() ? query.q.trim() : undefined;
  return pagedDocList(loadConstituencyHistoryDoc, "claims", query, {
    headerKeys: [],
    filterRows: (rows) => {
      let claims = rows;
      if (priority) claims = claims.filter((claim) => claim.priority === priority);
      if (question) claims = scoreClaims(claims, question);
      return claims;
    },
  });
}

function getFieldPastoral() {
  return loadFieldPastoralDoc();
}

function getFieldPastoralStaff(query) {
  const pagination = parsePagination(query, { defaultLimit: 100, maxLimit: 500 });
  const { data, meta } = loadFieldPastoralDoc();
  const staff = (data && data.staff) || {};
  const byCategory = Array.isArray(staff.by_category) ? staff.by_category : [];
  const allowedCategories = byCategory.map((entry) => entry.category);
  const category = enumParam(query.category, allowedCategories, "category");
  let people = Array.isArray(staff.all_people) ? staff.all_people : [];
  if (category) people = people.filter((person) => person.category === category);
  const page = paginate(people, pagination);
  return {
    data: {
      by_category: byCategory,
      people: page.rows,
      direct_conference_total: staff.direct_conference_total ?? null,
      source: staff.source ?? null,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
    },
    meta,
  };
}

// Overlays live Mongo history coverage (myobHistoryService.historyCoverage())
// onto the static history-comparison rows. Only the two rows whose status is
// actually derivable from the history store are rewritten — the MYOB-era
// detail row and the department budget-vs-actual row, matched by a stable
// substring of their fixture `area`; SUN legacy, payroll, session and SNC
// operating rows pass through untouched. Exported for tests.
function overlayHistoryCoverage(doc, coverage) {
  const visible = coverage.visibleFys.length > 0 ? coverage.visibleFys.join(", ") : null;
  const floor = coverage.floorDate ?? "the MYOB era start";
  const rows = doc.data.rows.map((row) => {
    const area = String(row.area ?? "").toLowerCase();
    if (area.includes("myob current-era")) {
      return visible
        ? { ...row, status: "Available", what: `Journal history from ${floor}; prior FYs queryable: ${visible}.` }
        : {
            ...row,
            status: "Current year only",
            what: "History store reachable but no prior FYs pass the mapping gate yet; only current-FY MYOB detail can be quoted.",
          };
    }
    if (area.includes("department budget vs actual")) {
      if (!visible) {
        return {
          ...row,
          status: "Current year only",
          what: "FY2026 approved budget vs current actuals exists; no prior FYs pass the mapping gate yet, so prior-year department/function comparisons stay unavailable.",
        };
      }
      const budgets =
        coverage.budgetFys.length > 0
          ? `budget rows loaded for ${coverage.budgetFys.map((entry) => entry.fy).join(", ")}`
          : "no prior-year budget rows loaded";
      return {
        ...row,
        status: "Available",
        what: `FY2026 approved budget vs current actuals, plus prior-FY actuals queryable: ${visible} (journal history from ${floor}; ${budgets}).`,
      };
    }
    return row;
  });
  return { data: { ...doc.data, rows }, meta: doc.meta };
}

// Live overlay on top of the resolved doc: when the Mongo history store is
// reachable, the two derivable rows report real coverage instead of the
// design-era snapshot. historyCoverage() never throws and returns null when
// the store is unavailable (MONGODB_URI unset) or unreadable — the doc is
// then served exactly as today, fixture bytes untouched.
async function getHistoryComparison(query) {
  const doc = pagedDocList(loadHistoryComparisonDoc, "rows", query);
  // Lazy require: keeps this module free of the history stack (Mongo repo,
  // MYOB client) at import time and avoids any require cycle.
  const coverage = await require("./myobHistoryService").historyCoverage();
  return coverage ? overlayHistoryCoverage(doc, coverage) : doc;
}

function getEvidenceRegistry(query) {
  const status = enumParam(query.status, REGISTRY_STATUSES, "status");
  const confidence = enumParam(query.confidence, REGISTRY_CONFIDENCES, "confidence");
  return pagedDocList(loadEvidenceRegistryDoc, "metrics", query, {
    headerKeys: ["generated_at", "schema"],
    filterRows: (rows) =>
      rows.filter(
        (metric) => (!status || metric.status === status) && (!confidence || metric.confidence === confidence)
      ),
  });
}

function getEvidenceMetric(metricId) {
  return findInDoc(
    loadEvidenceRegistryDoc,
    "metrics",
    (entry) => entry.metric_id === metricId,
    `unknown evidence metric: ${metricId}`
  );
}

function getEmailIntelligence() {
  // Serves the derived JSON cache only; the SQLite mail/policy indexes are
  // never opened by the backend.
  return loadEmailIntelligenceDoc();
}

function getFinanceSources(query) {
  return pagedDocList(loadFinanceSourcesDoc, "lanes", query);
}

function getFinanceLane(laneId) {
  return findInDoc(loadFinanceSourcesDoc, "lanes", (entry) => entry.id === laneId, `unknown finance source lane: ${laneId}`);
}

module.exports = {
  getEntitiesList,
  getEntity,
  getConstituencyHistory,
  getConstituencyYear,
  getConstituencyClaims,
  getFieldPastoral,
  getFieldPastoralStaff,
  getHistoryComparison,
  overlayHistoryCoverage,
  getEvidenceRegistry,
  getEvidenceMetric,
  getEmailIntelligence,
  getFinanceSources,
  getFinanceLane,
};

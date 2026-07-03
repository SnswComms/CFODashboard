const { BadRequestError, NotFoundError } = require("../lib/errors");
const { formatMoney } = require("../lib/format");
const { paginate } = require("../lib/pagination");
const { matchesSlugOrName } = require("../lib/slug");
const { decisionCardStatus } = require("./statusRules");
const { resolveData } = require("../repositories/dataSourceResolver");
const reportPackRepository = require("../repositories/reportPackRepository");
const projectionsRepository = require("../repositories/projectionsRepository");
const approved = require("../constants/approvedBudget");

const CONFERENCE_FILE = "cfo-budget-decision-dashboard-data.json";
const CONFERENCE_HEALTH_FILE = "cfo-budget-decision-dashboard-health.json";
const DEPARTMENTS_VELIXO_FILE = "department-budget-dashboard-data.json";
const DEPARTMENTS_MYOB_FILE = "department-budget-myob-data.json";

const CONFERENCE_FIXTURE = "budget-conference.json";
const DEPARTMENTS_FIXTURE = "budget-departments.json";
const SUMMARY_FIXTURE = "budget-summary.json";

function fmtMoney(value) {
  return formatMoney(Number(value) || 0);
}

// Mirrors elapsed_ratio() in generate_department_budget_dashboard.py.
const MONTH_TOKENS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};

function elapsedRatio(label) {
  const text = String(label ?? "").toLowerCase();
  for (const [token, month] of Object.entries(MONTH_TOKENS)) {
    if (text.includes(token)) return month / 12;
  }
  return null;
}

// Mirrors pace_label() in generate_department_budget_dashboard.py.
function paceLabel(actual, budget, ratio) {
  if (!ratio || !budget) return { label: "No pace basis", variance: 0.0, expected: null };
  const expected = budget * ratio;
  const variance = expected - actual;
  if (variance >= 0) {
    return { label: `${fmtMoney(variance)} under elapsed-year pace`, variance, expected };
  }
  return { label: `${fmtMoney(Math.abs(variance))} over elapsed-year pace`, variance, expected };
}

function getConference() {
  const resolved = resolveData({
    candidates: [{ dirKey: "dashboards", file: CONFERENCE_FILE }],
    fixture: CONFERENCE_FIXTURE,
  });
  if (!resolved.data) {
    return {
      data: { generated_at: null, budget: null, summary: null, detail: null, decision_cards: null, health: null },
      meta: resolved.meta,
    };
  }
  return resolved;
}

function getConferenceHealth() {
  const resolved = resolveData({ candidates: [{ dirKey: "dashboards", file: CONFERENCE_HEALTH_FILE }] });
  if (resolved.data) return resolved;
  const conference = getConference();
  if (conference.data?.health) return { data: conference.data.health, meta: conference.meta };
  return {
    data: { generated_at: null, status: null, warnings: [], errors: [] },
    meta: { dataSource: "missing", sourcePath: null, generated_at: null },
  };
}

// Function-row filters mirror the generator's watchlists:
// over = expense budget present and overspent; tight = >= 85% used.
function functionMatchesStatus(row, status) {
  const expenseBudget = row.expense_budget ?? 0;
  if (status === "over") return expenseBudget > 0 && (row.expense_remaining ?? 0) < 0;
  if (status === "tight") return expenseBudget > 0 && (row.used_pct ?? 0) >= 85;
  return true;
}

const FUNCTION_SORTS = {
  expense_budget: (a, b) => Math.abs(b.expense_budget ?? 0) - Math.abs(a.expense_budget ?? 0),
  expense_remaining: (a, b) => (a.expense_remaining ?? 0) - (b.expense_remaining ?? 0),
  used_pct: (a, b) => (b.used_pct ?? 0) - (a.used_pct ?? 0),
};

function getFunctions({ status, sort, pagination }) {
  const conference = getConference();
  let functions = [...(conference.data?.detail?.functions ?? [])];
  if (status) functions = functions.filter((row) => functionMatchesStatus(row, status));
  if (sort) functions.sort(FUNCTION_SORTS[sort]);
  const page = paginate(functions, pagination);
  return {
    data: { total: page.total, limit: page.limit, offset: page.offset, functions: page.rows },
    meta: conference.meta,
  };
}

// Mirrors the affordability wording in build_decision_cards().
function recomputeCard(card, request) {
  const budget = card.budget ?? 0;
  const remaining = card.remaining ?? 0;
  const after = remaining - request;
  let status;
  let statusClass;
  let advice;
  if (budget <= 0) {
    status = "Check source";
    statusClass = "warn";
    advice = "No clear expense budget found for this lane. Treat as CFO review required.";
  } else {
    statusClass = decisionCardStatus(after, budget);
    if (statusClass === "good") {
      status = "Likely affordable";
      advice = `A ${fmtMoney(request)} request still leaves about ${fmtMoney(after)}.`;
    } else if (statusClass === "warn") {
      status = "Possible, but tight";
      advice = `A ${fmtMoney(request)} request fits but leaves only ${fmtMoney(after)}.`;
    } else {
      status = "Not affordable in lane";
      advice = `A ${fmtMoney(request)} request would exceed the visible lane by ${fmtMoney(Math.abs(after))}.`;
    }
  }
  return {
    ...card,
    example_request: request,
    after_request: after,
    status,
    status_class: statusClass,
    advice,
  };
}

function getDecisionCards({ id, request }) {
  const conference = getConference();
  let cards = conference.data?.decision_cards ?? [];
  if (id !== undefined) {
    cards = cards.filter((card) => card.id === id);
    if (cards.length === 0) throw new NotFoundError(`decision card not found: ${id}`);
  }
  if (request !== undefined) {
    cards = cards.map((card) => recomputeCard(card, request));
  }
  return { data: cards, meta: conference.meta };
}

function getSummary() {
  const resolved = resolveData({
    candidates: [{ dirKey: "dashboards", file: CONFERENCE_FILE }],
    fixture: SUMMARY_FIXTURE,
    transform: (raw) => {
      // Live conference file nests the block under `summary`; the fixture is
      // already summary-shaped. Anything else collapses to the null shape so
      // this endpoint can never leak a differently-shaped payload.
      const summary = raw.summary ?? (raw.actual !== undefined ? raw : null);
      return {
        actual: summary?.actual ?? null,
        cash_rows: summary?.cash_rows ?? [],
        source: summary?.source ?? null,
        modified: summary?.modified ?? null,
      };
    },
  });
  if (!resolved.data) {
    return { data: { actual: null, cash_rows: [], source: null, modified: null }, meta: resolved.meta };
  }
  return resolved;
}

function getApproved() {
  return {
    data: {
      basis: approved.APPROVED_BUDGET_BASIS,
      totals: approved.APPROVED_TOTALS,
      top_expense_budget: approved.APPROVED_TOP_EXPENSE_BUDGET,
      top_income_budget: approved.APPROVED_TOP_INCOME_BUDGET,
      function_budgets: approved.APPROVED_FUNCTION_BUDGETS,
      department_budgets: approved.APPROVED_DEPARTMENT_BUDGETS,
      department_lines: Object.fromEntries(
        Object.entries(approved.APPROVED_DEPARTMENT_LINES).map(([name, lines]) => [
          name,
          lines.map(([line, budget]) => ({ line, budget })),
        ])
      ),
      lane_budgets: approved.APPROVED_LANE_BUDGETS,
    },
    meta: {
      dataSource: "synthetic",
      sourcePath: null,
      generated_at: null,
      extra: { basis: approved.APPROVED_BUDGET_BASIS },
    },
  };
}

// Sync-run errors embedded by buildDepartmentReport (period_context.
// source_errors) mark the report degraded, so auto mode falls back rather
// than serving figures built off a partial extract. Reports written before
// the field existed keep the previous behavior.
function myobReportIsCurrent(data) {
  return (
    data?.period_context?.source_kind === "myob_live_gl_cache" &&
    !data?.period_context?.source_errors?.length &&
    Array.isArray(data?.departments) &&
    data.departments.length > 0
  );
}

// Generator preference rule: MYOB report only when live and populated, else the
// Velixo-derived dashboard file, else approved-constant synthetic departments.
function resolveDepartmentsPayload(source) {
  if (source === "myob") {
    return resolveData({
      candidates: [{ dirKey: "dashboards", file: DEPARTMENTS_MYOB_FILE }],
      fixture: DEPARTMENTS_FIXTURE,
    });
  }
  if (source === "velixo") {
    return resolveData({
      candidates: [{ dirKey: "dashboards", file: DEPARTMENTS_VELIXO_FILE }],
      fixture: DEPARTMENTS_FIXTURE,
    });
  }
  const myob = resolveData({ candidates: [{ dirKey: "dashboards", file: DEPARTMENTS_MYOB_FILE }] });
  if (myobReportIsCurrent(myob.data)) return myob;
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: DEPARTMENTS_VELIXO_FILE }],
    fixture: DEPARTMENTS_FIXTURE,
  });
}

function getDepartments({ source = "auto", status, q, pagination }) {
  const resolved = resolveDepartmentsPayload(source);
  if (!resolved.data) {
    return {
      data: { generated_at: null, source: null, source_modified: null, period_context: null, departments: [], summary: null },
      meta: { ...resolved.meta, extra: { total: 0, limit: pagination.limit, offset: pagination.offset } },
    };
  }
  let departments = resolved.data.departments ?? [];
  if (status) departments = departments.filter((department) => department.status === status);
  if (q) {
    const needle = String(q).toLowerCase();
    departments = departments.filter((department) => String(department.name).toLowerCase().includes(needle));
  }
  const page = paginate(departments, pagination);
  return {
    data: { ...resolved.data, departments: page.rows },
    meta: { ...resolved.meta, extra: { total: page.total, limit: page.limit, offset: page.offset } },
  };
}

function getDepartment(slugOrName) {
  const resolved = resolveDepartmentsPayload("auto");
  const departments = resolved.data?.departments ?? [];
  const department = departments.find((candidate) => matchesSlugOrName(slugOrName, candidate.name));
  if (!department) throw new NotFoundError(`department not found: ${slugOrName}`);
  return { data: department, meta: resolved.meta };
}

function getDepartmentsMapping() {
  const myob = resolveData({ candidates: [{ dirKey: "dashboards", file: DEPARTMENTS_MYOB_FILE }] });
  if (myob.data?.mapping) return { data: myob.data.mapping, meta: myob.meta };
  return {
    data: {
      subaccount_prefix_to_department: approved.PREFIX_TO_DEPT,
      unmapped_prefix_totals: {},
      excluded_non_expense_account_totals: {},
      notes: approved.MAPPING_NOTES,
    },
    meta: { dataSource: "synthetic", sourcePath: null, generated_at: null },
  };
}

function getDepartmentsPace({ month }) {
  const resolved = resolveDepartmentsPayload("auto");
  const departments = resolved.data?.departments ?? [];
  const ratio =
    month !== undefined
      ? month / 12
      : elapsedRatio(resolved.data?.period_context?.actual_period_label);
  const currentPaceRatio = (new Date().getMonth() + 1) / 12;
  const rows = departments.map((department) => {
    const budget = department.budget ?? 0;
    const spent = department.spent ?? 0;
    const pace = paceLabel(spent, budget, ratio);
    return {
      name: department.name,
      budget,
      spent,
      expected_at_elapsed: pace.expected,
      pace_variance: pace.variance,
      pace_label: pace.label,
      used_pct: department.used_pct ?? null,
      current_pace_target: budget * currentPaceRatio,
    };
  });
  return { data: rows, meta: resolved.meta };
}

function getReportPacks() {
  const packs = reportPackRepository.listPacks();
  return {
    data: packs,
    meta: {
      dataSource: reportPackRepository.packsRoot() ? "live-cache" : "missing",
      sourcePath: reportPackRepository.packsRoot(),
      generated_at: null,
    },
  };
}

function getReportPackFile(id, file) {
  if (!reportPackRepository.isValidPackId(id)) {
    throw new BadRequestError("report pack id must be YYYYMMDD-HHMMSS or 'latest'");
  }
  if (!reportPackRepository.isAllowedPackFile(file)) {
    throw new BadRequestError(
      "file must be one of: department-summary.csv, department-lines.csv, department-evidence-sample.csv, source-manifest.json"
    );
  }
  const resolved = reportPackRepository.resolvePackFile(id, file);
  if (!resolved) throw new NotFoundError(`report pack file not found: ${id}/${file}`);
  return resolved;
}

function getFieldProjections() {
  const stored = projectionsRepository.readProjections();
  if (!stored.value) {
    return {
      data: { savedAt: null, field: {} },
      meta: { dataSource: "missing", sourcePath: stored.filePath, generated_at: null },
    };
  }
  return {
    data: { savedAt: stored.value.savedAt ?? null, field: stored.value.field ?? {} },
    meta: { dataSource: stored.dataSource, sourcePath: stored.filePath, generated_at: stored.value.savedAt ?? null },
  };
}

function saveFieldProjections(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestError("body must be an object of shape {field:{<line>: number}}");
  }
  const field = body.field;
  if (!field || typeof field !== "object" || Array.isArray(field)) {
    throw new BadRequestError("field must be an object mapping line names to numbers");
  }
  for (const [line, amount] of Object.entries(field)) {
    if (typeof amount !== "number" || !Number.isFinite(amount)) {
      throw new BadRequestError(`field["${line}"] must be a finite number`);
    }
  }
  const record = { savedAt: new Date().toISOString(), field };
  const target = projectionsRepository.writeProjections(record);
  return {
    data: record,
    meta: { dataSource: target.dataSource, sourcePath: target.filePath, generated_at: record.savedAt },
  };
}

module.exports = {
  getConference,
  getConferenceHealth,
  getFunctions,
  getDecisionCards,
  getSummary,
  getApproved,
  getDepartments,
  getDepartment,
  getDepartmentsMapping,
  getDepartmentsPace,
  getReportPacks,
  getReportPackFile,
  getFieldProjections,
  saveFieldProjections,
};

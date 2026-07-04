// Live MYOB GL derivation for the CFO Command Centre. Turns the read-only
// live-gl cache (journal lines, already extracted GET-only from MYOB) into the
// same payload shapes the synthetic constants encode. Budgets always come from
// the board-approved constants (constants/approvedBudget.js); ONLY actuals
// (spent / income / expense) come from the cache. No file reads, no network —
// the service hands the parsed cache document in.

const { APPROVED_TOTALS, PREFIX_TO_DEPT, DECISION_LANES } = require("../constants/approvedBudget");
const {
  FUNCTIONS_RAW,
  DEPT_RAW,
  LANES_RAW,
  ENT_DEFS,
  FUNCTION_DEPT_KEYS,
  DEPT_ENTITY_MAP,
  BRANCH_ENTITY_MAP,
  OVERVIEW_KPIS,
} = require("../constants/commandCentre");

// LANES_RAW and DECISION_LANES agree on lane ids except the president lane.
const LANE_DECISION_IDS = { president: "president_discretionary" };

// Design KPI number style: $8.03M / $136K, negatives as ($139K).
function fmtCompact(x) {
  const abs = Math.abs(x);
  const s = abs >= 1e6 ? "$" + (abs / 1e6).toFixed(2) + "M" : "$" + Math.round(abs / 1e3) + "K";
  return x < 0 ? "(" + s + ")" : s;
}

// Inverse of the synthetic computeUsage: used_pct comes honestly from real
// sums, but the over/tight/ok thresholds are the same contract §2 rules.
function usageFrom(budget, spent) {
  const used_pct = budget > 0 ? Math.round((spent / budget) * 100) : 0;
  const remaining = budget - spent;
  const status = remaining < 0 ? "over" : used_pct >= 85 ? "tight" : "ok";
  return { used_pct, spent, remaining, status };
}

function classifyAccounts(accounts) {
  const classes = new Map();
  for (const account of accounts || []) {
    const code = account.AccountCD ?? account.Account ?? account.AccountID ?? "";
    // Some tenants put the semantic kind in Type (Expense/Income/Asset/...)
    // and a bare numeric prefix in AccountClass — match against both.
    const cls = [account.Type, account.AccountClass]
      .filter((value) => value !== undefined && value !== null)
      .map((value) => String(value).toUpperCase())
      .join(" ");
    if (code !== "") classes.set(String(code), cls);
  }
  return classes;
}

// Income accounts are credit-normal; lines on accounts with no known class are
// treated as expense (the extractor's default sweep is expense lines), and
// balance-sheet activity is skipped — it is not P&L actuals.
function lineKind(cls) {
  if (!cls) return "expense";
  if (cls.includes("INCOME") || cls.includes("REVENUE") || cls.includes("SALES")) return "income";
  if (cls.includes("EXPENSE")) return "expense";
  return "skip";
}

// Department from the first MYOB subaccount segment/prefix (PREFIX_TO_DEPT).
function deptForSubaccount(subaccount) {
  const segment = String(subaccount || "").split(/[-./ ]/)[0].trim().toUpperCase();
  return PREFIX_TO_DEPT[segment] || PREFIX_TO_DEPT[segment.slice(0, 3)] || null;
}

function monthOf(line) {
  const date = new Date(String(line.date || ""));
  if (!Number.isNaN(date.getTime())) return date.getUTCMonth() + 1;
  const fromPeriod = Number(String(line.period || "").slice(0, 2));
  if (fromPeriod >= 1 && fromPeriod <= 12) return fromPeriod;
  return null;
}

function rangeLabel(range) {
  if (!range || (!range.fromDate && !range.toDate)) return null;
  if (range.label) return range.label;
  if (range.fromDate && range.toDate) return `${range.fromDate} to ${range.toDate}`;
  if (range.fromDate) return `From ${range.fromDate}`;
  return `To ${range.toDate}`;
}

// One normalized record per usable journal line. Bill lines are deliberately
// excluded — per the mapping notes, journals are the accounting actual source
// and AP bill lines are evidence only. Post-dated journals (the tenant carries
// accrual/recurring batches dated months ahead) are excluded so YTD sums stay
// honest as-of the extract date.
function normalizeLines(doc, range = {}) {
  const classes = classifyAccounts(doc.accounts);
  const asOf = String(doc.generated_at ?? "").slice(0, 10);
  const lines = [];
  for (const raw of doc.journal_lines || []) {
    if (asOf && raw.date && String(raw.date).slice(0, 10) > asOf) continue;
    const date = String(raw.date || "").slice(0, 10);
    if (range.fromDate && (!date || date < range.fromDate)) continue;
    if (range.toDate && (!date || date > range.toDate)) continue;
    const kind = lineKind(classes.get(String(raw.account ?? "")));
    if (kind === "skip") continue;
    const debit = Number(raw.debit) || 0;
    const credit = Number(raw.credit) || 0;
    const netDebit =
      raw.net_debit === undefined || raw.net_debit === null ? debit - credit : Number(raw.net_debit) || 0;
    lines.push({
      kind,
      amount: kind === "income" ? -netDebit : netDebit,
      dept: deptForSubaccount(raw.subaccount),
      branch: String(raw.branch || "").toUpperCase(),
      month: monthOf(raw),
      text: [raw.account_description, raw.line_description, raw.header_description]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
      // Evidence fields for lane matched_lines (additive — only the lane
      // evidence below reads them, aggregation stays on the fields above).
      date: raw.date ?? null,
      account: String(raw.account ?? ""),
      description: String(raw.line_description || raw.header_description || raw.account_description || ""),
    });
  }
  return lines;
}

// Lane actuals via the DECISION_LANES term contract: expense lines whose
// department matches a function term and whose haystack carries a detail term
// (excluding the lane's exclude terms). The haystack is department name +
// descriptions — Python parity: generate_cfo_budget_dashboard.py:316 builds
// hay from the function name too, so e.g. every EVANGELISM-dept expense line
// counts toward the evangelism lane. Returns the matched-line evidence
// alongside the sum so /lanes and the copilot can show WHICH GL lines back
// the figure (capped sample; match_count is always the full tally).
const LANE_MATCHED_LINES_CAP = 8;

function laneMatchesFrom(lines, def) {
  let sum = 0;
  let match_count = 0;
  const matched_lines = [];
  for (const line of lines) {
    if (line.kind !== "expense" || !line.dept) continue;
    if (!def.function_terms.some((term) => line.dept.includes(term))) continue;
    const hay = line.dept.toLowerCase() + " " + line.text;
    if (def.exclude_terms.some((term) => hay.includes(term))) continue;
    if (!def.detail_terms.some((term) => hay.includes(term))) continue;
    sum += line.amount;
    match_count += 1;
    if (matched_lines.length < LANE_MATCHED_LINES_CAP) {
      matched_lines.push({
        date: line.date,
        account: line.account,
        description: line.description,
        amount: Math.round(line.amount),
      });
    }
  }
  return { spent: Math.round(sum), match_count, matched_lines };
}

// Calendar-year elapsed % at the cache timestamp (the design constant 42 is
// 31 May against a Jan–Dec FY2026).
function periodFrom(generatedAt, range = {}) {
  const label = rangeLabel(range);
  if (label) {
    const from = range.fromDate ? new Date(`${range.fromDate}T00:00:00Z`) : null;
    const to = range.toDate ? new Date(`${range.toDate}T00:00:00Z`) : new Date(generatedAt ?? "");
    const year = to && !Number.isNaN(to.getTime()) ? to.getUTCFullYear() : 2026;
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const inclusiveTo = to && !Number.isNaN(to.getTime()) ? to.getTime() + 24 * 60 * 60 * 1000 : null;
    const elapsed = inclusiveTo ? ((inclusiveTo - start) / (end - start)) * 100 : 42;
    return {
      label,
      elapsed_pct: Math.min(100, Math.max(0, Math.round(elapsed))),
      from_date: range.fromDate ?? null,
      to_date: range.toDate ?? null,
    };
  }
  const at = new Date(generatedAt ?? "");
  if (Number.isNaN(at.getTime())) return { label: "FY2026 to date", elapsed_pct: 42 };
  const year = at.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const elapsed_pct = Math.min(100, Math.max(0, Math.round(((at.getTime() - start) / (end - start)) * 100)));
  return { label: "FY" + year + " to date", elapsed_pct };
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthStart(year, month) {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

function monthEnd(year, month) {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthIsInRange(year, month, range = {}) {
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  if (range.fromDate && end < range.fromDate) return false;
  if (range.toDate && start > range.toDate) return false;
  return true;
}

function observationFrom(overs, tights) {
  const clauses = [];
  if (overs.length > 0) {
    const names = overs.map((fn) => fn.name).join(" and ");
    clauses.push(
      names +
        (overs.length === 1 ? " has" : " have") +
        " already overrun " +
        (overs.length === 1 ? "its" : "their") +
        " full-year allocation",
    );
  }
  for (const fn of tights) clauses.push(fn.name + " is " + fn.used_pct + "% committed");
  if (clauses.length === 0) return "Every function sits at or under elapsed-year pace.";
  const last = clauses.pop();
  const joined = clauses.length > 0 ? clauses.join(", ") + ", and " + last : last;
  return joined + ". Every other function still sits at or under elapsed-year pace.";
}

// doc: parsed live-gl cache; meta: the resolver's live-cache meta, returned
// with the health warnings attached so every getter's envelope carries
// meta.warnings. warnings/stale come from the service's sync-health checks
// (commandCentreService.liveHealth) and drive the data-health KPI, the live
// freshness entry and the derived alerts below.
function buildLiveModel(doc, meta, { warnings = [], stale = false } = {}, range = {}) {
  const lines = normalizeLines(doc, range);
  const generated_at = meta.generated_at ?? doc.generated_at ?? null;

  // Extract-level provenance for the /sources evidence registry: how much of
  // the GL cache this derivation saw, and the extract window it covers.
  const sourceCounts = {
    accounts: (doc.accounts || []).length,
    journal_lines: lines.length,
    from_date: range.fromDate ?? doc.from_date ?? null,
    to_date: range.toDate ?? doc.to_date ?? null,
  };

  const deptSpent = new Map();
  const deptMonthlySpent = new Map();
  const entityAgg = new Map(ENT_DEFS.map((entity) => [entity.name, { income: 0, expense: 0 }]));
  const monthly = { income: Array(12).fill(0), expense: Array(12).fill(0) };
  let income = 0;
  let expense = 0;
  for (const line of lines) {
    if (line.kind === "income") income += line.amount;
    else expense += line.amount;
    const entity = entityAgg.get(
      DEPT_ENTITY_MAP[line.dept] || BRANCH_ENTITY_MAP[line.branch] || ENT_DEFS[0].name,
    );
    if (entity) entity[line.kind] += line.amount;
    if (line.kind === "expense" && line.dept) {
      deptSpent.set(line.dept, (deptSpent.get(line.dept) || 0) + line.amount);
      if (line.month) {
        let byMonth = deptMonthlySpent.get(line.dept);
        if (!byMonth) {
          byMonth = Array(12).fill(0);
          deptMonthlySpent.set(line.dept, byMonth);
        }
        byMonth[line.month - 1] += line.amount;
      }
    }
    if (line.month) monthly[line.kind][line.month - 1] += line.amount;
  }
  income = Math.round(income);
  expense = Math.round(expense);
  const totals = { income, expense, net: income - expense };

  const functions = FUNCTIONS_RAW.map((fn) => {
    const spent = Math.round(deptSpent.get(FUNCTION_DEPT_KEYS[fn.name]) || 0);
    return { name: fn.name, budget: fn.budget, ...usageFrom(fn.budget, spent) };
  });

  const departments = DEPT_RAW.map((dept) => {
    const spent = Math.round(deptSpent.get(FUNCTION_DEPT_KEYS[dept.name]) || 0);
    const usage = usageFrom(dept.budget, spent);
    // Line math uses the PARENT department's used_pct (contract §3).
    const deptLines = dept.lines.map(([line, lineBudget]) => {
      const lineSpent = Math.round((lineBudget * usage.used_pct) / 100);
      return { line, budget: lineBudget, spent: lineSpent, remaining: lineBudget - lineSpent };
    });
    return { name: dept.name, budget: dept.budget, ...usage, lines: deptLines };
  });

  const entities = ENT_DEFS.map((entity) => {
    const agg = entityAgg.get(entity.name);
    const entityIncome = Math.round(agg.income);
    const entityExpense = Math.round(agg.expense);
    return {
      name: entity.name,
      scope: entity.scope,
      income: entityIncome,
      expense: entityExpense,
      net: entityIncome - entityExpense,
    };
  });
  const entityTotal = entities.reduce(
    (acc, entity) => ({
      income: acc.income + entity.income,
      expense: acc.expense + entity.expense,
      net: acc.net + entity.net,
    }),
    { income: 0, expense: 0, net: 0 },
  );

  const lanes = LANES_RAW.map((lane) => {
    const def = DECISION_LANES.find((candidate) => candidate.id === (LANE_DECISION_IDS[lane.id] || lane.id));
    if (!def) return { ...lane, match_count: 0, matched_lines: [] };
    const { spent, match_count, matched_lines } = laneMatchesFrom(lines, def);
    return { ...lane, spent, match_count, matched_lines };
  });

  const overs = functions.filter((fn) => fn.status === "over");
  const tights = functions.filter((fn) => fn.status === "tight");
  const watchNames = [...overs, ...tights].map((fn) => fn.name);
  const targetNote =
    "Full-year target " + (APPROVED_TOTALS.net >= 0 ? "+" : "") + fmtCompact(APPROVED_TOTALS.net);

  const opKpis = [
    {
      eyebrow: "Operating income · YTD",
      value: fmtCompact(income),
      note: Math.round((income / APPROVED_TOTALS.income) * 100) + "% of " + fmtCompact(APPROVED_TOTALS.income) + " approved",
      tone: "neutral",
    },
    {
      eyebrow: "Operating spend · YTD",
      value: fmtCompact(expense),
      note: Math.round((expense / APPROVED_TOTALS.expense) * 100) + "% of " + fmtCompact(APPROVED_TOTALS.expense) + " approved",
      tone: "neutral",
    },
    {
      eyebrow: "Operating net · YTD",
      value: fmtCompact(totals.net),
      note: targetNote,
      tone: totals.net < 0 ? "bad" : "good",
    },
    {
      eyebrow: "Functions on watch",
      value: String(watchNames.length),
      note: watchNames.join(" · ") || "None",
      tone: watchNames.length > 0 ? "warn" : "good",
    },
  ];

  // Cumulative monthly actuals for the overview trend chart (months past the
  // latest activity stay null so the frontend can keep projecting). Stray
  // prior-period adjustment lines (the tenant carries e.g. period 12 of the
  // previous FY) must not stretch the actuals window past the extract date,
  // so only months at or before the extract month count as active.
  const extractedAt = new Date(generated_at ?? "");
  const extractMonth = Number.isNaN(extractedAt.getTime()) ? 12 : extractedAt.getUTCMonth() + 1;
  const activeMonths = lines.map((line) => line.month).filter((m) => m && m <= extractMonth);
  const asOfMonth = activeMonths.length > 0 ? Math.max(...activeMonths) : null;
  let runningIncome = 0;
  let runningExpense = 0;
  const trendMonths = [];
  for (let month = 1; month <= 12; month++) {
    runningIncome += monthly.income[month - 1];
    runningExpense += monthly.expense[month - 1];
    const active = asOfMonth !== null && month <= asOfMonth;
    trendMonths.push({
      month,
      income: active ? Math.round(runningIncome) : null,
      expense: active ? Math.round(runningExpense) : null,
    });
  }
  const trend = { as_of_month: asOfMonth, months: trendMonths };

  const monthlyOperating = [];
  const monthlyYear = Number.isNaN(extractedAt.getTime()) ? 2026 : extractedAt.getUTCFullYear();
  for (let month = 1; month <= 12; month++) {
    const inRange = monthIsInRange(monthlyYear, month, range);
    const active = inRange && asOfMonth !== null && month <= asOfMonth;
    const monthIncome = Math.round(monthly.income[month - 1]);
    const monthExpense = Math.round(monthly.expense[month - 1]);
    monthlyOperating.push({
      month,
      label: MONTH_LABELS[month - 1],
      income: active ? monthIncome : null,
      expense: active ? monthExpense : null,
      net: active ? monthIncome - monthExpense : null,
    });
  }

  // Real per-month series backing the overview KPI sparklines. KPIs with no
  // monthly dimension (board constants, data health) carry no series — the
  // frontend renders those cards without a sparkline rather than a fake one.
  const netSpark = trendMonths
    .filter((entry) => entry.income !== null)
    .map((entry) => entry.income - entry.expense);
  const oversSpark = [];
  for (let month = 1; asOfMonth !== null && month <= asOfMonth; month++) {
    let oversCount = 0;
    for (const fn of FUNCTIONS_RAW) {
      const byMonth = deptMonthlySpent.get(FUNCTION_DEPT_KEYS[fn.name]);
      if (!byMonth) continue;
      let cumulative = 0;
      for (let i = 0; i < month; i++) cumulative += byMonth[i];
      if (cumulative > fn.budget) oversCount += 1;
    }
    oversSpark.push(oversCount);
  }

  // Data-health KPI: "Live"/good only while the sync is clean; any warning
  // flips it to "Watch" with the first warning as the note (truncated to card
  // width — the full strings ride on meta.warnings).
  const healthKpi =
    warnings.length === 0
      ? { eyebrow: "Data health", value: "Live", note: "MYOB GL cache · " + String(generated_at ?? "").slice(0, 10), tone: "good" }
      : {
          eyebrow: "Data health",
          value: "Watch",
          note: warnings[0].length > 60 ? warnings[0].slice(0, 57) + "..." : warnings[0],
          tone: "warn",
        };

  const overviewKpis = [
    { ...opKpis[2], spark: netSpark },
    OVERVIEW_KPIS[1], // Approved surplus · FY26 — board constants either way
    {
      eyebrow: "Functions over budget",
      value: String(overs.length),
      note: overs.map((fn) => fn.name).join(" · ") || "None",
      tone: overs.length > 0 ? "warn" : "good",
      spark: oversSpark,
    },
    healthKpi,
  ];

  const composition = [
    { label: "Income", approved: APPROVED_TOTALS.income, spent: income, tone: "good" },
    { label: "Expense", approved: APPROVED_TOTALS.expense, spent: expense, tone: "neutral" },
  ];

  // Freshness mirrors the health KPI: staleness is the specific "Stale"/bad
  // state, any other warning downgrades to "Check"/warn.
  const freshnessEntry = {
    name: "MYOB live GL cache",
    status: stale ? "Stale" : warnings.length > 0 ? "Check" : "Current",
    tone: stale ? "bad" : warnings.length > 0 ? "warn" : "good",
  };
  const freshnessFullEntry = { ...freshnessEntry, note: "Extracted " + String(generated_at ?? "").slice(0, 10) };

  // Live alerts replace the design ALERTS constants on the overview: one bad
  // card per over-budget function, one warn per tight function, one warn per
  // data warning, and a single all-clear card when there is nothing to raise.
  const alerts = [
    ...overs.map((fn) => ({
      title: fn.name + " over budget",
      body:
        "Full-year allocation exceeded by " + fmtCompact(Math.abs(fn.remaining)) + " at " + fn.used_pct + "% used.",
      tone: "bad",
    })),
    ...tights.map((fn) => ({
      title: fn.name + " " + fn.used_pct + "% committed",
      body: fmtCompact(fn.remaining) + " of " + fmtCompact(fn.budget) + " remaining — little headroom left.",
      tone: "warn",
    })),
    // Numbered titles keep alert keys unique when several warnings surface.
    ...warnings.map((warning, index) => ({
      title: warnings.length > 1 ? "Data warning " + (index + 1) : "Data warning",
      body: warning,
      tone: "warn",
    })),
  ];
  if (alerts.length === 0) {
    alerts.push({
      title: "No alerts",
      body: "All functions at or under elapsed-year pace and the MYOB sync is healthy.",
      tone: "good",
    });
  }

  return {
    meta: { ...meta, warnings },
    generated_at,
    sourceCounts,
    totals,
    functions,
    departments,
    entities,
    entityTotal,
    lanes,
    period: periodFrom(generated_at, range),
    opKpis,
    overviewKpis,
    composition,
    observation: observationFrom(overs, tights),
    monthlyOperating,
    trend,
    alerts,
    freshnessEntry,
    freshnessFullEntry,
  };
}

// classifyAccounts/lineKind are exported so the historical derivations
// (myobHistoryService) classify stored lines with the exact same rules.
module.exports = { buildLiveModel, fmtCompact, classifyAccounts, lineKind };

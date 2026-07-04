// One-shot read-only MYOB Advanced sync run. A single login/logout session
// refreshes every cache the existing services already consume, in the exact
// shapes they load today (see myobCacheRepository/cashService/budgetService):
//   a. cash-position/myob-cash-endpoint-probe-{latest,summary}.json
//      (probe + candidates enriched with GL 111xxx net-movement balances)
//   b. live-gl/myob-live-gl-{latest,summary}.json (chart + flattened journals)
//   c. cmf-cash/myob-cmf-cash-{latest,summary}.json
//   d. <dashboards>/department-budget-myob-data.json
//   e. morpheus-broad-readonly/morpheus-broad-readonly-cache.json
//   f. morpheus-benefits-312510/morpheus-benefits-312510-cache.json
//   g. account-drilldowns/myob-account-<code>-drilldown.json (+ summary)
// The run is GET-only against MYOB; no entity is ever written back.
const path = require("path");

const config = require("../config");
const { UnavailableError } = require("../lib/errors");
const myobClient = require("../lib/myobClient");
const { flattenRecord, pickField, windowCacheFile } = require("../repositories/myobCacheRepository");
const { readJsonFile, writeJsonFile } = require("../repositories/jsonFileRepository");
const { departmentStatus } = require("./statusRules");
const approved = require("../constants/approvedBudget");
const { KEY_ACCOUNT_LABELS } = require("../constants/keyAccounts");

const PROBE_LATEST_FILE = path.join("cash-position", "myob-cash-endpoint-probe-latest.json");
const PROBE_SUMMARY_FILE = path.join("cash-position", "myob-cash-endpoint-probe-summary.json");
const LIVE_GL_LATEST_FILE = path.join("live-gl", "myob-live-gl-latest.json");
const LIVE_GL_SUMMARY_FILE = path.join("live-gl", "myob-live-gl-summary.json");
const CMF_LATEST_FILE = path.join("cmf-cash", "myob-cmf-cash-latest.json");
const CMF_SUMMARY_FILE = path.join("cmf-cash", "myob-cmf-cash-summary.json");
const STATUS_FILE = "sync-status.json";
const DEPARTMENTS_MYOB_FILE = "department-budget-myob-data.json";
const BROAD_CACHE_FILE = path.join("morpheus-broad-readonly", "morpheus-broad-readonly-cache.json");
const BENEFITS_CACHE_FILE = path.join("morpheus-benefits-312510", "morpheus-benefits-312510-cache.json");
const DRILLDOWN_SUMMARY_FILE = path.join("account-drilldowns", "key-account-drilldown-summary.json");

// Extra broad-cache entities (single modest pagedFetch each; still GET-only).
const BROAD_ENTITIES = ["Customer", "Vendor", "Bill", "Invoice", "Payment"];
const BROAD_ENTITY_MAX_ROWS = 2000;
const BROAD_JOURNAL_SAMPLE_CAP = 500;

// Benefits tracker scope: GL account 312510, employee codes in the subaccount.
const BENEFITS_ACCOUNT = "312510";
const EMPLOYEE_CODE_PATTERN = /[A-Z]{4}\d{2}/;

// GL chart prefix for cash accounts (CashAccount endpoint 404s on this
// tenant, so cash figures are journal net movements per 111xxx account).
const GL_CASH_ACCOUNT_PREFIX = "111";
const GL_CASH_MOVEMENT_WARNING =
  "myob_balance values are net movement over the extract window, not statement balances";

// Endpoints this tenant is known to answer (TrialBalance/GLBalance etc. 404,
// so balances are always derived by summing journal lines).
const PROBE_ENDPOINTS = [
  "Account",
  "JournalTransaction",
  "CashAccount",
  "Subaccount",
  "Branch",
  "FinancialPeriod",
  "Ledger",
  "Payment",
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

// Start of the current Australian financial year (previous July 1).
function defaultFromDate(now = new Date()) {
  const year = now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-07-01`;
}

// The dashboards expect MMYYYY periods; some tenants return YYYYMM — swap
// when the leading pair cannot be a month.
function periodMMYYYY(value) {
  const digits = String(value ?? "").replace(/[^0-9]/g, "");
  if (digits.length !== 6) return digits;
  return Number(digits.slice(0, 2)) > 12 ? digits.slice(4) + digits.slice(0, 4) : digits;
}

// First subaccount segment (before the dash), the department mapping key.
function subaccountPrefix(subaccount) {
  const text = String(subaccount ?? "").trim().toUpperCase();
  if (!text) return "";
  return text.split("-")[0].trim().slice(0, 3);
}

// expense | income | other, from the chart Type with AccountClass fallback.
function accountKind(account) {
  const type = String(pickField(account, "Type")).toLowerCase();
  if (type === "expense") return "expense";
  if (type === "income") return "income";
  const accountClass = String(pickField(account, "AccountClass")).toUpperCase();
  if (accountClass.includes("EXPENSE")) return "expense";
  if (accountClass.includes("INCOME") || accountClass.includes("REVENUE")) return "income";
  return "other";
}

// ---------------------------------------------------------------------------
// Pure builders (exported for tests — no network involved)
// ---------------------------------------------------------------------------

// Flatten JournalTransaction header + Details rows ({value} wrappers and
// field-name variants included) into the live-gl line shape myobService
// filters/aggregates.
function flattenJournalLines(journals, accountDescriptions = {}) {
  const lines = [];
  for (const raw of journals) {
    const journal = flattenRecord(raw);
    for (const line of journal.Details || []) {
      const debit = round2(toNumber(pickField(line, "DebitAmount", "DebitAmt")));
      const credit = round2(toNumber(pickField(line, "CreditAmount", "CreditAmt")));
      const account = String(pickField(line, "Account", "AccountID"));
      lines.push({
        kind: "JournalTransaction",
        date: dateOnly(pickField(journal, "TransactionDate")),
        period: periodMMYYYY(pickField(line, "PostPeriod") || pickField(journal, "PostPeriod", "FinancialPeriod")),
        branch: String(pickField(line, "BranchID", "Branch") || pickField(journal, "BranchID", "Branch")),
        module: String(pickField(journal, "Module") || "GL"),
        batch: String(pickField(journal, "BatchNbr")),
        reference: String(pickField(journal, "RefNbr", "BatchNbr")),
        account,
        account_description: String(accountDescriptions[account] ?? pickField(line, "AccountDescription")),
        subaccount: String(pickField(line, "Subaccount", "SubaccountCD")),
        project: String(pickField(line, "Project", "ProjectID")),
        vendor_customer: String(pickField(line, "VendorOrCustomer", "CustomerVendor")),
        header_description: String(pickField(journal, "Description", "Descr")),
        line_description: String(pickField(line, "TransactionDescription", "Description", "Descr")),
        debit,
        credit,
        net_debit: round2(debit - credit),
        source_endpoint: "JournalTransaction",
      });
    }
  }
  return lines;
}

// CMF cash extract in cashService's shape: balances are NET MOVEMENTS over
// the window (summed journal lines), never statement balances.
function buildCmfDocument(journalLines, { targetAccounts, accounts, generatedAt, fromDate, toDate, journalsScanned }) {
  const targets = targetAccounts.map(String);
  const lines = journalLines
    .filter((line) => targets.includes(String(line.account)))
    .map((line) => ({
      date: line.date,
      period: line.period,
      batch: line.batch,
      reference: line.reference,
      account: line.account,
      subaccount: line.subaccount,
      debit: line.debit,
      credit: line.credit,
      net_debit: line.net_debit,
      line_description: line.line_description,
      header_description: line.header_description,
    }));

  const balancesByAccount = Object.fromEntries(targets.map((account) => [account, 0]));
  const bySubaccount = new Map();
  for (const line of lines) {
    balancesByAccount[line.account] = round2((balancesByAccount[line.account] || 0) + line.net_debit);
    const key = `${line.account}|${line.subaccount}`;
    const entry = bySubaccount.get(key) || { account: line.account, subaccount: line.subaccount, net_debit: 0 };
    entry.net_debit = round2(entry.net_debit + line.net_debit);
    bySubaccount.set(key, entry);
  }

  return {
    generated_at: generatedAt,
    source: "MYOB Advanced read-only GET JournalTransaction/Account for CMF cash (CFO Dashboard sync)",
    from_date: fromDate,
    to_date: toDate,
    base_endpoint_family: config.myob.endpointFamily,
    target_accounts: targets,
    journals_scanned: journalsScanned,
    line_count: lines.length,
    accounts: accounts.filter((account) => targets.includes(String(pickField(account, "AccountCD")))),
    balances_by_account: balancesByAccount,
    balances_by_account_subaccount: [...bySubaccount.values()].sort(
      (a, b) => a.account.localeCompare(b.account) || a.subaccount.localeCompare(b.subaccount)
    ),
    lines,
  };
}

// Per-line transaction evidence cap and excluded-account list cap in the
// department report (parity with build_department_budget_myob_report.py).
const DEPT_LINE_EVIDENCE_CAP = 8;
const EXCLUDED_ACCOUNT_TOTALS_CAP = 30;

// Department budget report consumed by budgetService.resolveDepartmentsPayload
// when period_context.source_kind === "myob_live_gl_cache": approved budgets
// come from THIS project's constants; actuals are GL journal expense/income
// lines grouped by the first subaccount segment via PREFIX_TO_DEPT. Sync-run
// errors ride period_context so consumers can tell a clean extract from a
// degraded one without reading sync-status.json.
function buildDepartmentReport(journalLines, accounts, { generatedAt, fromDate, toDate, errors = [] }) {
  const chart = {};
  for (const account of accounts) {
    const code = String(pickField(account, "AccountCD"));
    if (code) chart[code] = account;
  }

  const departments = new Map();
  const ensureDepartment = (name) => {
    if (!departments.has(name)) {
      departments.set(name, {
        name,
        budget: approved.APPROVED_DEPARTMENT_BUDGETS[name] ?? 0,
        spent: 0,
        income_budget: 0,
        income_actual: 0,
        lines: new Map(),
      });
    }
    return departments.get(name);
  };
  for (const name of Object.keys(approved.APPROVED_DEPARTMENT_BUDGETS)) ensureDepartment(name);

  const unmappedPrefixTotals = {};
  const excludedAccountTotals = {};
  let totalIncome = 0;
  let totalExpense = 0;

  // The tenant carries post-dated journals (accruals/recurring batches entered
  // ahead); they stay in the GL cache but must not inflate YTD actuals.
  const asOfDate = dateOnly(generatedAt);
  let futureExcludedTotal = 0;
  let futureExcludedCount = 0;

  for (const line of journalLines) {
    if (line.date && dateOnly(line.date) > asOfDate) {
      futureExcludedTotal = round2(futureExcludedTotal + toNumber(line.net_debit));
      futureExcludedCount += 1;
      continue;
    }
    const kind = accountKind(chart[String(line.account)] || {});
    if (kind === "other") {
      // Keyed "code description" so the excluded list reads without a chart join.
      const code = String(line.account);
      const key = `${code} ${String(pickField(chart[code] || {}, "Description"))}`.trim() || "(none)";
      excludedAccountTotals[key] = round2((excludedAccountTotals[key] || 0) + toNumber(line.net_debit));
      continue;
    }

    const prefix = subaccountPrefix(line.subaccount);
    const departmentName = approved.PREFIX_TO_DEPT[prefix];
    if (kind === "income") {
      const netCredit = toNumber(line.credit) - toNumber(line.debit);
      totalIncome += netCredit;
      if (departmentName) ensureDepartment(departmentName).income_actual += netCredit;
      continue;
    }

    // expense — the accounting actual source for department spend
    const netDebit = toNumber(line.net_debit);
    totalExpense += netDebit;
    if (!departmentName) {
      const key = prefix || "(none)";
      unmappedPrefixTotals[key] = round2((unmappedPrefixTotals[key] || 0) + netDebit);
      continue;
    }
    const department = ensureDepartment(departmentName);
    department.spent += netDebit;
    const lineKey = String(line.account);
    const entry = department.lines.get(lineKey) || {
      line: `${line.account} ${line.account_description || ""}`.trim(),
      account: lineKey,
      budget: 0,
      spent: 0,
      remaining: null,
      line_count: 0,
      evidence: [],
    };
    entry.spent = round2(entry.spent + netDebit);
    entry.line_count += 1;
    if (entry.evidence.length < DEPT_LINE_EVIDENCE_CAP) {
      entry.evidence.push({
        date: line.date,
        period: line.period,
        reference: line.reference,
        batch: line.batch,
        subaccount: line.subaccount,
        description: line.line_description || line.header_description,
        net_debit: toNumber(line.net_debit),
      });
    }
    department.lines.set(lineKey, entry);
  }

  const departmentRows = [...departments.values()]
    .map((department) => {
      const spent = round2(department.spent);
      const remaining = round2(department.budget - spent);
      const usedPct = department.budget > 0 ? round2((spent / department.budget) * 100) : null;
      // Actual lines carry budget 0 / remaining -spent (MYOB budgets are not
      // split per line); zero-actual departments fall back to the approved
      // budget line list so the drilldown always has content.
      let lineRows = [...department.lines.values()]
        .map((entry) => ({ ...entry, remaining: round2(0 - entry.spent) }))
        .sort((a, b) => b.spent - a.spent);
      if (lineRows.length === 0 && approved.APPROVED_DEPARTMENT_LINES[department.name]) {
        lineRows = approved.APPROVED_DEPARTMENT_LINES[department.name].map(([lineName, lineBudget]) => ({
          line: lineName,
          account: null,
          budget: lineBudget,
          spent: 0,
          remaining: lineBudget,
          line_count: 0,
        }));
      }
      return {
        name: department.name,
        budget: department.budget,
        spent,
        remaining,
        used_pct: usedPct,
        status: departmentStatus(remaining, usedPct),
        income_budget: department.income_budget,
        income_actual: round2(department.income_actual),
        lines: lineRows,
      };
    })
    .sort((a, b) => b.budget - a.budget);

  // Unmapped expense prefixes surface as their own row so the department list
  // reconciles to summary.spend instead of silently dropping spend.
  if (Object.keys(unmappedPrefixTotals).length > 0) {
    const unmappedSpent = round2(Object.values(unmappedPrefixTotals).reduce((sum, value) => sum + value, 0));
    departmentRows.push({
      name: "UNMAPPED",
      budget: 0,
      spent: unmappedSpent,
      remaining: round2(0 - unmappedSpent),
      used_pct: null,
      status: departmentStatus(round2(0 - unmappedSpent), null),
      income_budget: 0,
      income_actual: 0,
      lines: Object.entries(unmappedPrefixTotals)
        .map(([prefix, prefixSpent]) => ({
          line: `Unmapped prefix ${prefix}`,
          account: prefix,
          budget: 0,
          spent: prefixSpent,
          remaining: round2(0 - prefixSpent),
          line_count: null,
        }))
        .sort((a, b) => b.spent - a.spent),
    });
  }

  // Labels and period bounds reflect the as-of cutoff, not any post-dated
  // journal that happens to be in the extract.
  const toMonth = dateOnly(toDate) < asOfDate ? dateOnly(toDate) : asOfDate;
  const monthIndex = Number(toMonth.slice(5, 7)) - 1;
  const actualPeriodLabel =
    monthIndex >= 0 && monthIndex < 12
      ? `${MONTH_NAMES[monthIndex]} ${toMonth.slice(0, 4)} actuals to date (MYOB live GL cache)`
      : "MYOB live GL cache actuals";

  return {
    generated_at: generatedAt,
    source: "MYOB Advanced live GL cache (read-only journal extract) + approved FY2026 budget constants",
    source_modified: generatedAt,
    period_context: {
      source_kind: "myob_live_gl_cache",
      source_errors: errors,
      confidence: errors.length ? "degraded" : "high",
      budget_year: "2026",
      budget_period_label: approved.APPROVED_BUDGET_BASIS,
      actual_period_label: actualPeriodLabel,
      summary_period_label: actualPeriodLabel,
      as_of_date: toMonth,
      from_date: fromDate,
      to_date: toMonth,
      budget_source_modified: null,
      actual_source_modified: generatedAt,
      summary_source_modified: null,
      period_note:
        `Journal actuals ${fromDate} to ${toMonth} from the MYOB live GL cache, mapped to departments by ` +
        "subaccount prefix. Approved budgets are the FY2026 board constants. " +
        "Post-dated journals beyond the extract date are excluded from actuals.",
    },
    departments: departmentRows,
    summary: {
      income: round2(totalIncome),
      spend: round2(totalExpense),
      net: round2(totalIncome - totalExpense),
      cash: [],
    },
    mapping: {
      subaccount_prefix_to_department: approved.PREFIX_TO_DEPT,
      unmapped_prefix_totals: unmappedPrefixTotals,
      // Largest excluded movements first, capped so the report stays readable.
      excluded_non_expense_account_totals: Object.fromEntries(
        Object.entries(excludedAccountTotals)
          .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
          .slice(0, EXCLUDED_ACCOUNT_TOTALS_CAP)
      ),
      future_dated_excluded: { as_of: asOfDate, lines: futureExcludedCount, net_debit: futureExcludedTotal },
      notes: approved.MAPPING_NOTES,
    },
  };
}

// Broad read-only cache consumed by myobService (listAccounts/listEntityRows/
// getBroadSummary/...). Rows stay RAW — {value} wrappers exactly as MYOB
// returned them — because the repository flattens at read time. The journal
// sample key is named after the actual extract window start; the repository
// loader renames it to myobService's canonical key on read.
function buildBroadCache({ generatedAt, fromDate, entityRecords, rawJournals, journalSampleCap = BROAD_JOURNAL_SAMPLE_CAP }) {
  const sampleKey = `JournalTransaction_since_${String(fromDate).replace(/-/g, "_")}_sample`;
  const sample = (rawJournals || []).slice(0, journalSampleCap);
  return {
    generated_at: generatedAt,
    source: "MYOB Advanced broad read-only cache (CFO Dashboard sync, GET-only)",
    base_endpoint_family: config.myob.endpointFamily,
    endpoints: {
      ...entityRecords,
      [sampleKey]: { ok: true, status: 200, count: sample.length, rows: sample },
    },
  };
}

// Keyword classifier for benefits ledger categories. Deliberately simple:
// unknown descriptions fall through to "Uncategorised" (no LLM categorizer).
const BENEFITS_CATEGORY_RULES = [
  { pattern: /book/i, category: "Book allowance" },
  { pattern: /travel|mileage|\bkms?\b/i, category: "Travel" },
  { pattern: /conference|meeting|camp/i, category: "Conference & meetings" },
  { pattern: /health|medical|gym|wellbeing/i, category: "Health & wellbeing" },
  { pattern: /adjust|correction|reversal|transfer/i, category: "Adjustment" },
];

function classifyBenefitsCategory(text) {
  for (const rule of BENEFITS_CATEGORY_RULES) {
    if (rule.pattern.test(String(text || ""))) return rule.category;
  }
  return "Uncategorised";
}

// Benefits cache (account 312510) in the myob-benefits fixture shape. Built
// from the run's flattened journal lines — the ok/url/status/elapsed_ms
// wrappers are legacy middleware artifacts filled with constants. Sign
// conventions per the fixture: account balance = credit - debit (liability
// style); employee balance = debit - credit (spend style). Derived sums
// respect the as-of cutoff (post-dated lines excluded); the raw transaction
// and ledger lists stay complete.
function buildBenefitsCache(journalLines, { generatedAt, fromDate, baseUrl, account = BENEFITS_ACCOUNT }) {
  const asOf = dateOnly(generatedAt);
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const url = `${baseUrl || "myob"}/JournalTransaction`;

  const rows = journalLines
    .filter((line) => String(line.account) === String(account))
    .map((line) => {
      const description = String(line.line_description || line.header_description || "");
      const match = EMPLOYEE_CODE_PATTERN.exec(String(line.subaccount || "").toUpperCase());
      return {
        date: dateOnly(line.date),
        employee_code: match ? match[0] : "",
        employee_name: String(line.vendor_customer || "").trim(),
        category: classifyBenefitsCategory(description),
        journal_description: description,
        debit: round2(toNumber(line.debit)),
        credit: round2(toNumber(line.credit)),
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  const current = rows.filter((row) => row.date && row.date <= asOf);

  let totalDebit = 0;
  let totalCredit = 0;
  let ytdDebit = 0;
  let ytdCredit = 0;
  const categoryRollup = {};
  const employeeCodes = new Set();
  for (const row of current) {
    totalDebit = round2(totalDebit + row.debit);
    totalCredit = round2(totalCredit + row.credit);
    if (row.date >= yearStart) {
      ytdDebit = round2(ytdDebit + row.debit);
      ytdCredit = round2(ytdCredit + row.credit);
    }
    if (row.employee_code) employeeCodes.add(row.employee_code);
    const rollup = categoryRollup[row.category] || { count: 0, debit: 0, credit: 0 };
    rollup.count += 1;
    rollup.debit = round2(rollup.debit + row.debit);
    rollup.credit = round2(rollup.credit + row.credit);
    categoryRollup[row.category] = rollup;
  }

  const employees = {};
  for (const code of [...new Set(rows.filter((row) => row.employee_code).map((row) => row.employee_code))].sort()) {
    const employeeRows = rows.filter((row) => row.employee_code === code);
    const employeeCurrent = employeeRows.filter((row) => row.date && row.date <= asOf);
    const name = employeeRows.map((row) => row.employee_name).find((value) => value) || code;
    let debit = 0;
    let credit = 0;
    let employeeYtdDebit = 0;
    let employeeYtdCredit = 0;
    for (const row of employeeCurrent) {
      debit = round2(debit + row.debit);
      credit = round2(credit + row.credit);
      if (row.date >= yearStart) {
        employeeYtdDebit = round2(employeeYtdDebit + row.debit);
        employeeYtdCredit = round2(employeeYtdCredit + row.credit);
      }
    }
    employees[code] = {
      identity: { code, name },
      summary: {
        ok: true,
        status: 200,
        data: {
          employee: { code, name, role_or_church: "" },
          totals: {
            balance: round2(debit - credit),
            ytd_debit: employeeYtdDebit,
            ytd_credit: employeeYtdCredit,
            transaction_count: employeeCurrent.length,
          },
        },
      },
      profile: { ok: true, status: 200, data: { code, name } },
      ledger: {
        ok: true,
        status: 200,
        data: {
          entries: employeeRows.map((row) => ({
            date: row.date,
            category: row.category,
            debit: row.debit,
            credit: row.credit,
          })),
        },
      },
    };
  }

  const transactions = rows.map((row) => ({
    date: row.date,
    employee_code: row.employee_code,
    category: row.category,
    journal_description: row.journal_description,
    debit: row.debit,
    credit: row.credit,
  }));

  return {
    generated_at: generatedAt,
    base_url: baseUrl || "myob",
    scope: `Benefits Tracker for MYOB Advanced account ${account} (CFO Dashboard sync, derived from GL journal lines since ${fromDate})`,
    read_only_policy: "GET-only",
    endpoints: {
      summary_full: {
        ok: true,
        url,
        status: 200,
        elapsed_ms: 0,
        data: {
          account: {
            balance: round2(totalCredit - totalDebit),
            total_credit: totalCredit,
            total_debit: totalDebit,
            ytd_credit: ytdCredit,
            ytd_debit: ytdDebit,
            transaction_count: current.length,
            as_of: asOf,
          },
        },
      },
      recent_transactions: { ok: true, url, status: 200, elapsed_ms: 0, data: { transactions } },
    },
    employees,
    derived: {
      account_balance: round2(totalCredit - totalDebit),
      account_total_credit: totalCredit,
      account_total_debit: totalDebit,
      account_ytd_credit: ytdCredit,
      account_ytd_debit: ytdDebit,
      account_transaction_count: current.length,
      account_as_of: asOf,
      eligible_employee_count: Object.keys(employees).length,
      employee_detail_count: Object.keys(employees).length,
      recent_transaction_count: current.length,
      recent_transaction_total_debit: totalDebit,
      recent_transaction_total_credit: totalCredit,
      recent_transaction_employee_codes: [...employeeCodes].sort(),
      recent_transaction_category_rollup: categoryRollup,
      failed_endpoints: {},
    },
  };
}

// Per-account drilldown in the myob-drilldowns fixture shape, filtered from
// the run's raw journals (already $expand=Details). No Bill Details are
// fetched, so bill_lines is always empty with limits.bill_limit = 0.
function buildAccountDrilldown(rawJournals, { account, generatedAt, fromDate, journalLimit }) {
  const code = String(account);
  const journalLines = [];
  let debitTotal = 0;
  let creditTotal = 0;
  for (const raw of rawJournals) {
    const journal = flattenRecord(raw);
    for (const line of journal.Details || []) {
      if (String(pickField(line, "Account", "AccountID")) !== code) continue;
      const debit = round2(toNumber(pickField(line, "DebitAmount", "DebitAmt")));
      const credit = round2(toNumber(pickField(line, "CreditAmount", "CreditAmt")));
      debitTotal = round2(debitTotal + debit);
      creditTotal = round2(creditTotal + credit);
      journalLines.push({
        journal: {
          TransactionDate: String(pickField(journal, "TransactionDate")),
          BatchNbr: String(pickField(journal, "BatchNbr")),
          BranchID: String(pickField(journal, "BranchID", "Branch")),
          Description: String(pickField(journal, "Description", "Descr")),
        },
        line: {
          Account: code,
          DebitAmount: debit,
          CreditAmount: credit,
          Subaccount: String(pickField(line, "Subaccount", "SubaccountCD")),
          Project: String(pickField(line, "Project", "ProjectID")),
          TransactionDescription: String(pickField(line, "TransactionDescription", "Description", "Descr")),
        },
      });
    }
  }
  return {
    generated_at: generatedAt,
    account: code,
    from_date: fromDate,
    source: "MYOB Advanced read-only GET JournalTransaction drilldown (CFO Dashboard sync)",
    limits: { bill_limit: 0, journal_limit: journalLimit },
    bill_lines: [],
    journal_lines: journalLines,
    errors: [],
    journals_scanned: rawJournals.length,
    derived: {
      bill_line_count: 0,
      bill_line_total: 0,
      journal_line_count: journalLines.length,
      journal_debit_total: debitTotal,
      journal_credit_total: creditTotal,
      journal_net_debit: round2(debitTotal - creditTotal),
    },
  };
}

// One drilldown per key account plus the summary index myobService's
// listDrilldowns consumes (summary.data.accounts items carry
// account/label/derived/generated_at/errors — see drilldownIndexItem).
function buildKeyAccountDrilldowns(rawJournals, { generatedAt, fromDate, journalLimit, labels = KEY_ACCOUNT_LABELS }) {
  const accounts = {};
  const summaryItems = [];
  for (const code of Object.keys(labels)) {
    const doc = buildAccountDrilldown(rawJournals, { account: code, generatedAt, fromDate, journalLimit });
    accounts[code] = doc;
    summaryItems.push({
      account: code,
      label: labels[code],
      output: `account-drilldowns/myob-account-${code}-drilldown.json`,
      generated_at: generatedAt,
      derived: doc.derived,
      errors: doc.errors,
    });
  }
  return { accounts, summary: { generated_at: generatedAt, accounts: summaryItems } };
}

// GL cash figures for the Westpac/CMF reconciliation page. CashAccount 404s
// on this tenant, so these are journal NET MOVEMENTS per 111xxx account since
// from_date — never statement balances (warning carried on the document and
// every enriched candidate). Post-dated lines beyond the as-of date are
// excluded, mirroring the department report cutoff.
function buildGlCashMovements(journalLines, { generatedAt, fromDate, toDate, accountDescriptions = {} }) {
  const asOf = dateOnly(generatedAt);
  const byAccount = new Map();
  let futureLines = 0;
  let futureNet = 0;
  for (const line of journalLines) {
    const account = String(line.account || "");
    if (!account.startsWith(GL_CASH_ACCOUNT_PREFIX)) continue;
    if (line.date && dateOnly(line.date) > asOf) {
      futureLines += 1;
      futureNet = round2(futureNet + toNumber(line.net_debit));
      continue;
    }
    const entry = byAccount.get(account) || {
      account,
      description: String(accountDescriptions[account] ?? ""),
      line_count: 0,
      debit: 0,
      credit: 0,
      net_movement: 0,
    };
    entry.line_count += 1;
    entry.debit = round2(entry.debit + toNumber(line.debit));
    entry.credit = round2(entry.credit + toNumber(line.credit));
    entry.net_movement = round2(entry.net_movement + toNumber(line.net_debit));
    byAccount.set(account, entry);
  }
  const myobSource = `JournalTransaction net movement ${fromDate}..${toDate}`;
  return {
    basis: "net_movement_since_from_date",
    warning: GL_CASH_MOVEMENT_WARNING,
    from_date: fromDate,
    to_date: toDate,
    as_of: asOf,
    future_dated_excluded: { lines: futureLines, net_debit: futureNet },
    accounts: [...byAccount.values()]
      .sort((a, b) => a.account.localeCompare(b.account))
      .map((entry) => ({ ...entry, myob_source: myobSource })),
  };
}

// Candidates enriched with the GL movement figures: existing candidate rows
// gain myob_source/myob_balance when their account code is a 111xxx GL cash
// account, and movement-only accounts are appended as JournalTransaction
// candidates so every cash target has something to map to.
function enrichCashCandidates(candidates, glCashMovements) {
  const movements = new Map(glCashMovements.accounts.map((row) => [row.account, row]));
  const seen = new Set();
  const enriched = candidates.map((row) => {
    const code = String(pickField(row, "CashAccountCD", "AccountCD", "AccountID"));
    const movement = movements.get(code);
    if (!movement) return row;
    seen.add(code);
    return {
      ...row,
      myob_source: movement.myob_source,
      myob_balance: movement.net_movement,
      myob_balance_basis: glCashMovements.warning,
    };
  });
  for (const movement of glCashMovements.accounts) {
    if (seen.has(movement.account)) continue;
    enriched.push({
      _endpoint: "JournalTransaction",
      AccountCD: movement.account,
      Description: movement.description,
      myob_source: movement.myob_source,
      myob_balance: movement.net_movement,
      myob_balance_basis: glCashMovements.warning,
    });
  }
  return enriched;
}

// ---------------------------------------------------------------------------
// Sync run (network — one login/logout bracket, GET only)
// ---------------------------------------------------------------------------

function probeRecord(result) {
  if (!result.ok) {
    const body = typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? "");
    return { status: result.status, body: body.slice(0, 300) };
  }
  const sample = result.rows.map(flattenRecord);
  return { status: result.status, kind: "list", count_sample: sample.length, sample };
}

async function executeRun(session, run) {
  const generatedAt = nowIso();
  // An explicit request window (from the sync trigger) overrides the env
  // default and the FY-start fallback; a requested to-date additionally bounds
  // the journal fetch (an open-ended pull leaves it unset, as before).
  const fromDate = run.from_date || config.myob.syncFromDate || defaultFromDate();
  const requestedToDate = run.to_date || null;
  const errors = [];
  const counts = {};

  // a. endpoint probe ($top=5 per endpoint) — status map for the cash page.
  const endpoints = {};
  for (const name of PROBE_ENDPOINTS) {
    try {
      endpoints[name] = probeRecord(await myobClient.getEntity(session, name, { params: { $top: 5 } }));
    } catch (error) {
      endpoints[name] = { status: 0, body: String(error.message).slice(0, 300) };
    }
  }
  counts.probe_endpoints_ok = Object.values(endpoints).filter((record) => record.status === 200).length;

  // b. full chart of accounts (used by the GL cache, CMF join, and dept map).
  // Raw rows are kept for the broad cache (its consumers flatten on read).
  let accountsRaw = [];
  let accountsOk = false;
  try {
    accountsRaw = await myobClient.pagedFetch(session, "Account", { top: 500 });
    accountsOk = true;
  } catch (error) {
    errors.push(`Account: ${error.message}`);
  }
  const accounts = accountsRaw.map(flattenRecord);
  counts.accounts = accounts.length;
  const accountDescriptions = {};
  for (const account of accounts) {
    const code = String(pickField(account, "AccountCD"));
    if (code) accountDescriptions[code] = String(pickField(account, "Description"));
  }

  // a (cont). cash account candidates: full CashAccount list + chart accounts
  // flagged CashAccount=true, coalesced with the _endpoint marker cashService
  // expects.
  const candidates = [];
  if (endpoints.CashAccount && endpoints.CashAccount.status === 200) {
    try {
      const cashAccounts = (await myobClient.pagedFetch(session, "CashAccount", { top: 500 })).map(flattenRecord);
      candidates.push(...cashAccounts.map((row) => ({ _endpoint: "CashAccount", ...row })));
    } catch (error) {
      errors.push(`CashAccount: ${error.message}`);
    }
  }
  candidates.push(
    ...accounts
      .filter((account) => account.CashAccount === true)
      .map((row) => ({ _endpoint: "Account", ...row }))
  );
  // (probe docs are written after the journal pull so the candidates can be
  // enriched with GL cash net movements — see below.)

  // c. paged JournalTransaction pull with Details from the FY window start.
  // A THROWING fetch (not an empty result — a quiet ledger is legitimate)
  // flags the run so every journal-derived cache write below is skipped and
  // the previous good docs survive a transient MYOB outage.
  let journals = [];
  let journalFetchFailed = false;
  try {
    journals = await myobClient.pagedFetch(session, "JournalTransaction", {
      expand: "Details",
      filter:
        `TransactionDate ge datetimeoffset'${fromDate}'` +
        (requestedToDate ? ` and TransactionDate le datetimeoffset'${requestedToDate}'` : ""),
      top: 500,
      maxRows: config.myob.journalLimit,
    });
  } catch (error) {
    journalFetchFailed = true;
    errors.push(`JournalTransaction: ${error.message}`);
  }
  const journalLines = flattenJournalLines(journals, accountDescriptions);
  counts.journals_scanned = journals.length;
  counts.journal_lines = journalLines.length;

  let earliest = null;
  let latest = null;
  for (const line of journalLines) {
    if (!line.date) continue;
    if (earliest === null || line.date < earliest) earliest = line.date;
    if (latest === null || line.date > latest) latest = line.date;
  }
  // Label/summary window end: the requested bound when one was given, else the
  // latest journal date actually seen (an open-ended pull never overstates).
  const toDate = requestedToDate || latest || dateOnly(generatedAt);
  const isWindowRun = Boolean(run.from_date || run.to_date);

  // a (cont). GL cash net movements per 111xxx account (CashAccount is 404 on
  // this tenant) enrich the candidates, then the probe docs are written.
  const glCashMovements = buildGlCashMovements(journalLines, {
    generatedAt,
    fromDate,
    toDate,
    accountDescriptions,
  });
  const enrichedCandidates = enrichCashCandidates(candidates, glCashMovements);
  counts.cash_account_candidates = enrichedCandidates.length;
  counts.gl_cash_accounts = glCashMovements.accounts.length;

  const probeDoc = {
    generated_at: generatedAt,
    base: session.base,
    endpoints,
    cash_account_candidates: enrichedCandidates,
    gl_cash_movements: glCashMovements,
  };
  if (!isWindowRun) {
    writeJsonFile(config.resolve("myobCache", PROBE_LATEST_FILE), probeDoc);
    writeJsonFile(config.resolve("myobCache", PROBE_SUMMARY_FILE), {
      generated_at: generatedAt,
      base: session.base,
      ok_endpoints: Object.entries(endpoints)
        .filter(([, record]) => record.status === 200)
        .map(([name]) => name),
      cash_account_candidate_count: enrichedCandidates.length,
      gl_cash_movement_accounts: glCashMovements.accounts.length,
      gl_cash_movement_warning: glCashMovements.warning,
    });
  }

  if (journalFetchFailed) {
    // Every cache below through the drilldowns is derived from this run's
    // journals; writing them now would replace real actuals with empty "live"
    // docs (the command-centre live model and department report would serve
    // zeros as real). The previous run's files stay untouched.
    errors.push("JournalTransaction fetch failed; journal-derived caches left untouched");
    counts.skipped_writes = ["live-gl", "cmf-cash", "departments", "benefits", "account-drilldowns"];
    if (isWindowRun) {
      counts.skipped_writes = [
        "cash-position",
        "window-live-gl",
        "shared-live-gl",
        "cmf-cash",
        "departments",
        "broad",
        "benefits",
        "account-drilldowns",
      ];
      run.counts = counts;
      run.errors = errors;
      run.ok = false;
      return;
    }
  } else {
    const liveGlDoc = {
      generated_at: generatedAt,
      source: "MYOB Advanced live GL extract (read-only GET Account/JournalTransaction, CFO Dashboard sync)",
      from_date: fromDate,
      to_date: toDate,
      limits: { journal_limit: config.myob.journalLimit, bill_limit: 0, include_bills: false },
      base_endpoint_family: config.myob.endpointFamily,
      endpoint_status: {
        Account: { status: endpoints.Account ? endpoints.Account.status : null, count: accounts.length },
        JournalTransaction: {
          status: endpoints.JournalTransaction ? endpoints.JournalTransaction.status : null,
          journals_scanned: journals.length,
          journal_lines: journalLines.length,
          earliest_date: earliest,
          latest_date: latest,
        },
      },
      accounts,
      journal_lines: journalLines,
      bill_lines: [],
      errors,
    };
    if (isWindowRun) {
      const file = windowCacheFile(fromDate, toDate);
      if (!file) {
        errors.push("window cache: from_date and to_date are required for an isolated range cache");
      } else {
        writeJsonFile(config.resolve("myobCache", file), liveGlDoc);
        counts.window_cache = file;
      }
      counts.skipped_writes = [
        "cash-position",
        "shared-live-gl",
        "cmf-cash",
        "departments",
        "broad",
        "benefits",
        "account-drilldowns",
      ];
      run.counts = counts;
      run.errors = errors;
      run.ok = errors.length === 0;
      return;
    }
    writeJsonFile(config.resolve("myobCache", LIVE_GL_LATEST_FILE), liveGlDoc);
    writeJsonFile(config.resolve("myobCache", LIVE_GL_SUMMARY_FILE), {
      generated_at: generatedAt,
      source: liveGlDoc.source,
      from_date: fromDate,
      to_date: toDate,
      limits: liveGlDoc.limits,
      base_endpoint_family: liveGlDoc.base_endpoint_family,
      endpoint_status: liveGlDoc.endpoint_status,
      line_counts: { accounts: accounts.length, journal_lines: journalLines.length, bill_lines: 0 },
      errors,
    });

    // d. CMF cash extract (net movements on the target accounts).
    const cmfDoc = buildCmfDocument(journalLines, {
      targetAccounts: config.myob.cmfTargetAccounts,
      accounts,
      generatedAt,
      fromDate,
      toDate,
      journalsScanned: journals.length,
    });
    writeJsonFile(config.resolve("myobCache", CMF_LATEST_FILE), cmfDoc);
    const { lines, ...cmfSummary } = cmfDoc;
    writeJsonFile(config.resolve("myobCache", CMF_SUMMARY_FILE), cmfSummary);
    counts.cmf_lines = cmfDoc.line_count;

    // e. department budget report (needs the dashboards dir). Only failures
    // in the report's own inputs (chart accounts + journals) degrade its
    // confidence; unrelated pulls (e.g. CashAccount) stay on sync-status.
    const departmentsPath = config.resolve("dashboards", DEPARTMENTS_MYOB_FILE);
    if (departmentsPath) {
      const departmentErrors = errors.filter((message) => /^(Account|JournalTransaction):/.test(message));
      const departmentsDoc = buildDepartmentReport(journalLines, accounts, { generatedAt, fromDate, toDate, errors: departmentErrors });
      writeJsonFile(departmentsPath, departmentsDoc);
      counts.departments = departmentsDoc.departments.length;
    } else {
      errors.push("departments: DASHBOARDS_DIR (or CFO_DATA_DIR) is not set; department report skipped");
    }
  }

  // f. broad read-only cache: modest extra entity pulls plus a journal sample
  // reused from the run's journals (never re-fetched). Entity failures are
  // recorded on the endpoint record (ok:false + status) rather than failing
  // the run — some entities legitimately 404 on this tenant.
  const entityRecords = {
    Account: accountsOk
      ? { ok: true, status: 200, count: accountsRaw.length, rows: accountsRaw }
      : { ok: false, status: 0, count: 0, rows: [] },
  };
  for (const name of BROAD_ENTITIES) {
    try {
      const rows = await myobClient.pagedFetch(session, name, { top: 500, maxRows: BROAD_ENTITY_MAX_ROWS });
      entityRecords[name] = { ok: true, status: 200, count: rows.length, rows };
    } catch (error) {
      entityRecords[name] = {
        ok: false,
        status: error.status ?? 0,
        count: 0,
        rows: [],
        error: String(error.message).slice(0, 300),
      };
    }
  }
  const broadDoc = buildBroadCache({ generatedAt, fromDate, entityRecords, rawJournals: journals });
  if (journalFetchFailed) {
    // The entity pulls above are fresh, but this run has no journals — keep
    // the previous cache's journal sample instead of overwriting it with an
    // empty one (the journal-derived-caches-left-untouched promise above).
    const previousBroad = readJsonFile(config.resolve("myobCache", BROAD_CACHE_FILE));
    const previousKey =
      previousBroad && previousBroad.endpoints
        ? Object.keys(previousBroad.endpoints).find((key) => key.startsWith("JournalTransaction"))
        : null;
    if (previousKey) {
      const emptyKey = Object.keys(broadDoc.endpoints).find((key) => key.startsWith("JournalTransaction"));
      if (emptyKey) delete broadDoc.endpoints[emptyKey];
      broadDoc.endpoints[previousKey] = previousBroad.endpoints[previousKey];
    }
  }
  writeJsonFile(config.resolve("myobCache", BROAD_CACHE_FILE), broadDoc);
  counts.broad_endpoints = Object.keys(broadDoc.endpoints).length;
  counts.broad_endpoints_ok = Object.values(broadDoc.endpoints).filter((record) => record.ok).length;

  if (!journalFetchFailed) {
    // g. benefits cache (account 312510) from the run's journal lines.
    const benefitsDoc = buildBenefitsCache(journalLines, { generatedAt, fromDate, baseUrl: session.base });
    writeJsonFile(config.resolve("myobCache", BENEFITS_CACHE_FILE), benefitsDoc);
    counts.benefits_employees = benefitsDoc.derived.eligible_employee_count;
    counts.benefits_transactions = benefitsDoc.derived.recent_transaction_count;

    // h. key-account drilldowns (one file per account + the summary index).
    const drilldowns = buildKeyAccountDrilldowns(journals, {
      generatedAt,
      fromDate,
      journalLimit: config.myob.journalLimit,
    });
    for (const [code, doc] of Object.entries(drilldowns.accounts)) {
      writeJsonFile(
        config.resolve("myobCache", path.join("account-drilldowns", `myob-account-${code}-drilldown.json`)),
        doc
      );
    }
    writeJsonFile(config.resolve("myobCache", DRILLDOWN_SUMMARY_FILE), drilldowns.summary);
    counts.drilldown_accounts = drilldowns.summary.accounts.length;
  }

  run.counts = counts;
  run.errors = errors;
  run.ok = errors.length === 0;
}

// ---------------------------------------------------------------------------
// Run lifecycle / status
// ---------------------------------------------------------------------------

let currentRun = null;

function statusFilePath() {
  return config.resolve("myobCache", STATUS_FILE);
}

function persistStatus(lastRun) {
  const filePath = statusFilePath();
  if (filePath) writeJsonFile(filePath, { generated_at: nowIso(), last_run: lastRun });
}

function getStatus() {
  const filePath = statusFilePath();
  const persisted = readJsonFile(filePath);
  const lastRun = (persisted && persisted.last_run) ?? null;
  const orphanedRun = !currentRun && lastRun && !lastRun.finishedAt && lastRun.ok === null;
  return {
    data: {
      running: currentRun !== null,
      current_run: currentRun ? currentRun.info : null,
      last_run: lastRun,
      orphaned_run: Boolean(orphanedRun),
    },
    meta: {
      dataSource: persisted ? "live-cache" : "missing",
      sourcePath: filePath,
      generated_at: (lastRun && (lastRun.finishedAt || lastRun.startedAt)) ?? null,
      warnings: orphanedRun ? ["previous sync did not finish in this server process; start a fresh sync to replace it"] : [],
    },
  };
}

// Kick off a run in-process without blocking the request. Returns
// {started:false} when a run is already in flight (controller answers 409).
function startSync({ company, fromDate, toDate } = {}) {
  if (currentRun) return { started: false, status: getStatus() };
  if (!config.dirs.myobCache) {
    throw new UnavailableError("MYOB sync requires MYOB_CACHE_DIR (or CFO_DATA_DIR) to be set");
  }

  const companyName = company === "test" ? config.myob.companyTest : config.myob.company;
  const run = {
    startedAt: nowIso(),
    finishedAt: null,
    ok: null,
    company: companyName,
    // Explicit request window echoed back on sync-status (null = env/FY default).
    // executeRun reads these same fields to drive the journal fetch.
    from_date: fromDate ?? null,
    to_date: toDate ?? null,
    counts: {},
    errors: [],
  };
  currentRun = { info: run };
  persistStatus(run);

  currentRun.promise = (async () => {
    try {
      await myobClient.withSession((session) => executeRun(session, run), { company: companyName });
    } catch (error) {
      run.errors = [...(run.errors || []), `run: ${error.message}`];
      run.ok = false;
    } finally {
      run.finishedAt = nowIso();
      if (run.ok === null) run.ok = run.errors.length === 0;
      try {
        persistStatus(run);
      } catch (error) {
        console.error("myob sync: failed to persist status", error);
      }
      currentRun = null;
    }
  })();
  // Never let the detached promise surface as an unhandled rejection.
  currentRun.promise.catch(() => {});

  return { started: true, status: getStatus() };
}

// In-process scheduler: refresh the caches every syncIntervalHours, plus one
// catch-up run shortly after boot when the last run is older than the
// interval (or never happened). Timers are unref'd so they never hold the
// process open; a run already in flight just skips the tick (startSync
// returns started:false).
function startScheduler() {
  const hours = config.myob.syncIntervalHours;
  if (!hours || hours <= 0) return null;
  if (!config.dirs.myobCache || !config.myob.url || !config.myob.username || !config.myob.password) {
    return null;
  }

  const intervalMs = hours * 60 * 60 * 1000;
  const tick = (reason) => {
    try {
      const { started } = startSync();
      if (started) console.log(`myob sync: scheduled run started (${reason})`);
    } catch (error) {
      console.error(`myob sync: scheduled run failed to start (${reason})`, error.message);
    }
  };

  const lastRun = getStatus().data.last_run;
  const lastFinished = lastRun && lastRun.finishedAt ? Date.parse(lastRun.finishedAt) : null;
  const stale = lastFinished === null || Date.now() - lastFinished >= intervalMs;
  if (stale) {
    const bootTimer = setTimeout(() => tick("boot catch-up"), 15_000);
    bootTimer.unref();
  }
  const interval = setInterval(() => tick(`every ${hours}h`), intervalMs);
  interval.unref();
  console.log(`myob sync: scheduler active (every ${hours}h${stale ? ", catch-up run in 15s" : ""})`);
  return interval;
}

module.exports = {
  startSync,
  getStatus,
  startScheduler,
  // pure builders, exported for unit tests
  flattenJournalLines,
  buildCmfDocument,
  buildDepartmentReport,
  buildBroadCache,
  buildBenefitsCache,
  classifyBenefitsCategory,
  buildAccountDrilldown,
  buildKeyAccountDrilldowns,
  buildGlCashMovements,
  enrichCashCandidates,
  defaultFromDate,
  periodMMYYYY,
  subaccountPrefix,
};

// Historical MYOB journal backfill into the durable Mongo store
// (myobHistoryRepository) — a parallel layer to the current-FY JSON cache
// written by myobSyncService; it never touches the live-cache files the
// dashboard reads. Network discipline matches the sync exactly: one
// withSession login/logout bracket per run, read-only GETs, pagedFetch
// pagination. Lines are stored RAW (original account codes, no mapping).
// The MYOB Budget entity is broken server-side (HTTP 500, BQL-delegate
// filters), so budgets are never fetched here — scripts/import-budgets.js
// loads them from a file export with source "manual" instead.
const config = require("../config");
const myobClient = require("../lib/myobClient");
const { ACCOUNT_MAPPING } = require("../constants/accountMapping");
const { flattenRecord, pickField, loadLiveGl } = require("../repositories/myobCacheRepository");
const repo = require("../repositories/myobHistoryRepository");
const { resolveMapping, mappingPrefix, UNMAPPED_FUNCTION } = require("./accountMappingService");
const { classifyAccounts, lineKind } = require("./commandCentreDerivation");
const { flattenJournalLines } = require("./myobSyncService");

const PAGE_SIZE = 500;
const UPSERT_CHUNK = 1000;
// A FY with at most this share of unmapped dollars passes the gate without a
// human approval (see fyIsVisible).
const UNMAPPED_SHARE_GATE = 0.01;
// Hard stop for --walk-back so a tenant with no "empty" floor recorded can
// never loop forever (MYOB data floor is 2023-10-11; FY2023 marks it).
const WALK_BACK_FLOOR_YEAR = 2000;

function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

// ---------------------------------------------------------------------------
// Pure FY-window / walk-back math (exported for tests — no network involved)
// ---------------------------------------------------------------------------

// AU financial years are labeled by ending year: fyWindow(2025) and
// fyWindow("FY2025") are both 2024-07-01..2025-06-30.
function fyWindow(fy) {
  const year = Number(String(fy).replace(/^FY/i, ""));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`invalid financial year: ${fy}`);
  }
  return { fy: `FY${year}`, fromDate: `${year - 1}-07-01`, toDate: `${year}-06-30` };
}

// Ending year of the AU financial year `now` falls in (July rolls forward).
function currentFy(now = new Date()) {
  return now.getMonth() + 1 >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}

// Day after a YYYY-MM-DD date — the exclusive upper bound for the window
// filter (TransactionDate lt), so the toDate itself is fully included.
function nextDay(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed.toISOString().slice(0, 10);
}

// The FY the next --walk-back invocation should sync: the most recent prior
// FY (current FY belongs to the live sync) whose watermark is missing or
// still "pending". A FY already recorded "empty" is the data floor — stop
// there; "complete" FYs are walked past.
function nextWalkBackFy(states, now = new Date()) {
  const byFy = new Map(states.map((state) => [state.fy, state]));
  for (let year = currentFy(now) - 1; year >= WALK_BACK_FLOOR_YEAR; year -= 1) {
    const state = byFy.get(`FY${year}`);
    if (!state || state.status === "pending") return year;
    if (state.status === "empty") return null; // floor reached
    // status === "complete" — keep walking back
  }
  return null;
}

// ---------------------------------------------------------------------------
// Line identity (exported for tests — no network involved)
// ---------------------------------------------------------------------------

// flattenJournalLines is reused verbatim (single flattener rule); this only
// adds the stable per-journal identity Mongo upserts key on: the tenant's
// LineNbr when every detail row carries a unique one, else the 1-based
// ordinal within the journal's Details array (never mixed within a journal,
// so ordinals cannot collide with tenant numbers).
function toHistoryLines(journals, accountDescriptions = {}) {
  const lines = [];
  for (const raw of journals) {
    const flat = flattenJournalLines([raw], accountDescriptions);
    const details = flattenRecord(raw).Details || [];
    const lineNbrs = details.map((detail) => Number(pickField(detail, "LineNbr", "LineNumber")));
    const useTenantNbrs =
      lineNbrs.length === flat.length &&
      lineNbrs.every((nbr) => Number.isInteger(nbr) && nbr > 0) &&
      new Set(lineNbrs).size === lineNbrs.length;
    flat.forEach((line, index) => {
      lines.push({ ...line, line_nbr: useTenantNbrs ? lineNbrs[index] : index + 1 });
    });
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Manual budget rows (exported for tests — used by scripts/import-budgets.js)
// ---------------------------------------------------------------------------

// One {fy, account, amount} row -> {ok:true, value} (fy normalized to
// "FY####") or {ok:false, error} for the import script's per-row report.
function normalizeBudgetRow(row, index) {
  const label = `row ${index + 1}`;
  if (!row || typeof row !== "object") return { ok: false, error: `${label}: not an object` };
  const fyDigits = String(row.fy ?? "").trim().replace(/^FY/i, "");
  const year = Number(fyDigits);
  if (!/^\d{4}$/.test(fyDigits) || year < 2000 || year > 2100) {
    return { ok: false, error: `${label}: invalid fy "${row.fy}"` };
  }
  const account = String(row.account ?? "").trim();
  if (!account) return { ok: false, error: `${label}: missing account` };
  const amount = Number(row.amount);
  if (!Number.isFinite(amount)) return { ok: false, error: `${label}: invalid amount "${row.amount}"` };
  return { ok: true, value: { fy: `FY${year}`, account, amount } };
}

// CSV (header row naming fy/account/amount columns, any order) or a JSON
// array of {fy, account, amount} objects, picked by file extension.
function parseBudgetFile(text, filePath) {
  if (/\.json$/i.test(filePath)) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error("JSON budget file must be an array of {fy, account, amount} rows");
    return parsed;
  }
  const rows = String(text).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (rows.length < 2) throw new Error("CSV budget file needs a header row and at least one data row");
  const unquote = (cell) => cell.trim().replace(/^"(.*)"$/, "$1");
  const header = rows[0].split(",").map((cell) => unquote(cell).toLowerCase());
  const fyCol = header.indexOf("fy");
  const accountCol = header.indexOf("account");
  const amountCol = header.indexOf("amount");
  if (fyCol === -1 || accountCol === -1 || amountCol === -1) {
    throw new Error(`CSV header must include fy, account, amount (got: ${rows[0]})`);
  }
  return rows.slice(1).map((row) => {
    const cells = row.split(",").map(unquote);
    return { fy: cells[fyCol], account: cells[accountCol], amount: cells[amountCol] };
  });
}

// ---------------------------------------------------------------------------
// Chart-of-accounts drift + FY mapping gate (Mongo only — no network)
// ---------------------------------------------------------------------------

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

// Chart-of-accounts drift for one backfilled FY: which mapping keys (the
// first subaccount segment/prefix — how the live derivation actually maps) in
// that year's raw lines resolve to no function under the versioned mapping
// (accountMappingService). Unmapped is a first-class bucket, never folded
// into a real function. Dollar weight is abs(net_debit) so a journal's equal
// debits/credits cannot cancel to a fake zero. Records the measured
// unmappedShare on the FY watermark (existing docs only — a drift run never
// fabricates a watermark).
async function driftReport(fy, { db } = {}) {
  const window = fyWindow(fy);
  const lines = await repo.listJournalLinesByDate(window.fromDate, window.toDate, { db });
  const mappedByFunction = new Map();
  const unmappedByCode = new Map();
  let mappedLines = 0;
  let mappedAmount = 0;
  let unmappedAmount = 0;
  for (const line of lines) {
    const netDebit =
      line.net_debit === undefined || line.net_debit === null
        ? (Number(line.debit) || 0) - (Number(line.credit) || 0)
        : Number(line.net_debit) || 0;
    const amount = Math.abs(netDebit);
    const mapping = resolveMapping(line.subaccount, window.fy);
    if (mapping) {
      mappedLines += 1;
      mappedAmount += amount;
      const agg = mappedByFunction.get(mapping.functionName) || { functionName: mapping.functionName, lineCount: 0, amount: 0 };
      agg.lineCount += 1;
      agg.amount += amount;
      mappedByFunction.set(mapping.functionName, agg);
    } else {
      unmappedAmount += amount;
      const code = mappingPrefix(line.subaccount) || "(none)";
      const agg = unmappedByCode.get(code) || { code, lineCount: 0, amount: 0 };
      agg.lineCount += 1;
      agg.amount += amount;
      unmappedByCode.set(code, agg);
    }
  }
  const totalAmount = mappedAmount + unmappedAmount;
  const unmappedShare = round4(totalAmount > 0 ? unmappedAmount / totalAmount : 0);
  const byAmountDesc = (a, b) => b.amount - a.amount;
  await repo.setSyncStateFields(window.fy, { unmappedShare }, { db });
  return {
    fy: window.fy,
    lineCount: lines.length,
    unmappedShare,
    mapped: {
      lineCount: mappedLines,
      amount: round2(mappedAmount),
      functions: [...mappedByFunction.values()]
        .map((agg) => ({ ...agg, amount: round2(agg.amount) }))
        .sort(byAmountDesc),
    },
    unmapped: {
      bucket: UNMAPPED_FUNCTION,
      lineCount: lines.length - mappedLines,
      amount: round2(unmappedAmount),
      codes: [...unmappedByCode.values()]
        .map((agg) => ({ ...agg, amount: round2(agg.amount) }))
        .sort(byAmountDesc),
    },
  };
}

// The mapping gate: a FY's history is visible to downstream consumers (the
// copilot layer) ONLY when its watermark is status "complete" AND either a
// human approved the mapping (approved === true) or the drift report measured
// at most UNMAPPED_SHARE_GATE unmapped dollars (unmappedShare <= 0.01).
function fyIsVisible(state) {
  return (
    state.status === "complete" &&
    (state.approved === true ||
      (typeof state.unmappedShare === "number" && state.unmappedShare <= UNMAPPED_SHARE_GATE))
  );
}

// FY labels ("FY2025", oldest first) the copilot layer may read history for.
async function visibleHistoryFys({ db } = {}) {
  const states = await repo.listSyncStates({ db });
  return states.filter(fyIsVisible).map((state) => state.fy);
}

// Human sign-off on a FY's mapping — flips the gate regardless of
// unmappedShare. Returns the updated watermark, or null when the FY has never
// been backfilled (approval never fabricates a watermark).
async function approveFy(fy, { db } = {}) {
  const window = fyWindow(fy);
  const result = await repo.setSyncStateFields(window.fy, { approved: true }, { db });
  if (result.matched === 0) return null;
  return repo.getSyncState(window.fy, { db });
}

// ---------------------------------------------------------------------------
// Historical derivations for the copilot (Mongo only — no network). Every
// derivation answers ONLY for FYs that passed the mapping gate
// (visibleHistoryFys); a gated, absent or invalid FY returns a structured
// { available: false } result — never a throw — so the LLM tool loop can
// relay the coverage limit instead of crashing to the deterministic fallback.
// ---------------------------------------------------------------------------

// The structured refusal every historical derivation shares.
function fyNotAvailable(fy, reason, visibleFys) {
  return { fy, available: false, reason, visibleFys };
}

// Chart classes for line classification — injected accounts (tests) or the
// live-gl cache's chart (same 6-digit CoA scheme across every stored FY, per
// the probe). With no chart at all, lineKind's default sweep treats every
// line as expense, the same rule the current-year derivation applies.
function chartClasses(accounts) {
  if (accounts) return classifyAccounts(accounts);
  const { data } = loadLiveGl();
  return classifyAccounts(data && Array.isArray(data.accounts) ? data.accounts : []);
}

// One FY's raw lines through the SAME normalization the current-year
// derivation applies: chart class -> income/expense/skip, net_debit falling
// back to debit-credit, income sign-flipped (credit-normal), balance-sheet
// skipped. Expense lines are bucketed per function via the versioned mapping
// resolver, with unresolved prefixes in the explicit Unmapped bucket.
function aggregateFyLines(lines, fy, classes) {
  const spentByFunction = new Map();
  const actualByAccount = new Map();
  let income = 0;
  let expense = 0;
  for (const line of lines) {
    const kind = lineKind(classes.get(String(line.account ?? "")));
    if (kind === "skip") continue;
    const netDebit =
      line.net_debit === undefined || line.net_debit === null
        ? (Number(line.debit) || 0) - (Number(line.credit) || 0)
        : Number(line.net_debit) || 0;
    const amount = kind === "income" ? -netDebit : netDebit;
    if (kind === "income") income += amount;
    else expense += amount;
    const account = String(line.account ?? "");
    actualByAccount.set(account, (actualByAccount.get(account) || 0) + amount);
    if (kind === "expense") {
      const mapping = resolveMapping(line.subaccount, fy);
      const functionName = mapping ? mapping.functionName : UNMAPPED_FUNCTION;
      const agg = spentByFunction.get(functionName) || { functionName, lineCount: 0, spent: 0 };
      agg.lineCount += 1;
      agg.spent += amount;
      spentByFunction.set(functionName, agg);
    }
  }
  return { income, expense, spentByFunction, actualByAccount };
}

// Shared gate + window + line pull for the single-FY derivations. Returns
// { window, visibleFys, agg } or { refusal } when the FY is invalid, gated or
// never backfilled.
async function visibleFyAgg(fy, { db, accounts } = {}) {
  const visibleFys = await visibleHistoryFys({ db });
  let window;
  try {
    window = fyWindow(fy);
  } catch (error) {
    return { refusal: fyNotAvailable(String(fy), error.message, visibleFys) };
  }
  if (!visibleFys.includes(window.fy)) {
    return {
      refusal: fyNotAvailable(
        window.fy,
        `${window.fy} is not in the visible history (complete and mapping-gated financial years only)`,
        visibleFys
      ),
    };
  }
  const lines = await repo.listJournalLinesByDate(window.fromDate, window.toDate, { db });
  return { window, visibleFys, agg: aggregateFyLines(lines, window.fy, chartClasses(accounts)) };
}

// Per-function expense totals for one visible FY (copilot tool
// fy_spend_by_function). Rounding matches the live derivation: whole dollars
// via Math.round after summing.
async function fySpendByFunction(fy, { db, accounts } = {}) {
  const { refusal, window, agg } = await visibleFyAgg(fy, { db, accounts });
  if (refusal) return refusal;
  const income = Math.round(agg.income);
  const expense = Math.round(agg.expense);
  return {
    fy: window.fy,
    available: true,
    totals: { income, expense, net: income - expense },
    functions: [...agg.spentByFunction.values()]
      .map((fn) => ({ ...fn, spent: Math.round(fn.spent) }))
      .sort((a, b) => b.spent - a.spent),
  };
}

// Budget vs actual per account for one visible FY (copilot tool
// budget_vs_actual) — only meaningful where budget rows exist for that FY.
// "manual" rows win over "myob" for the same account (the tenant's Budget
// entity is broken server-side, so "myob" stays reserved). Actuals use the
// same signed normalization as fySpendByFunction; unbudgetedActual keeps the
// answer honest when actuals extend past the budgeted accounts.
async function budgetVsActual(fy, { db, accounts } = {}) {
  const { refusal, window, visibleFys, agg } = await visibleFyAgg(fy, { db, accounts });
  if (refusal) return refusal;
  const budgets = await repo.listBudgetsByFy(window.fy, { db });
  if (budgets.length === 0) {
    return fyNotAvailable(
      window.fy,
      `${window.fy} has no budget rows loaded (import a file with scripts/import-budgets.js)`,
      visibleFys
    );
  }
  const budgetByAccount = new Map();
  for (const source of ["myob", "manual"]) {
    for (const row of budgets) {
      if (row.source === source) budgetByAccount.set(row.account, { budget: row.amount, source: row.source });
    }
  }
  const rows = [...budgetByAccount.entries()]
    .map(([account, { budget, source }]) => {
      const actual = Math.round(agg.actualByAccount.get(account) || 0);
      return { account, source, budget, actual, variance: budget - actual };
    })
    .sort((a, b) => (a.account < b.account ? -1 : a.account > b.account ? 1 : 0));
  const totals = rows.reduce(
    (acc, row) => ({
      budget: acc.budget + row.budget,
      actual: acc.actual + row.actual,
      variance: acc.variance + row.variance,
    }),
    { budget: 0, actual: 0, variance: 0 }
  );
  let unbudgetedActual = 0;
  for (const [account, actual] of agg.actualByAccount) {
    if (!budgetByAccount.has(account)) unbudgetedActual += actual;
  }
  return { fy: window.fy, available: true, rows, totals, unbudgetedActual: Math.round(unbudgetedActual) };
}

// Function names spendTrend accepts: every mapped function plus the Unmapped
// bucket itself (so the trend of unmapped spend is also queryable).
function knownFunctionNames() {
  return [...new Set(ACCOUNT_MAPPING.map((entry) => entry.functionName)), UNMAPPED_FUNCTION];
}

// Spend for one function across a FY range (copilot tool spend_trend). Only
// visible FYs are queried; gated/absent years inside the range land in
// skippedFys so the model can state the gap instead of interpolating it.
async function spendTrend(functionName, fromFy, toFy, { db, accounts } = {}) {
  const visibleFys = await visibleHistoryFys({ db });
  const refuse = (reason) => ({
    functionName: String(functionName),
    fromFy: String(fromFy),
    toFy: String(toFy),
    available: false,
    reason,
    visibleFys,
  });
  let from;
  let to;
  try {
    from = fyWindow(fromFy);
    to = fyWindow(toFy);
  } catch (error) {
    return refuse(error.message);
  }
  const fromYear = Number(from.fy.slice(2));
  const toYear = Number(to.fy.slice(2));
  if (fromYear > toYear) return refuse(`${from.fy} is after ${to.fy}`);
  const names = knownFunctionNames();
  const canonical = names.find((name) => name.toLowerCase() === String(functionName ?? "").trim().toLowerCase());
  if (!canonical) return refuse(`unknown function "${functionName}" (known: ${names.join(", ")})`);
  const classes = chartClasses(accounts);
  const points = [];
  const skippedFys = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    const window = fyWindow(year);
    if (!visibleFys.includes(window.fy)) {
      skippedFys.push(window.fy);
      continue;
    }
    const lines = await repo.listJournalLinesByDate(window.fromDate, window.toDate, { db });
    const agg = aggregateFyLines(lines, window.fy, classes);
    const fn = agg.spentByFunction.get(canonical);
    points.push({ fy: window.fy, spent: Math.round(fn ? fn.spent : 0) });
  }
  if (points.length === 0) return refuse("no visible history in that range");
  return { functionName: canonical, fromFy: from.fy, toFy: to.fy, available: true, points, skippedFys };
}

// Coverage facts for the copilot's "Historical data coverage" grounding
// section: the data floor, the FYs past the mapping gate, and which FYs have
// budget rows (by source). Returns null when the history store is unavailable
// (MONGODB_URI unset and no injected db) or unreadable — the prompt then says
// historical data is unavailable instead of guessing.
async function historyCoverage({ db } = {}) {
  if (!db && !config.mongoUri) return null;
  try {
    const states = await repo.listSyncStates({ db });
    const complete = states.filter((state) => state.status === "complete");
    const floorDate = complete.length > 0 ? complete[0].fromDate ?? null : null;
    return {
      floorDate,
      visibleFys: states.filter(fyIsVisible).map((state) => state.fy),
      budgetFys: await repo.listBudgetFys({ db }),
    };
  } catch (error) {
    console.warn(`myob history: coverage unavailable (${error.message})`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Backfill runs (network — one login/logout bracket per run, GET only)
// ---------------------------------------------------------------------------

// Pull chart + windowed journals inside one session bracket; Mongo writes
// happen after logout so the Acumatica session is held no longer than needed.
async function fetchWindow({ fromDate, toDate, company, client, journalLimit }) {
  return client.withSession(async (session) => {
    const accounts = (await client.pagedFetch(session, "Account", { top: PAGE_SIZE })).map(flattenRecord);
    const accountDescriptions = {};
    for (const account of accounts) {
      const code = String(pickField(account, "AccountCD"));
      if (code) accountDescriptions[code] = String(pickField(account, "Description"));
    }
    const journals = await client.pagedFetch(session, "JournalTransaction", {
      expand: "Details",
      filter: `TransactionDate ge datetimeoffset'${fromDate}' and TransactionDate lt datetimeoffset'${nextDay(toDate)}'`,
      top: PAGE_SIZE,
      maxRows: journalLimit,
    });
    return { journals, accountDescriptions };
  }, { company });
}

// One window pull + idempotent upsert. pagedFetch throws on any non-200 page,
// so a partial pull never reaches Mongo — silently persisting a truncated
// year would be worse than failing. Hitting the journal cap is reported via
// `capped` (backfillFy then leaves the FY "pending" rather than "complete").
async function backfillWindow({
  fromDate,
  toDate,
  company,
  client = myobClient,
  db,
  log = console.log,
  journalLimit = config.myob.historyJournalLimit,
} = {}) {
  const { journals, accountDescriptions } = await fetchWindow({ fromDate, toDate, company, client, journalLimit });
  const pages = Math.max(1, Math.ceil(journals.length / PAGE_SIZE));
  const capped = journals.length >= journalLimit;
  const lines = toHistoryLines(journals, accountDescriptions);
  let upserted = 0;
  let modified = 0;
  for (let offset = 0; offset < lines.length; offset += UPSERT_CHUNK) {
    const result = await repo.upsertJournalLines(lines.slice(offset, offset + UPSERT_CHUNK), { db });
    upserted += result.upserted;
    modified += result.modified;
  }
  log(
    `myob history: ${fromDate}..${toDate} — ${journals.length} journals / ${pages} pages / ${lines.length} lines ` +
      `(upserted ${upserted}, updated ${modified})${capped ? " [journal cap hit — window incomplete]" : ""}`
  );
  return { fromDate, toDate, journals: journals.length, pages, lineCount: lines.length, upserted, modified, capped };
}

// One whole AU financial year, watermarked in myob_sync_state: "pending"
// while running (and after a capped pull), then "complete" — or "empty" when
// the FY returned zero lines, which --walk-back treats as the data floor.
async function backfillFy({ fy, company, client, db, log = console.log, journalLimit } = {}) {
  const window = fyWindow(fy);
  await repo.upsertSyncState(
    { fy: window.fy, fromDate: window.fromDate, toDate: window.toDate, status: "pending" },
    { db }
  );
  log(`myob history: ${window.fy} (${window.fromDate}..${window.toDate}) starting`);
  const result = await backfillWindow({ ...window, company, client, db, log, journalLimit });
  const status = result.lineCount === 0 ? "empty" : result.capped ? "pending" : "complete";
  await repo.upsertSyncState(
    {
      fy: window.fy,
      fromDate: window.fromDate,
      toDate: window.toDate,
      status,
      lineCount: result.lineCount,
      lastSyncedAt: nowIso(),
    },
    { db }
  );
  log(`myob history: ${window.fy} ${status}${status === "empty" ? " — data floor reached" : ""}`);
  return { mode: "fy", ...result, fy: window.fy, status };
}

// Orchestrator for scripts/backfill-history.js — exactly one mode per run:
//   fy               one AU financial year (watermarked)
//   fromDate/toDate  arbitrary window for testing (lines only, NO watermark —
//                    a partial window must never mark a whole FY complete)
//   walkBack         the most recent unsynced prior FY, one FY per invocation
async function runBackfill({ fy, fromDate, toDate, walkBack, company, client, db, log = console.log, journalLimit, now } = {}) {
  if (walkBack) {
    const states = await repo.listSyncStates({ db });
    const target = nextWalkBackFy(states, now);
    if (target === null) {
      log("myob history: walk-back — data floor reached (or no prior FY left); nothing to sync");
      return { mode: "walk-back", fy: null, done: true };
    }
    const result = await backfillFy({ fy: target, company, client, db, log, journalLimit });
    return { ...result, mode: "walk-back", done: result.status === "empty" };
  }
  if (fy !== undefined && fy !== null) {
    return backfillFy({ fy, company, client, db, log, journalLimit });
  }
  for (const [flag, value] of [["--from", fromDate], ["--to", toDate]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""))) throw new Error(`${flag} must be a YYYY-MM-DD date`);
  }
  const result = await backfillWindow({ fromDate, toDate, company, client, db, log, journalLimit });
  return { mode: "window", ...result };
}

module.exports = {
  runBackfill,
  backfillFy,
  backfillWindow,
  driftReport,
  approveFy,
  visibleHistoryFys,
  fyIsVisible,
  UNMAPPED_SHARE_GATE,
  // historical derivations + coverage facts for the copilot layer
  fySpendByFunction,
  budgetVsActual,
  spendTrend,
  historyCoverage,
  // pure helpers, exported for unit tests and the import script
  fyWindow,
  currentFy,
  nextDay,
  nextWalkBackFy,
  toHistoryLines,
  normalizeBudgetRow,
  parseBudgetFile,
};

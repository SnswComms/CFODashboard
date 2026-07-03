// Per-metric live pull. Refresh ONE figure (an Overview KPI card, a cash
// movement, the benefits balance, a key-account drilldown, department spend)
// with a scoped, read-only (GET-only) MYOB fetch of just the journal slice that
// figure needs, recomputed through the SAME builders the full sync uses, and
// persisted to that metric's OWN small cache file under
// myobCache/metric-pulls/metric-<id>.json.
//
// Design constraints (parallel to myobSyncService but deliberately isolated):
//   - GET-only against MYOB; no entity is ever written back.
//   - Never take the global sync lock (myobSyncService.currentRun) and never
//     write the big shared caches (live-gl/cmf/departments/benefits/drilldowns)
//     the full sync owns. Fresh per-metric values live in their own files, so a
//     per-metric pull can run WHILE a full sync runs without clobbering it.
//   - Concurrency is guarded PER METRIC ID (an in-flight Set) so the same card
//     cannot double-fire, but two DIFFERENT metrics refresh at once.
//   - The accounting is byte-identical to the full sync because every recompute
//     reuses a named myobSyncService / commandCentreDerivation builder — this
//     service only narrows the FETCH scope and picks the ONE figure out.
const path = require("path");

const config = require("../config");
const { UnavailableError, NotFoundError, BadRequestError } = require("../lib/errors");
const myobClient = require("../lib/myobClient");
const { flattenRecord, pickField } = require("../repositories/myobCacheRepository");
const { readJsonFile, writeJsonFile } = require("../repositories/jsonFileRepository");
const { getMetric } = require("../constants/metricRegistry");
const sync = require("./myobSyncService");
const { buildLiveModel } = require("./commandCentreDerivation");

function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

// The FY-start window the full sync uses (env override, then previous July 1),
// so per-metric actuals cover the exact same window as the monolithic pull.
function windowFromDate() {
  return config.myob.syncFromDate || sync.defaultFromDate();
}

// Scoped, GET-only chart-of-accounts fetch (paged). Some recipes (department
// report, GL cash, overview KPIs) need account classes to split income/expense;
// the CMF/benefits/drilldown recipes work off journals alone.
async function fetchAccounts(session) {
  const raw = await myobClient.pagedFetch(session, "Account", { top: 500 });
  return raw.map(flattenRecord);
}

// Scoped, GET-only JournalTransaction pull with Details from the FY window
// start, optionally filtered to a single account so a per-account metric pulls
// only its own lines. Mirrors executeRun's journal fetch (same filter/expand/
// paging/cap) but never re-fetches the whole ledger when a scope narrows it.
async function fetchJournals(session, { fromDate, account = null } = {}) {
  const accountClause = account ? ` and Account eq '${account}'` : "";
  return myobClient.pagedFetch(session, "JournalTransaction", {
    expand: "Details",
    filter: `TransactionDate ge datetimeoffset'${fromDate}'${accountClause}`,
    top: 500,
    maxRows: config.myob.journalLimit,
  });
}

function accountDescriptionsFrom(accounts) {
  const map = {};
  for (const account of accounts) {
    const code = String(pickField(account, "AccountCD"));
    if (code) map[code] = String(pickField(account, "Description"));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Per-kind recompute recipes. Each returns { value, extras } where `value` is
// the ONE figure the card shows and `extras` is the supporting slice persisted
// alongside it (so the card can render provenance / a drilldown without a second
// call). Every recipe reuses a named builder — no accounting is re-implemented.
// ---------------------------------------------------------------------------

async function computeOverviewKpi(session, metric, { generatedAt, fromDate }) {
  const accounts = await fetchAccounts(session);
  const journals = await fetchJournals(session, { fromDate });
  const journalLines = sync.flattenJournalLines(journals, accountDescriptionsFrom(accounts));
  // Reuse the full command-centre derivation, then pick the single KPI. The doc
  // shape mirrors the live-gl cache buildLiveModel already consumes.
  const model = buildLiveModel(
    { generated_at: generatedAt, from_date: fromDate, accounts, journal_lines: journalLines },
    { dataSource: "live-cache", generated_at: generatedAt }
  );
  const kpi = model.opKpis[metric.kpiIndex];
  return {
    value: { eyebrow: kpi.eyebrow, value: kpi.value, note: kpi.note, tone: kpi.tone },
    extras: { totals: model.totals, journals_scanned: journals.length, journal_lines: journalLines.length },
  };
}

async function computeCmfCash(session, _metric, { generatedAt, fromDate }) {
  const accounts = await fetchAccounts(session);
  const journals = await fetchJournals(session, { fromDate });
  const journalLines = sync.flattenJournalLines(journals, accountDescriptionsFrom(accounts));
  const latest = journalLines.reduce((max, line) => (line.date && line.date > max ? line.date : max), "");
  const doc = sync.buildCmfDocument(journalLines, {
    targetAccounts: config.myob.cmfTargetAccounts,
    accounts,
    generatedAt,
    fromDate,
    toDate: latest || dateOnly(generatedAt),
    journalsScanned: journals.length,
  });
  return {
    value: { balances_by_account: doc.balances_by_account, line_count: doc.line_count },
    extras: {
      target_accounts: doc.target_accounts,
      balances_by_account_subaccount: doc.balances_by_account_subaccount,
    },
  };
}

async function computeGlCash(session, _metric, { generatedAt, fromDate }) {
  const accounts = await fetchAccounts(session);
  const journals = await fetchJournals(session, { fromDate });
  const journalLines = sync.flattenJournalLines(journals, accountDescriptionsFrom(accounts));
  const latest = journalLines.reduce((max, line) => (line.date && line.date > max ? line.date : max), "");
  const movements = sync.buildGlCashMovements(journalLines, {
    generatedAt,
    fromDate,
    toDate: latest || dateOnly(generatedAt),
    accountDescriptions: accountDescriptionsFrom(accounts),
  });
  return {
    value: { accounts: movements.accounts, basis: movements.basis, warning: movements.warning },
    extras: { future_dated_excluded: movements.future_dated_excluded },
  };
}

async function computeBenefits(session, _metric, { generatedAt, fromDate }) {
  const journals = await fetchJournals(session, { fromDate, account: "312510" });
  const journalLines = sync.flattenJournalLines(journals);
  const doc = sync.buildBenefitsCache(journalLines, { generatedAt, fromDate, baseUrl: session.base });
  return {
    value: {
      account_balance: doc.derived.account_balance,
      account_as_of: doc.derived.account_as_of,
      transaction_count: doc.derived.recent_transaction_count,
    },
    extras: {
      eligible_employee_count: doc.derived.eligible_employee_count,
      category_rollup: doc.derived.recent_transaction_category_rollup,
    },
  };
}

async function computeDepartmentReport(session, _metric, { generatedAt, fromDate }) {
  const accounts = await fetchAccounts(session);
  const journals = await fetchJournals(session, { fromDate });
  const journalLines = sync.flattenJournalLines(journals, accountDescriptionsFrom(accounts));
  const latest = journalLines.reduce((max, line) => (line.date && line.date > max ? line.date : max), "");
  const doc = sync.buildDepartmentReport(journalLines, accounts, {
    generatedAt,
    fromDate,
    toDate: latest || dateOnly(generatedAt),
  });
  return {
    value: { summary: doc.summary, department_count: doc.departments.length },
    extras: { departments: doc.departments, period_context: doc.period_context },
  };
}

async function computeAccountDrilldown(session, metric, { generatedAt, fromDate }) {
  const journals = await fetchJournals(session, { fromDate, account: metric.account });
  const doc = sync.buildAccountDrilldown(journals, {
    account: metric.account,
    generatedAt,
    fromDate,
    journalLimit: config.myob.journalLimit,
  });
  return {
    value: { account: doc.account, derived: doc.derived, journals_scanned: doc.journals_scanned },
    extras: { journal_lines: doc.journal_lines },
  };
}

const RECIPES = {
  overview_kpi: computeOverviewKpi,
  cmf_cash: computeCmfCash,
  gl_cash: computeGlCash,
  benefits: computeBenefits,
  department_report: computeDepartmentReport,
  account_drilldown: computeAccountDrilldown,
};

// ---------------------------------------------------------------------------
// Cache + concurrency (per metric id, isolated from the global sync lock)
// ---------------------------------------------------------------------------

// Metric ids with a pull in flight. This is NOT the sync lock — it is scoped to
// the one metric so different metrics run concurrently. Two refreshes of the
// SAME card just return started:false (the controller answers 409).
const inFlight = new Set();

function cachePath(metric) {
  return config.resolve("myobCache", metric.cacheFile);
}

// The persisted per-metric document: the fresh value, an as-of timestamp, and
// full provenance (which scoped GET fed it, which builder computed it).
function readCached(metric) {
  const filePath = cachePath(metric);
  const doc = readJsonFile(filePath);
  return {
    data: doc,
    meta: {
      dataSource: doc ? "live-cache" : "missing",
      sourcePath: filePath,
      generated_at: doc ? doc.generated_at ?? null : null,
    },
  };
}

async function runPull(metric) {
  const generatedAt = nowIso();
  const fromDate = windowFromDate();
  const companyName = config.myob.company;
  const recipe = RECIPES[metric.kind];

  const { value, extras } = await myobClient.withSession(
    (session) => recipe(session, metric, { generatedAt, fromDate }),
    { company: companyName }
  );

  const doc = {
    metric_id: metric.id,
    label: metric.label,
    view: metric.view,
    generated_at: generatedAt,
    as_of: generatedAt,
    read_only_policy: "GET-only",
    provenance: {
      source: "MYOB Advanced per-metric live pull (CFO Dashboard, GET-only)",
      myob_scope: metric.myobScope,
      compute_source: metric.computeSource,
      from_date: fromDate,
      company: companyName,
      base_endpoint_family: config.myob.endpointFamily,
    },
    value,
    extras,
  };
  writeJsonFile(cachePath(metric), doc);
  return doc;
}

// Kick off a scoped pull for one metric. Synchronous phase validates + claims
// the per-id slot; the network phase runs on the returned promise. The caller
// (controller) awaits the promise, so a per-metric pull is request-scoped —
// unlike the full sync it is short and returns the fresh figure inline.
async function pullMetric(id) {
  const metric = getMetric(id);
  if (!metric) throw new NotFoundError(`unknown metric: ${id}`);
  const recipe = RECIPES[metric.kind];
  if (!recipe) throw new BadRequestError(`metric ${id} has no pull recipe (kind ${metric.kind})`);
  if (!config.dirs.myobCache) {
    throw new UnavailableError("per-metric pull requires MYOB_CACHE_DIR (or CFO_DATA_DIR) to be set");
  }
  if (inFlight.has(id)) {
    return { started: false, ...readCached(metric) };
  }

  inFlight.add(id);
  try {
    const doc = await runPull(metric);
    return {
      started: true,
      data: doc,
      meta: { dataSource: "live-cache", sourcePath: cachePath(metric), generated_at: doc.generated_at },
    };
  } finally {
    inFlight.delete(id);
  }
}

// Read the last per-metric pull without hitting MYOB (for the card's initial
// paint / after a reload). Missing until the card has been refreshed at least
// once — the full sync's shared caches remain the default source everywhere.
function getMetricValue(id) {
  const metric = getMetric(id);
  if (!metric) throw new NotFoundError(`unknown metric: ${id}`);
  const cached = readCached(metric);
  return { data: cached.data, meta: cached.meta, running: inFlight.has(id) };
}

module.exports = {
  pullMetric,
  getMetricValue,
  // exported for tests
  windowFromDate,
  RECIPES,
};

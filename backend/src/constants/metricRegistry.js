// Per-metric live-pull registry. Every individual data point on the dashboard
// that supports a "refresh this one figure" control is declared here once, so
// the metricPullService, controller and frontend all address the same catalog.
//
// The full sync (myobSyncService.startSync) rebuilds EVERY cache under a global
// singleton lock. A per-metric pull is the opposite: a SCOPED, read-only
// (GET-only) MYOB fetch of just the journal slice a single figure needs, run
// through the SAME builders the full sync uses so the accounting stays
// byte-identical, then persisted to its OWN small cache file under
// myobCache/metric-pulls/. Per-metric pulls never take the sync lock and never
// touch the big shared caches, so two figures can refresh at once.
//
// Each entry declares:
//   id            stable metric key (also the concurrency key and cache basename)
//   label         human label for the card / provenance line
//   view          the dashboard view the control lives on
//   myobScope     the scoped GET this metric issues against MYOB (documentation
//                 string mirrored by the fetcher in metricPullService)
//   computeSource the existing builder the pull reuses to recompute the figure
//                 (NEVER re-implement the accounting — reuse the named builder)
//   cacheFile     per-metric cache path, resolved under the myobCache dir
//
// The `kind` groups metrics that share a fetch+compute recipe in the service
// (accounts is the extra scope some recipes need, e.g. the department report
// and the overview KPIs both want the chart of accounts alongside journals).

const path = require("path");

const { KEY_ACCOUNT_LABELS } = require("./keyAccounts");

function metricCacheFile(id) {
  return path.join("metric-pulls", `metric-${id}.json`);
}

// Base (non-drilldown) metrics. Drilldown metrics for every key account are
// appended below so each key-account card gets its own refresh control.
const BASE_METRICS = [
  {
    id: "overview-operating-net",
    label: "Operating net · YTD",
    view: "overview",
    kind: "overview_kpi",
    // Which of buildLiveModel's opKpis this card mirrors (index into opKpis).
    kpiIndex: 2,
    myobScope: "GET Account (chart) + JournalTransaction $expand=Details since the FY-start window",
    computeSource: "commandCentreDerivation.buildLiveModel (opKpis[2] — income/expense/net)",
  },
  {
    id: "overview-operating-income",
    label: "Operating income · YTD",
    view: "overview",
    kind: "overview_kpi",
    kpiIndex: 0,
    myobScope: "GET Account (chart) + JournalTransaction $expand=Details since the FY-start window",
    computeSource: "commandCentreDerivation.buildLiveModel (opKpis[0] — income YTD)",
  },
  {
    id: "overview-operating-spend",
    label: "Operating spend · YTD",
    view: "overview",
    kind: "overview_kpi",
    kpiIndex: 1,
    myobScope: "GET Account (chart) + JournalTransaction $expand=Details since the FY-start window",
    computeSource: "commandCentreDerivation.buildLiveModel (opKpis[1] — expense YTD)",
  },
  {
    id: "cash-cmf-movement",
    label: "CMF cash net movement",
    view: "cash",
    kind: "cmf_cash",
    myobScope:
      "GET JournalTransaction $expand=Details for the CMF target accounts (config.myob.cmfTargetAccounts) since the FY-start window",
    computeSource: "myobSyncService.buildCmfDocument (net movement per target account)",
  },
  {
    id: "cash-gl-movements",
    label: "GL cash account movements (111xxx)",
    view: "cash",
    kind: "gl_cash",
    myobScope: "GET Account (chart) + JournalTransaction $expand=Details since the FY-start window",
    computeSource: "myobSyncService.buildGlCashMovements (net movement per 111xxx account)",
  },
  {
    id: "benefits-balance",
    label: "Benefits balance (account 312510)",
    // The 312510 balance renders on the Sources view (evidence registry row),
    // not Staffing — the staffing view is a pure client-side scenario calculator.
    view: "sources",
    kind: "benefits",
    myobScope: "GET JournalTransaction $expand=Details for account 312510 since the FY-start window",
    computeSource: "myobSyncService.buildBenefitsCache (account 312510 derived balances)",
  },
  {
    id: "departments-spend",
    label: "Department spend vs budget",
    view: "departments",
    kind: "department_report",
    myobScope: "GET Account (chart) + JournalTransaction $expand=Details since the FY-start window",
    computeSource: "myobSyncService.buildDepartmentReport (approved budgets + journal actuals)",
  },
];

// One drilldown metric per key account, so each key-account card on the
// operating view carries its own refresh control (id namespaced by code).
const DRILLDOWN_METRICS = Object.entries(KEY_ACCOUNT_LABELS).map(([code, label]) => ({
  id: `account-drilldown-${code}`,
  label: `${label} drilldown (${code})`,
  view: "operating",
  kind: "account_drilldown",
  account: code,
  myobScope: `GET JournalTransaction $expand=Details filtered to account ${code} since the FY-start window`,
  computeSource: "myobSyncService.buildAccountDrilldown (per-account journal drilldown)",
}));

const METRICS = [...BASE_METRICS, ...DRILLDOWN_METRICS].map((metric) => ({
  ...metric,
  cacheFile: metricCacheFile(metric.id),
}));

const METRICS_BY_ID = new Map(METRICS.map((metric) => [metric.id, metric]));

function getMetric(id) {
  return METRICS_BY_ID.get(id) || null;
}

// The catalog shape the frontend consumes (no internal-only fields like the
// kpiIndex/account plumbing — those stay in the service).
function metricCatalogEntry(metric) {
  return {
    id: metric.id,
    label: metric.label,
    view: metric.view,
    myob_scope: metric.myobScope,
    compute_source: metric.computeSource,
    cache_file: metric.cacheFile,
  };
}

module.exports = {
  METRICS,
  METRICS_BY_ID,
  getMetric,
  metricCatalogEntry,
  metricCacheFile,
};

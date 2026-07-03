// Per-metric live pull: a scoped, GET-only MYOB fetch of ONE figure, recomputed
// through the SAME builders the full sync uses, persisted to its own cache file,
// with concurrency guarded PER metric id (not the global sync lock). Dirs point
// at a temp workspace BEFORE the config loads; myobClient is stubbed at the
// module boundary, so no test here ever touches the network.
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "metric-pull-test-"));
const cacheDir = path.join(tempRoot, "myob-cache");
fs.mkdirSync(cacheDir, { recursive: true });
process.env.CFO_DATA_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.MYOB_CACHE_DIR = cacheDir;
process.env.DASHBOARDS_DIR = "";
// Pin the FY window so the scoped fetch filter is deterministic in assertions.
process.env.MYOB_SYNC_FROM_DATE = "2025-07-01";

const test = require("node:test");
const assert = require("node:assert");

const { withServer, requestJson } = require("./helper");
const myobClient = require("../src/lib/myobClient");
const metricPullService = require("../src/services/metricPullService");
const { METRICS, getMetric, metricCacheFile } = require("../src/constants/metricRegistry");

// Raw journal as MYOB returns it (every scalar {value}-wrapped) — the same
// shape the sync builders flatten, so the reuse path is exercised end to end.
const RAW_JOURNALS = [
  {
    TransactionDate: { value: "2025-08-15T00:00:00+00:00" },
    BatchNbr: { value: "GJ-2001" },
    Branch: { value: "SNC" },
    Module: { value: "GL" },
    PostPeriod: { value: "022026" },
    Description: { value: "August payroll journal" },
    Details: [
      {
        AccountID: { value: "703430" },
        DebitAmt: { value: 120.5 },
        Subaccount: { value: "EVA-000" },
        TransactionDescription: { value: "Evangelism supplies" },
      },
      {
        Account: { value: "111300" },
        CreditAmount: { value: 120.5 },
        Subaccount: { value: "ADM-000" },
        Descr: { value: "CMF settlement" },
      },
    ],
  },
];

const RAW_ACCOUNTS = [
  { AccountCD: { value: "703430" }, Description: { value: "Local church evangelism" }, Type: { value: "Expense" } },
  { AccountCD: { value: "410100" }, Description: { value: "Tithe income" }, Type: { value: "Income" } },
  { AccountCD: { value: "111300" }, Description: { value: "Cash Management Facility" }, Type: { value: "Asset" } },
];

const cachePath = (id) => path.join(cacheDir, metricCacheFile(id));
const readCache = (id) => JSON.parse(fs.readFileSync(cachePath(id), "utf8"));

// The session never logs in: withSession just hands a stub base through.
myobClient.withSession = async (fn) => fn({ base: "https://example/entity/Default/23.200.001" });

// Default stub: records the last JournalTransaction opts so filter/scope can be
// asserted, and answers Account/JournalTransaction with the fixtures above.
let lastJournalOpts = null;
function installDefaultStubs() {
  lastJournalOpts = null;
  myobClient.pagedFetch = async (session, entity, opts) => {
    if (entity === "Account") return RAW_ACCOUNTS;
    if (entity === "JournalTransaction") {
      lastJournalOpts = opts;
      return RAW_JOURNALS;
    }
    return [];
  };
}

test("registry entries carry every field and unique ids/cache files", () => {
  assert.ok(METRICS.length > 0);
  const ids = new Set();
  const files = new Set();
  for (const metric of METRICS) {
    for (const field of ["id", "label", "view", "myobScope", "computeSource", "cacheFile", "kind"]) {
      assert.ok(metric[field], `metric ${metric.id} missing ${field}`);
    }
    assert.equal(metric.cacheFile, metricCacheFile(metric.id));
    assert.ok(!ids.has(metric.id), `duplicate id ${metric.id}`);
    assert.ok(!files.has(metric.cacheFile), `duplicate cache file ${metric.cacheFile}`);
    ids.add(metric.id);
    files.add(metric.cacheFile);
    // every kind must have a pull recipe in the service
    assert.ok(metricPullService.RECIPES[metric.kind], `no recipe for kind ${metric.kind}`);
  }
});

test("windowFromDate honours the env FY-start override", () => {
  assert.equal(metricPullService.windowFromDate(), "2025-07-01");
});

test("pullMetric issues a scoped GET-only journal fetch and writes its own cache", async () => {
  installDefaultStubs();
  const result = await metricPullService.pullMetric("overview-operating-net");
  assert.equal(result.started, true);

  // scoped fetch: filtered from the FY-start window, $expand=Details
  assert.equal(lastJournalOpts.expand, "Details");
  assert.match(lastJournalOpts.filter, /^TransactionDate ge datetimeoffset'2025-07-01'/);

  // persisted per-metric doc carries the fresh value + as-of + provenance
  const doc = readCache("overview-operating-net");
  assert.equal(doc.metric_id, "overview-operating-net");
  assert.equal(doc.read_only_policy, "GET-only");
  assert.ok(doc.generated_at);
  assert.equal(doc.as_of, doc.generated_at);
  assert.equal(doc.provenance.from_date, "2025-07-01");
  assert.match(doc.provenance.compute_source, /buildLiveModel/);
  // the value is the ONE KPI card (operating net), computed via the reused
  // derivation — income 0, expense 120.5 => net -121 (rounded, compact fmt)
  assert.equal(doc.value.eyebrow, "Operating net · YTD");
  assert.equal(doc.value.value, "($0K)");
  assert.equal(doc.extras.totals.expense, 121);
});

test("account drilldown metric narrows the fetch to its own account", async () => {
  installDefaultStubs();
  const metric = getMetric("account-drilldown-703430");
  assert.ok(metric);
  await metricPullService.pullMetric(metric.id);

  // the scoped fetch appends an Account eq clause so only 703430 lines pull
  assert.match(lastJournalOpts.filter, /Account eq '703430'/);

  const doc = readCache(metric.id);
  assert.equal(doc.value.account, "703430");
  // reused buildAccountDrilldown: one 703430 line, debit 120.5
  assert.equal(doc.value.derived.journal_line_count, 1);
  assert.equal(doc.value.derived.journal_debit_total, 120.5);
});

test("cmf and gl-cash metrics reuse the sync builders on their slice", async () => {
  installDefaultStubs();
  const cmf = await metricPullService.pullMetric("cash-cmf-movement");
  assert.equal(cmf.started, true);
  // buildCmfDocument net movement on 111300: credit 120.5 => -120.5
  assert.equal(cmf.data.value.balances_by_account["111300"], -120.5);

  installDefaultStubs();
  const gl = await metricPullService.pullMetric("cash-gl-movements");
  const account111300 = gl.data.value.accounts.find((row) => row.account === "111300");
  assert.equal(account111300.net_movement, -120.5);
  assert.match(gl.data.value.warning, /net movement over the extract window/);
});

test("a second pull of the SAME metric is rejected while one is in flight", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  // Hold the session open so the first pull stays in flight across the second.
  myobClient.withSession = async (fn) => {
    await gate;
    return fn({ base: "https://example/entity/Default/23.200.001" });
  };
  myobClient.pagedFetch = async (session, entity) => {
    if (entity === "Account") return RAW_ACCOUNTS;
    if (entity === "JournalTransaction") return RAW_JOURNALS;
    return [];
  };

  const first = metricPullService.pullMetric("benefits-balance");
  // second call while the first is gated: rejected, not a new pull
  const second = await metricPullService.pullMetric("benefits-balance");
  assert.equal(second.started, false);

  release();
  const firstResult = await first;
  assert.equal(firstResult.started, true);

  // restore the plain stub for any later test ordering
  myobClient.withSession = async (fn) => fn({ base: "https://example/entity/Default/23.200.001" });
});

test("different metrics pull concurrently (per-id lock, not a global one)", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  myobClient.withSession = async (fn) => {
    await gate;
    return fn({ base: "https://example/entity/Default/23.200.001" });
  };
  myobClient.pagedFetch = async (session, entity) => {
    if (entity === "Account") return RAW_ACCOUNTS;
    if (entity === "JournalTransaction") return RAW_JOURNALS;
    return [];
  };

  const a = metricPullService.pullMetric("overview-operating-income");
  const b = metricPullService.pullMetric("departments-spend");
  release();
  const [ra, rb] = await Promise.all([a, b]);
  // both started — a per-id guard never blocks a DIFFERENT metric
  assert.equal(ra.started, true);
  assert.equal(rb.started, true);

  myobClient.withSession = async (fn) => fn({ base: "https://example/entity/Default/23.200.001" });
});

test("GET /api/myob/metrics lists the catalog", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/myob/metrics");
    assert.equal(status, 200);
    assert.equal(body.data.count, METRICS.length);
    const entry = body.data.metrics.find((m) => m.id === "overview-operating-net");
    assert.ok(entry);
    assert.equal(entry.view, "overview");
    assert.ok(entry.myob_scope);
    assert.ok(entry.compute_source);
  });
});

test("POST /api/myob/metrics/:id/pull returns the fresh value; GET :id reads it back", async () => {
  installDefaultStubs();
  await withServer(async (base) => {
    const pull = await requestJson(base, "/api/myob/metrics/cash-cmf-movement/pull", { method: "POST" });
    assert.equal(pull.status, 200);
    assert.equal(pull.body.data.metric_id, "cash-cmf-movement");
    assert.equal(pull.body.meta.dataSource, "live-cache");

    const read = await requestJson(base, "/api/myob/metrics/cash-cmf-movement");
    assert.equal(read.status, 200);
    assert.equal(read.body.data.metric_id, "cash-cmf-movement");
    assert.equal(read.body.meta.running, false);

    const unknown = await requestJson(base, "/api/myob/metrics/not-a-metric");
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body.code, "NOT_FOUND");
  });
});

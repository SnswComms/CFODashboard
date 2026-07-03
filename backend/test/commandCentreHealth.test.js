// Live data-health surfacing: with a live-gl cache whose sync run recorded
// errors (embedded in the doc AND in sync-status.json), the overview must
// carry meta.warnings, flip the data-health KPI to Watch, downgrade the live
// freshness entry, and raise the warnings as alerts. Staleness is covered as
// a derivation unit test (the wall clock cannot be pinned per test file).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Point the backend at a temp MYOB cache BEFORE anything requires config —
// the config module snapshots env at require time.
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-health-"));
process.env.MYOB_CACHE_DIR = cacheDir;
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.COPILOT_LLM_DISABLED = "1";
// The fixture is pinned to 2026-06-30; disable the staleness check so the
// warnings below are exactly the error-driven ones whatever the real clock.
process.env.MYOB_STALE_AFTER_HOURS = "876000";

const test = require("node:test");
const assert = require("node:assert/strict");

const { withServer, requestJson } = require("./helper");
const { buildLiveModel } = require("../src/services/commandCentreDerivation");

const GENERATED_AT = "2026-06-30T00:00:00+00:00";
const SYNC_ERROR = "JournalTransaction: HTTP 500 from MYOB";
const RUN_ERROR = "run: login failed";

const LIVE_GL_DOC = {
  generated_at: GENERATED_AT,
  source: "test extract",
  from_date: "2026-01-01",
  accounts: [
    { AccountCD: "703430", Description: "Local church evangelism", AccountClass: "EXPENSE", Type: "Expense", Active: true },
    { AccountCD: "405000", Description: "Tithe income", AccountClass: "INCOME", Type: "Income", Active: true },
  ],
  journal_lines: [
    { kind: "JournalTransaction", date: "2026-01-15", period: "012026", branch: "SNC", account: "703430", account_description: "Local church evangelism", subaccount: "EVA-000", line_description: "Evangelism supplies", debit: 12000, credit: 0, net_debit: 12000 },
    { kind: "JournalTransaction", date: "2026-05-31", period: "052026", branch: "SNC", account: "405000", account_description: "Tithe income", subaccount: "ADM-000", line_description: "Tithe received", debit: 0, credit: 300000, net_debit: -300000 },
  ],
  bill_lines: [],
  // Partial-failure extract: the sync embeds its per-endpoint errors here.
  errors: [SYNC_ERROR],
};

// Failed last run: its errors overlap the doc's (same run) plus a run-level
// one — the overlap must be deduplicated in meta.warnings.
const SYNC_STATUS = {
  generated_at: GENERATED_AT,
  last_run: {
    startedAt: GENERATED_AT,
    finishedAt: GENERATED_AT,
    ok: false,
    company: "Church",
    counts: {},
    errors: [SYNC_ERROR, RUN_ERROR],
  },
};

test.before(() => {
  const glDir = path.join(cacheDir, "live-gl");
  fs.mkdirSync(glDir, { recursive: true });
  fs.writeFileSync(path.join(glDir, "myob-live-gl-latest.json"), JSON.stringify(LIVE_GL_DOC, null, 2));
  fs.writeFileSync(path.join(cacheDir, "sync-status.json"), JSON.stringify(SYNC_STATUS, null, 2));
});

test.after(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

test("GET /overview surfaces sync errors as warnings, a Watch KPI and alerts", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/overview");
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "live-cache");

    // Doc errors first, then the failed run's — overlap deduplicated.
    assert.deepEqual(body.meta.warnings, ["MYOB sync: " + SYNC_ERROR, "MYOB sync: " + RUN_ERROR]);

    // Data-health KPI flips to Watch/warn with the first warning as its note.
    assert.equal(body.data.kpis[3].value, "Watch");
    assert.equal(body.data.kpis[3].tone, "warn");
    assert.equal(body.data.kpis[3].note, "MYOB sync: " + SYNC_ERROR);

    // Live freshness entry downgrades from Current to Check.
    const live = body.data.freshness.find((f) => f.name === "MYOB live GL cache");
    assert.deepEqual(live, { name: "MYOB live GL cache", status: "Check", tone: "warn" });

    // Each warning raises a warn alert (numbered titles keep keys unique).
    assert.deepEqual(
      body.data.alerts.filter((alert) => alert.title.startsWith("Data warning")),
      [
        { title: "Data warning 1", body: "MYOB sync: " + SYNC_ERROR, tone: "warn" },
        { title: "Data warning 2", body: "MYOB sync: " + RUN_ERROR, tone: "warn" },
      ],
    );
    assert.ok(!body.data.alerts.some((alert) => alert.title === "No alerts"));
  });
});

test("every live getter's envelope carries the warnings", async () => {
  await withServer(async (base) => {
    for (const route of ["functions", "departments", "lanes", "entities", "sources"]) {
      const { status, body } = await requestJson(base, `/api/command-centre/${route}`);
      assert.equal(status, 200, route);
      assert.equal(body.meta.warnings.length, 2, route);
    }
  });
});

// Staleness is a derivation concern once the service has flagged it: the live
// freshness entry must read Stale/bad (not the generic Check/warn).
test("buildLiveModel marks the freshness entry Stale when the cache is stale", () => {
  const meta = { dataSource: "live-cache", sourcePath: "x", generated_at: GENERATED_AT };
  const staleWarning = "MYOB GL cache is stale — last extract 2026-06-30 is older than 48h";
  const model = buildLiveModel(LIVE_GL_DOC, meta, { warnings: [staleWarning], stale: true });
  assert.deepEqual(model.freshnessEntry, { name: "MYOB live GL cache", status: "Stale", tone: "bad" });
  assert.equal(model.overviewKpis[3].value, "Watch");
  assert.deepEqual(model.meta.warnings, [staleWarning]);
});

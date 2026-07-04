// Failed-sync write protection: a THROWING JournalTransaction fetch must not
// overwrite the journal-derived caches (live-gl, CMF, department report,
// benefits, drilldowns) with empty "live" docs, while an empty-but-successful
// pull (quiet ledger) still writes. Dirs point at a temp workspace BEFORE the
// config loads; myobClient is stubbed at the module boundary, so no test here
// ever touches the network.
const fs = require("fs");
const os = require("os");
const path = require("path");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "myob-sync-run-test-"));
const cacheDir = path.join(tempRoot, "myob-cache");
const dashboardsDir = path.join(tempRoot, "dashboards");
fs.mkdirSync(cacheDir, { recursive: true });
fs.mkdirSync(dashboardsDir, { recursive: true });
process.env.CFO_DATA_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.MYOB_CACHE_DIR = cacheDir;
process.env.DASHBOARDS_DIR = dashboardsDir;

const test = require("node:test");
const assert = require("node:assert");
const { setTimeout: delay } = require("node:timers/promises");

const myobClient = require("../src/lib/myobClient");
const sync = require("../src/services/myobSyncService");

const RAW_ACCOUNTS = [
  { AccountCD: { value: "703430" }, Description: { value: "Local church evangelism" }, Type: { value: "Expense" } },
];

const LIVE_GL_LATEST = path.join(cacheDir, "live-gl", "myob-live-gl-latest.json");
const CMF_LATEST = path.join(cacheDir, "cmf-cash", "myob-cmf-cash-latest.json");
const DEPARTMENTS = path.join(dashboardsDir, "department-budget-myob-data.json");
const BENEFITS = path.join(cacheDir, "morpheus-benefits-312510", "morpheus-benefits-312510-cache.json");
const PROBE_LATEST = path.join(cacheDir, "cash-position", "myob-cash-endpoint-probe-latest.json");

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, "utf8"));

function writeSentinel(filePath, name) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify({ sentinel: name }));
}

// The session never logs in: withSession just hands the stub base through, and
// the probe answers 200 with no rows for every endpoint.
myobClient.withSession = async (fn) => fn({ base: "https://example/entity/Default/23.200.001" });
myobClient.getEntity = async () => ({ ok: true, status: 200, rows: [] });

async function runSync() {
  const { started } = sync.startSync();
  assert.equal(started, true);
  for (let i = 0; i < 500; i++) {
    if (!sync.getStatus().data.running) return sync.getStatus().data.last_run;
    await delay(10);
  }
  throw new Error("sync run did not finish in time");
}

test("a throwing JournalTransaction fetch leaves journal-derived caches untouched", async () => {
  writeSentinel(LIVE_GL_LATEST, "live-gl");
  writeSentinel(CMF_LATEST, "cmf");
  writeSentinel(DEPARTMENTS, "departments");
  writeSentinel(BENEFITS, "benefits");
  myobClient.pagedFetch = async (session, entity) => {
    if (entity === "JournalTransaction") throw new Error("HTTP 500 from MYOB");
    if (entity === "Account") return RAW_ACCOUNTS;
    return [];
  };

  const run = await runSync();
  assert.equal(run.ok, false);
  assert.ok(run.errors.some((message) => message.startsWith("JournalTransaction: HTTP 500")));
  assert.ok(run.errors.includes("JournalTransaction fetch failed; journal-derived caches left untouched"));
  assert.deepEqual(run.counts.skipped_writes, ["live-gl", "cmf-cash", "departments", "benefits", "account-drilldowns"]);

  // journal-derived docs keep the previous good contents
  assert.deepEqual(readJson(LIVE_GL_LATEST), { sentinel: "live-gl" });
  assert.deepEqual(readJson(CMF_LATEST), { sentinel: "cmf" });
  assert.deepEqual(readJson(DEPARTMENTS), { sentinel: "departments" });
  assert.deepEqual(readJson(BENEFITS), { sentinel: "benefits" });

  // the journal-independent probe doc still refreshes
  assert.ok(readJson(PROBE_LATEST).generated_at);
});

test("a custom window overrides the from-date and bounds the journal fetch", async () => {
  let journalOpts = null;
  writeSentinel(LIVE_GL_LATEST, "canonical-live-gl");
  myobClient.pagedFetch = async (session, entity, opts) => {
    if (entity === "JournalTransaction") {
      journalOpts = opts;
      return [];
    }
    if (entity === "Account") return RAW_ACCOUNTS;
    return [];
  };

  const { started } = sync.startSync({ fromDate: "2025-01-01", toDate: "2025-06-30" });
  assert.equal(started, true);
  for (let i = 0; i < 500; i++) {
    if (!sync.getStatus().data.running) break;
    await delay(10);
  }

  assert.ok(journalOpts, "JournalTransaction fetch was invoked");
  assert.equal(
    journalOpts.filter,
    "TransactionDate ge datetimeoffset'2025-01-01' and TransactionDate le datetimeoffset'2025-06-30'"
  );

  assert.deepEqual(readJson(LIVE_GL_LATEST), { sentinel: "canonical-live-gl" });
  const windowFile = path.join(cacheDir, "live-gl", "windows", "myob-live-gl-2025-01-01_to_2025-06-30.json");
  const liveGl = readJson(windowFile);
  assert.equal(liveGl.from_date, "2025-01-01");
  assert.equal(liveGl.to_date, "2025-06-30");

  const run = sync.getStatus().data.last_run;
  assert.equal(run.from_date, "2025-01-01");
  assert.equal(run.to_date, "2025-06-30");
  assert.equal(run.counts.window_cache, path.join("live-gl", "windows", "myob-live-gl-2025-01-01_to_2025-06-30.json"));
  assert.ok(run.counts.skipped_writes.includes("shared-live-gl"));
});

test("an open-ended pull leaves the journal fetch unbounded (no le clause)", async () => {
  let journalOpts = null;
  myobClient.pagedFetch = async (session, entity, opts) => {
    if (entity === "JournalTransaction") {
      journalOpts = opts;
      return [];
    }
    if (entity === "Account") return RAW_ACCOUNTS;
    return [];
  };

  await runSync();
  assert.ok(journalOpts);
  assert.ok(!journalOpts.filter.includes(" le "), "no upper bound on an open-ended pull");
  assert.match(journalOpts.filter, /^TransactionDate ge datetimeoffset'/);
});

test("an empty-but-successful journal pull (quiet ledger) still writes every cache", async () => {
  myobClient.pagedFetch = async (session, entity) => {
    if (entity === "Account") return RAW_ACCOUNTS;
    return []; // JournalTransaction included: fetched fine, genuinely no rows
  };

  const run = await runSync();
  assert.equal(run.ok, true);
  assert.equal(run.counts.skipped_writes, undefined);

  const liveGl = readJson(LIVE_GL_LATEST);
  assert.ok(liveGl.generated_at);
  assert.deepEqual(liveGl.journal_lines, []);

  const departments = readJson(DEPARTMENTS);
  assert.equal(departments.period_context.source_kind, "myob_live_gl_cache");
  assert.deepEqual(departments.period_context.source_errors, []);
  assert.equal(departments.period_context.confidence, "high");
});

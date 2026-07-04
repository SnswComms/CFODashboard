// Live-cache mode: with MYOB_CACHE_DIR pointing at a temp dir containing a
// small live-gl extract, the command-centre figures must be derived from the
// GL lines (budgets stay board-approved constants).

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Point the backend at a temp MYOB cache BEFORE anything requires config —
// the config module snapshots env at require time.
const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-live-gl-"));
process.env.MYOB_CACHE_DIR = cacheDir;
process.env.MYOB_URL = "";
process.env.MYOB_USERNAME = "";
process.env.MYOB_PASSWORD = "";
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.MONGODB_URI = "";
// Copilot answers asserted below are the deterministic ones — keep the LLM
// path off so the suite never touches the network.
process.env.COPILOT_LLM_DISABLED = "1";
// The fixture below is pinned to 2026-06-30; disable the staleness check so
// the clean-health assertions hold whatever the real clock says.
process.env.MYOB_STALE_AFTER_HOURS = "876000";

const test = require("node:test");
const assert = require("node:assert/strict");

const { withServer, requestJson } = require("./helper");

const GENERATED_AT = "2026-06-30T00:00:00+00:00";

// Six journal lines across two branches: SNC (conference) and AAV.
// Expense: Evangelism 12,000 - 2,000 refund = 10,000 (EVA), Field 200,000
// (FLD), President travel 4,000 (ADM), AAV catering 50,000 (AAV branch).
// Income: 300,000 tithe (SNC) + 80,000 AAV.
const LIVE_GL_DOC = {
  generated_at: GENERATED_AT,
  source: "test extract",
  from_date: "2026-01-01",
  accounts: [
    { AccountCD: "703430", Description: "Local church evangelism", AccountClass: "EXPENSE", Type: "Expense", Active: true },
    { AccountCD: "601000", Description: "Wages taxable", AccountClass: "EXPENSE", Type: "Expense", Active: true },
    { AccountCD: "702000", Description: "President travel", AccountClass: "EXPENSE", Type: "Expense", Active: true },
    { AccountCD: "801000", Description: "AAV catering", AccountClass: "EXPENSE", Type: "Expense", Active: true },
    { AccountCD: "405000", Description: "Tithe income", AccountClass: "INCOME", Type: "Income", Active: true },
    { AccountCD: "401000", Description: "AAV income", AccountClass: "INCOME", Type: "Income", Active: true },
  ],
  journal_lines: [
    { kind: "JournalTransaction", date: "2026-01-15", period: "012026", branch: "SNC", account: "703430", account_description: "Local church evangelism", subaccount: "EVA-000", line_description: "Evangelism supplies", debit: 12000, credit: 0, net_debit: 12000 },
    { kind: "JournalTransaction", date: "2026-02-10", period: "022026", branch: "SNC", account: "703430", account_description: "Local church evangelism", subaccount: "EVA-000", line_description: "Evangelism refund", debit: 0, credit: 2000, net_debit: -2000 },
    { kind: "JournalTransaction", date: "2026-03-01", period: "032026", branch: "SNC", account: "601000", account_description: "Wages taxable", subaccount: "FLD-100", line_description: "Field payroll", debit: 200000, credit: 0, net_debit: 200000 },
    { kind: "JournalTransaction", date: "2026-03-20", period: "032026", branch: "SNC", account: "702000", account_description: "President travel", subaccount: "ADM-000", line_description: "President travel to division meetings", debit: 4000, credit: 0, net_debit: 4000 },
    { kind: "JournalTransaction", date: "2026-04-05", period: "042026", branch: "AAV", account: "801000", account_description: "AAV catering", subaccount: "AAV-000", line_description: "Catering supplies", debit: 50000, credit: 0, net_debit: 50000 },
    { kind: "JournalTransaction", date: "2026-05-31", period: "052026", branch: "SNC", account: "405000", account_description: "Tithe income", subaccount: "ADM-000", line_description: "Tithe received", debit: 0, credit: 300000, net_debit: -300000 },
    { kind: "JournalTransaction", date: "2026-05-31", period: "052026", branch: "AAV", account: "401000", account_description: "AAV income", subaccount: "AAV-000", line_description: "Guest revenue", debit: 0, credit: 80000, net_debit: -80000 },
    // Stray prior-FY-period adjustment (zero-value): its period-12 month must
    // NOT stretch trend.as_of_month past the extract month (see derivation).
    { kind: "JournalTransaction", date: "2026-02-01", period: "122025", branch: "SNC", account: "702000", account_description: "President travel", subaccount: "ADM-000", line_description: "Prior period adjustment", debit: 0, credit: 0, net_debit: 0 },
  ],
  bill_lines: [
    // Evidence only — must NOT count toward actuals.
    { kind: "Bill", date: "2026-01-25", period: "012026", branch: "SNC", account: "703430", account_description: "Local church evangelism", subaccount: "EVA-000", line_description: "Evangelism bill", debit: 99999, credit: 0, net_debit: 99999 },
  ],
};

test.before(() => {
  const glDir = path.join(cacheDir, "live-gl");
  fs.mkdirSync(glDir, { recursive: true });
  fs.writeFileSync(path.join(glDir, "myob-live-gl-latest.json"), JSON.stringify(LIVE_GL_DOC, null, 2));
});

test.after(() => {
  fs.rmSync(cacheDir, { recursive: true, force: true });
});

function assertLiveMeta(body) {
  assert.equal(body.meta.dataSource, "live-cache");
  assert.ok(String(body.meta.sourcePath).includes("myob-live-gl-latest.json"));
  assert.equal(body.meta.generated_at, GENERATED_AT);
  assert.equal(body.data.generated_at, GENERATED_AT);
}

function writeWindowCache(fromDate, toDate, doc) {
  const file = path.join(cacheDir, "live-gl", "windows", `myob-live-gl-${fromDate}_to_${toDate}.json`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(doc, null, 2));
  return file;
}

test("GET /functions derives spent from GL expense lines by subaccount prefix", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/functions");
    assert.equal(status, 200);
    assertLiveMeta(body);

    const byName = Object.fromEntries(body.data.functions.map((fn) => [fn.name, fn]));
    // Evangelism: 12,000 debit - 2,000 credit refund (journals only, no bills).
    assert.deepEqual(byName["Evangelism"], {
      name: "Evangelism",
      budget: 62000,
      used_pct: 16,
      spent: 10000,
      remaining: 52000,
      status: "ok",
    });
    assert.equal(byName["Field"].spent, 200000);
    assert.equal(byName["Field"].used_pct, Math.round((200000 / 3177120) * 100));
    assert.equal(byName["Administration"].spent, 4000);
    assert.equal(byName["Adventist Alpine Village"].spent, 50000);
    // Departments with no GL activity read zero, not the design percentages.
    assert.equal(byName["Big Camp"].spent, 0);
    assert.equal(byName["Properties"].status, "ok");

    // KPIs and composition recomputed from derived YTD totals.
    assert.equal(body.data.kpis[0].value, "$380K"); // income 300k + 80k
    assert.equal(body.data.kpis[1].value, "$264K"); // expense 10k+200k+4k+50k
    assert.equal(body.data.kpis[2].value, "$116K");
    assert.equal(body.data.kpis[2].tone, "good");
    assert.equal(body.data.kpis[3].value, "0");
    assert.deepEqual(body.data.composition.map((c) => c.spent), [380000, 264000]);
    assert.equal(body.data.monthly.length, 12);
    assert.deepEqual(body.data.monthly[0], { month: 1, label: "Jan", income: 0, expense: 12000, net: -12000 });
    assert.deepEqual(body.data.monthly[1], { month: 2, label: "Feb", income: 0, expense: -2000, net: 2000 });
    assert.deepEqual(body.data.monthly[4], { month: 5, label: "May", income: 380000, expense: 0, net: 380000 });
    assert.deepEqual(body.data.monthly[5], { month: 6, label: "Jun", income: null, expense: null, net: null });
    // 30 June = 180 of 365 days elapsed in FY2026.
    assert.deepEqual(body.data.period, { label: "FY2026 to date", elapsed_pct: 49 });
  });
});

test("GET /departments derives parent spend and keeps line math on parent used_pct", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/departments");
    assert.equal(status, 200);
    assertLiveMeta(body);

    const field = body.data.departments.find((dept) => dept.name === "Field");
    assert.equal(field.spent, 200000);
    assert.equal(field.used_pct, 6);
    assert.equal(field.status, "ok");
    const wages = field.lines.find((line) => line.line === "Wages Taxable");
    // Contract §3: line spent uses the PARENT department's used_pct.
    assert.equal(wages.spent, Math.round((1064871 * 6) / 100));
    assert.equal(wages.remaining, 1064871 - wages.spent);

    const evangelism = body.data.departments.find((dept) => dept.name === "Evangelism");
    assert.equal(evangelism.spent, 10000);
    assert.equal(evangelism.used_pct, 16);

    // Additive live-only labelling: real period + provenance caption.
    assert.deepEqual(body.data.period, { label: "FY2026 to date", elapsed_pct: 49 });
    assert.ok(body.data.source_note.includes("2026-06-30"));
    assert.ok(body.data.source_note.startsWith("Live MYOB GL actuals to "));
  });
});

test("GET /entities groups GL income/expense by branch", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/entities");
    assert.equal(status, 200);
    assertLiveMeta(body);

    assert.deepEqual(body.data.entities, [
      { name: "SDA Church (SNSW) Ltd", scope: "Conference operations", income: 300000, expense: 214000, net: 86000 },
      { name: "Adventist Alpine Village", scope: "Commercial · hospitality", income: 80000, expense: 50000, net: 30000 },
    ]);
    assert.deepEqual(body.data.total, { income: 380000, expense: 264000, net: 116000 });
  });
});

test("GET /overview recomputes KPIs and reflects the cache in freshness", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/overview");
    assert.equal(status, 200);
    assertLiveMeta(body);

    assert.equal(body.data.kpis.length, 4);
    assert.equal(body.data.kpis[0].value, "$116K");
    assert.equal(body.data.kpis[0].tone, "good");
    assert.equal(body.data.kpis[1].eyebrow, "Approved surplus · FY26"); // board constant
    assert.deepEqual(body.data.kpis[2], {
      eyebrow: "Functions over budget",
      value: "0",
      note: "None",
      tone: "good",
      // Real per-month series (one entry per active month) backing the card's
      // sparkline; the fixture has no function over budget in any month.
      spark: [0, 0, 0, 0, 0],
    });
    // Net KPI carries the cumulative monthly net series for its sparkline.
    assert.deepEqual(body.data.kpis[0].spark.length, 5);
    assert.equal(body.data.kpis[0].spark[4], 116000);
    // Clean sync (no cache errors, no failed run, not stale): data health
    // reads Live/good and meta.warnings is empty.
    assert.equal(body.data.kpis[3].value, "Live");
    assert.equal(body.data.kpis[3].tone, "good");
    assert.deepEqual(body.meta.warnings, []);

    // Backward-compatible payload: original fields intact, live fields added.
    assert.equal(body.data.dash_cards.length, 8);
    // Live mode derives alerts; no overs/tights/warnings in this fixture, so
    // the single all-clear card replaces the three design alerts.
    assert.deepEqual(body.data.alerts, [
      {
        title: "No alerts",
        body: "All functions at or under elapsed-year pace and the MYOB sync is healthy.",
        tone: "good",
      },
    ]);
    const live = body.data.freshness.find((f) => f.name === "MYOB live GL cache");
    assert.deepEqual(live, { name: "MYOB live GL cache", status: "Current", tone: "good" });
    assert.deepEqual(body.data.totals, { income: 380000, expense: 264000, net: 116000 });
    assert.equal(body.data.approved_totals.income, 8032932);
    assert.equal(body.data.trend.as_of_month, 5);
    const may = body.data.trend.months[4];
    assert.deepEqual(may, { month: 5, income: 380000, expense: 264000 });
    assert.deepEqual(body.data.trend.months[5], { month: 6, income: null, expense: null });
  });
});

test("GET /sources serves extract-derived evidence and appends the live cache to freshness", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/sources");
    assert.equal(status, 200);
    assertLiveMeta(body);
    // Evidence rows describe the fixture extract itself (the fixture has no
    // to_date, so the window's end renders as "?").
    assert.deepEqual(body.data.evidence, [
      {
        label: "MYOB accounts cached",
        value: "6",
        basis: "Live GL cache · Account endpoint (this extract)",
        confidence: "High",
      },
      {
        label: "Journal lines in live GL cache",
        value: "8",
        basis: "JournalTransaction extract 2026-01-01 → ?",
        confidence: "High",
      },
      {
        label: "Extract timestamp",
        value: "2026-06-30",
        basis: "myob-live-gl-latest.json · 6-hourly sync",
        confidence: "High",
      },
    ]);
    const live = body.data.freshness.find((f) => f.name === "MYOB live GL cache");
    assert.deepEqual(live, { name: "MYOB live GL cache", status: "Current", tone: "good", note: "Extracted 2026-06-30" });
  });
});

test("GET /lanes serves live-derived spend with matched-GL-line evidence", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/lanes");
    assert.equal(status, 200);
    assertLiveMeta(body);

    const byId = Object.fromEntries(body.data.lanes.map((lane) => [lane.id, lane]));
    // Evangelism: 12,000 debit - 2,000 credit refund, both journal lines cited.
    assert.equal(byId.evangelism.spent, 10000);
    assert.equal(byId.evangelism.remaining, 52000);
    assert.equal(byId.evangelism.match_count, 2);
    assert.deepEqual(byId.evangelism.matched_lines, [
      { date: "2026-01-15", account: "703430", description: "Evangelism supplies", amount: 12000 },
      { date: "2026-02-10", account: "703430", description: "Evangelism refund", amount: -2000 },
    ]);
    // President: the haystack includes the ADMINISTRATION department name and
    // the account description, so the travel line AND the zero-value prior
    // period adjustment both count as evidence (spent unchanged at 4,000).
    assert.equal(byId.president.spent, 4000);
    assert.equal(byId.president.match_count, 2);
    assert.deepEqual(byId.president.matched_lines.map((line) => line.amount), [4000, 0]);
    // Youth: no GL activity in the fixture — zero spent, zero evidence.
    assert.equal(byId.youth.spent, 0);
    assert.equal(byId.youth.match_count, 0);
    assert.deepEqual(byId.youth.matched_lines, []);
  });
});

test("POST /copilot cites live-derived lane and function figures", async () => {
  await withServer(async (base) => {
    const lane = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "Can we afford a $5,000 evangelism request?" }] },
    });
    assert.equal(lane.status, 200);
    assert.equal(lane.body.meta.dataSource, "live-cache");
    assert.deepEqual(lane.body.data.matched, { kind: "lane", id: "evangelism" });
    assert.match(lane.body.data.answer, /\$10,000 spent/); // derived, not the design 44,020
    assert.match(lane.body.data.answer, /leaving \$52,000/);
    assert.match(lane.body.data.answer, /would leave \$47,000/);
    assert.match(lane.body.data.answer, /likely affordable/i);

    const fn = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "How is Field tracking this year?" }] },
    });
    assert.deepEqual(fn.body.data.matched, { kind: "function", id: "Field" });
    assert.match(fn.body.data.answer, /\$200,000/);
    assert.match(fn.body.data.answer, /6% used/);

    const watch = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "Which functions are most at risk of overspending?" }] },
    });
    assert.deepEqual(watch.body.data.matched, { kind: "watchlist", id: null });
    assert.match(watch.body.data.answer, /No functions are at risk/);

    // Youth has no matching GL lines in the fixture (match_count 0), so the
    // lane verdict carries the unverified-spend caveat.
    const youth = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "Can Youth absorb a $3,000 request?" }] },
    });
    assert.deepEqual(youth.body.data.matched, { kind: "lane", id: "youth" });
    assert.match(youth.body.data.answer, /spent figure is unverified — check source/);

    const coverage = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "How far back can /decisions pull MYOB previous data?" }] },
    });
    assert.equal(coverage.status, 200);
    assert.equal(coverage.body.meta.dataSource, "live-cache");
    assert.deepEqual(coverage.body.data.matched, { kind: "general", id: null });
    assert.match(coverage.body.data.answer, /reads the live MYOB GL cache from 2026-01-01 to 2026-06-30/);
    assert.match(coverage.body.data.answer, /8 journal lines cached/);
    assert.match(coverage.body.data.answer, /Prior financial years are not available/);
    assert.match(coverage.body.data.answer, /read-only to backfill older JournalTransaction windows/);

    const status = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "What is the MYOB sync status?" }] },
    });
    assert.equal(status.status, 200);
    assert.match(status.body.data.answer, /No MYOB sync run has been recorded/);
    assert.match(status.body.data.answer, /live MYOB GL cache from 2026-01-01 to 2026-06-30/);

    const refresh = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "Refresh MYOB from the API now" }] },
    });
    assert.equal(refresh.status, 200);
    assert.match(refresh.body.data.answer, /cannot start a MYOB sync because MYOB_URL, MYOB_USERNAME or MYOB_PASSWORD is not fully configured/);
    assert.match(refresh.body.data.answer, /live MYOB GL cache from 2026-01-01 to 2026-06-30/);
  });
});

test("date range filters live command-centre figures and copilot grounding", async () => {
  await withServer(async (base) => {
    const qs = "range=month&from_date=2026-03-01&to_date=2026-03-31";
    const functions = await requestJson(base, `/api/command-centre/functions?${qs}`);
    assert.equal(functions.status, 200);
    assertLiveMeta(functions.body);
    assert.deepEqual(functions.body.data.period, {
      label: "This month",
      elapsed_pct: 25,
      from_date: "2026-03-01",
      to_date: "2026-03-31",
    });
    const byName = Object.fromEntries(functions.body.data.functions.map((fn) => [fn.name, fn]));
    assert.equal(byName["Field"].spent, 200000);
    assert.equal(byName["Administration"].spent, 4000);
    assert.equal(byName["Evangelism"].spent, 0);
    assert.equal(functions.body.data.kpis[0].value, "$0K");
    assert.equal(functions.body.data.kpis[1].value, "$204K");
    assert.equal(functions.body.data.kpis[2].value, "($204K)");
    assert.deepEqual(functions.body.data.monthly[1], { month: 2, label: "Feb", income: null, expense: null, net: null });
    assert.deepEqual(functions.body.data.monthly[2], { month: 3, label: "Mar", income: 0, expense: 204000, net: -204000 });
    assert.deepEqual(functions.body.data.monthly[3], { month: 4, label: "Apr", income: null, expense: null, net: null });

    const overview = await requestJson(base, `/api/command-centre/overview?${qs}`);
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.kpis[0].value, "($204K)");
    assert.deepEqual(overview.body.data.totals, { income: 0, expense: 204000, net: -204000 });
    assert.equal(overview.body.data.trend.as_of_month, 3);
    assert.deepEqual(overview.body.data.trend.months[2], { month: 3, income: 0, expense: 204000 });

    const sources = await requestJson(base, `/api/command-centre/sources?${qs}`);
    assert.equal(sources.status, 200);
    assert.equal(sources.body.data.evidence[1].value, "2");
    assert.equal(sources.body.data.evidence[1].basis, "JournalTransaction extract 2026-03-01 → 2026-03-31");

    const copilot = await requestJson(base, `/api/command-centre/copilot?${qs}`, {
      method: "POST",
      body: { messages: [{ role: "user", content: "How is Field tracking this month?" }] },
    });
    assert.equal(copilot.status, 200);
    assert.deepEqual(copilot.body.data.matched, { kind: "function", id: "Field" });
    assert.match(copilot.body.data.answer, /\$200,000/);
    assert.match(copilot.body.data.answer, /6% used/);
  });
});

test("exact date range prefers an isolated window cache over the shared latest cache", async () => {
  const windowDoc = {
    ...LIVE_GL_DOC,
    generated_at: "2026-03-31T00:00:00+00:00",
    from_date: "2026-03-01",
    to_date: "2026-03-31",
    journal_lines: [
      { kind: "JournalTransaction", date: "2026-03-15", period: "032026", branch: "SNC", account: "703430", account_description: "Local church evangelism", subaccount: "EVA-000", line_description: "March evangelism", debit: 7777, credit: 0, net_debit: 7777 },
    ],
  };
  const file = writeWindowCache("2026-03-01", "2026-03-31", windowDoc);

  await withServer(async (base) => {
    const qs = "range=month&from_date=2026-03-01&to_date=2026-03-31";
    const { status, body } = await requestJson(base, `/api/command-centre/functions?${qs}`);
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "live-cache");
    assert.equal(body.meta.sourcePath, file);
    assert.equal(body.data.generated_at, "2026-03-31T00:00:00+00:00");
    assert.equal(body.data.kpis[1].value, "$8K");
    const byName = Object.fromEntries(body.data.functions.map((fn) => [fn.name, fn]));
    assert.equal(byName["Evangelism"].spent, 7777);
    assert.equal(byName["Field"].spent, 0);
  });
});

test("date range warns when the requested window starts before the live cache", async () => {
  await withServer(async (base) => {
    const qs = "range=fytd&from_date=2025-07-01&to_date=2026-06-30";
    const { status, body } = await requestJson(base, `/api/command-centre/overview?${qs}`);
    assert.equal(status, 200);
    assertLiveMeta(body);
    assert.equal(body.meta.warnings.length, 1);
    assert.match(body.meta.warnings[0], /cache starts at 2026-01-01/);
    assert.match(body.meta.warnings[0], /Figures are limited to the cached extract window/);
    assert.equal(body.data.kpis[3].value, "Watch");
  });
});

test("full-year views expose cache-end coverage as a note, not a warning", async () => {
  const windowDoc = {
    ...LIVE_GL_DOC,
    generated_at: "2026-11-30T00:00:00+00:00",
    from_date: "2026-01-01",
    to_date: "2026-11-30",
  };
  writeWindowCache("2026-01-01", "2026-12-31", windowDoc);

  await withServer(async (base) => {
    const qs = "range=year&from_date=2026-01-01&to_date=2026-12-31";
    const { status, body } = await requestJson(base, `/api/command-centre/functions?${qs}`);
    assert.equal(status, 200);
    assert.equal(body.meta.dataSource, "live-cache");
    assert.deepEqual(body.meta.warnings, []);
    assert.equal(body.meta.coverage_notes.length, 1);
    assert.match(body.meta.coverage_notes[0], /current MYOB cache ends at 2026-11-30/);
  });
});

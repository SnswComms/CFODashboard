// Force synthetic mode BEFORE the app/config load: once a live sync populates
// DASHBOARDS_DIR/MYOB_CACHE_DIR (now set in .env), these views would otherwise
// read live caches. Presence of the keys prevents dotenv overrides.
process.env.CFO_DATA_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.MYOB_URL = "";
process.env.MYOB_USERNAME = "";
process.env.MYOB_PASSWORD = "";
process.env.MONGODB_URI = "";
// Pin the copilot LLM off so the suite never touches the network — copilot
// answers must come from the deterministic contract §5 path.
process.env.COPILOT_LLM_DISABLED = "1";

const test = require("node:test");
const assert = require("node:assert/strict");

const { withServer, requestJson } = require("./helper");
const service = require("../src/services/commandCentreService");

const VIEW_IDS = ["operating", "departments", "decisions", "staffing", "field", "entities", "cash", "sources"];
const FUNCTION_NAMES = [
  "Field",
  "Adventist Alpine Village",
  "Administration",
  "Youth Ministry",
  "Big Camp",
  "Ministerial",
  "Communications",
  "Faith FM",
  "Evangelism",
  "Personal Ministries",
  "Properties",
  "Other Operations",
];

function assertEnvelope(body) {
  assert.ok(body.data && typeof body.data === "object");
  assert.equal(body.meta.dataSource, "synthetic");
  assert.ok("sourcePath" in body.meta);
  assert.ok(Array.isArray(body.meta.warnings));
}

// ---- service unit tests: status thresholds ----

test("computeUsage applies over/tight/ok thresholds and contract rounding", () => {
  assert.deepEqual(service.computeUsage(3177120, 42), { spent: 1334390, remaining: 1842730, status: "ok" });
  assert.deepEqual(service.computeUsage(193620, 88), { spent: 170386, remaining: 23234, status: "tight" });
  assert.deepEqual(service.computeUsage(11300, 106), { spent: 11978, remaining: -678, status: "over" });
  assert.equal(service.computeUsage(100, 85).status, "tight"); // boundary: exactly 85% is tight
  assert.equal(service.computeUsage(100, 84).status, "ok");
});

test("laneStatus applies the design thresholds", () => {
  // after >= max(1000, 10% of budget) -> good
  assert.equal(service.laneStatus(62000, 44020, 5000).verdict, "good"); // after 12,980 >= 6,200
  // 0 <= after < threshold -> warn
  assert.equal(service.laneStatus(62000, 44020, 12000).verdict, "warn"); // after 5,980 < 6,200
  // after < 0 -> bad
  assert.equal(service.laneStatus(20000, 8600, 15000).verdict, "bad"); // after -3,600
  // small-budget lanes still need $1,000 clear
  assert.equal(service.laneStatus(5000, 0, 4100).verdict, "warn"); // after 900 < max(1000, 500)
});

test("extractAmount parses $, comma, k and m amounts", () => {
  assert.equal(service.extractAmount("can we afford a $5,000 request?"), 5000);
  assert.equal(service.extractAmount("we need about 12k for this"), 12000);
  assert.equal(service.extractAmount("a 1.5m project"), 1500000);
  assert.equal(service.extractAmount("we have 2 requests pending"), null); // bare small number ignored
  assert.equal(service.extractAmount("roughly 3500 dollars"), 3500);
});

// ---- service unit tests: copilot verdict composition ----

test("copilot lane answers carry figures and the right verdict phrase", async () => {
  const good = await service.postCopilot({ messages: [{ role: "user", content: "Can we afford a $5,000 evangelism request?" }] });
  assert.deepEqual(good.data.matched, { kind: "lane", id: "evangelism" });
  assert.match(good.data.answer, /\$62,000/);
  assert.match(good.data.answer, /\$44,020/);
  assert.match(good.data.answer, /\$17,980/);
  assert.match(good.data.answer, /\$12,980/);
  assert.match(good.data.answer, /likely affordable/i);

  const tight = await service.postCopilot({ messages: [{ role: "user", content: "Can we afford a $12,000 evangelism request?" }] });
  assert.deepEqual(tight.data.matched, { kind: "lane", id: "evangelism" });
  assert.match(tight.data.answer, /possible, but tight/i);

  const bad = await service.postCopilot({ messages: [{ role: "user", content: "The President wants a $15,000 trip to the USA" }] });
  assert.deepEqual(bad.data.matched, { kind: "lane", id: "president" });
  assert.match(bad.data.answer, /not affordable in lane/i);
  assert.match(bad.data.answer, /\$3,600/); // exceeds by |after|
});

test("copilot uses the lane default_request when no amount is given", async () => {
  const result = await service.postCopilot({ messages: [{ role: "user", content: "Faith FM needs new studio microphones" }] });
  assert.deepEqual(result.data.matched, { kind: "lane", id: "faith_fm" });
  assert.match(result.data.answer, /\$2,500/); // default_request
  assert.match(result.data.answer, /\$43,755/); // remaining 82,557 - 38,802
});

test("copilot watchlist, function and general fallbacks", async () => {
  const watch = await service.postCopilot({ messages: [{ role: "user", content: "Which functions are most at risk of overspending?" }] });
  assert.deepEqual(watch.data.matched, { kind: "watchlist", id: null });
  assert.match(watch.data.answer, /Properties/);
  assert.match(watch.data.answer, /106%/);
  assert.match(watch.data.answer, /\$678/);
  assert.match(watch.data.answer, /Big Camp/);
  assert.match(watch.data.answer, /88%/);
  assert.match(watch.data.answer, /\$23,234/);

  const fn = await service.postCopilot({ messages: [{ role: "user", content: "How is Communications tracking this year?" }] });
  assert.deepEqual(fn.data.matched, { kind: "function", id: "Communications" });
  assert.match(fn.data.answer, /\$99,200/);
  assert.match(fn.data.answer, /51% used/);

  const general = await service.postCopilot({ messages: [{ role: "user", content: "hello there" }] });
  assert.deepEqual(general.data.matched, { kind: "general", id: null });
  assert.match(general.data.answer, /\$8,032,932/);
  assert.match(general.data.answer, /\$7,896,544/);
  assert.match(general.data.answer, /\$136,388/);
});

test("copilot never states a cash-on-hand figure", async () => {
  const result = await service.postCopilot({ messages: [{ role: "user", content: "What is our cash on hand right now?" }] });
  assert.ok(!/cash on hand of \$/i.test(result.data.answer));
  assert.deepEqual(result.data.matched, { kind: "general", id: null });
});

test("copilot answers MYOB history coverage questions without guessing", async () => {
  const result = await service.postCopilot({
    messages: [{ role: "user", content: "How long can /decisions get from MYOB? Can it pull previous data?" }],
  });
  assert.deepEqual(result.data.matched, { kind: "general", id: null });
  assert.match(result.data.answer, /no live MYOB GL cache configured/i);
  assert.match(result.data.answer, /Prior financial years are not available/i);
  assert.match(result.data.answer, /read-only to backfill older JournalTransaction windows/i);
  assert.match(result.data.answer, /until that backfill is complete \/decisions should treat previous-year data as unavailable/i);
});

test("copilot reports MYOB sync status and refuses refresh without configuration", async () => {
  const status = await service.postCopilot({
    messages: [{ role: "user", content: "What is the MYOB API sync status?" }],
  });
  assert.deepEqual(status.data.matched, { kind: "general", id: null });
  assert.match(status.data.answer, /No MYOB sync run has been recorded/i);
  assert.match(status.data.answer, /no live MYOB GL cache configured/i);

  const refresh = await service.postCopilot({
    messages: [{ role: "user", content: "Please refresh MYOB from the API" }],
  });
  assert.deepEqual(refresh.data.matched, { kind: "general", id: null });
  assert.match(refresh.data.answer, /cannot start a MYOB sync because MYOB_CACHE_DIR or CFO_DATA_DIR is not configured/i);
});

test("copilot explains historical quarterly budget limits for prior-year Youth questions", async () => {
  const result = await service.postCopilot({
    messages: [{ role: "user", content: "how much was the budget of the youth 3 years ago for the first quarter?" }],
  });
  assert.deepEqual(result.data.matched, { kind: "general", id: null });
  assert.match(result.data.answer, /Youth Ministry FY2023 Q1 \(2022-07-01 to 2022-09-30\)/);
  assert.match(result.data.answer, /JournalTransaction backfill provides actuals, not budget authority/i);
  assert.match(result.data.answer, /MYOB Budget entity is unavailable server-side/i);
  assert.match(result.data.answer, /does not currently have budget rows for FY2023/i);
  assert.match(result.data.answer, /If you want the Q1 actual spend instead/i);
});

test("copilot serves the deterministic answer when the LLM path is disabled", async () => {
  // COPILOT_LLM_DISABLED=1 is pinned above, so the LLM hop must be skipped
  // entirely and the exact contract §5 wording returned — no network involved.
  const config = require("../src/config");
  assert.equal(config.copilot.llmEnabled, false);
  const result = await service.postCopilot({ messages: [{ role: "user", content: "Can we afford a $5,000 evangelism request?" }] });
  assert.deepEqual(result.data.matched, { kind: "lane", id: "evangelism" });
  assert.match(result.data.answer, /likely affordable, but flag it for restricted-funding checks/i);
  assert.equal(result.meta.dataSource, "synthetic");
});

// ---- endpoint tests ----

test("GET /api/command-centre/overview returns kpis, dash cards, alerts and freshness", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/overview");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.equal(body.data.generated_at, "2026-05-31T10:00:00");
    assert.equal(body.data.kpis.length, 4);
    for (const kpi of body.data.kpis) {
      for (const key of ["eyebrow", "value", "note", "tone"]) assert.ok(key in kpi);
      assert.ok(["good", "warn", "bad", "neutral"].includes(kpi.tone));
    }
    assert.deepEqual(body.data.dash_cards.map((card) => card.id), VIEW_IDS);
    assert.equal(body.data.alerts.length, 3);
    assert.equal(body.data.freshness.length, 4);
    assert.equal(body.data.kpis[0].value, "($139K)");
  });
});

test("GET /api/command-centre/functions returns all 12 functions with derived math", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/functions");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.deepEqual(body.data.period, { label: "FY2026 to date", elapsed_pct: 42 });
    assert.equal(body.data.kpis.length, 4);
    assert.equal(body.data.composition.length, 2);
    assert.equal(typeof body.data.observation, "string");
    assert.equal(body.data.monthly.length, 12);
    assert.deepEqual(body.data.monthly[0], { month: 1, label: "Jan", income: 591120, expense: 616140, net: -25020 });
    assert.deepEqual(body.data.monthly[4], { month: 5, label: "May", income: 722480, expense: 753060, net: -30580 });
    assert.deepEqual(body.data.monthly[5], { month: 6, label: "Jun", income: null, expense: null, net: null });
    assert.deepEqual(body.data.functions.map((fn) => fn.name), FUNCTION_NAMES);
    for (const fn of body.data.functions) {
      assert.equal(fn.spent, Math.round((fn.budget * fn.used_pct) / 100));
      assert.equal(fn.remaining, fn.budget - fn.spent);
      assert.equal(fn.status, fn.remaining < 0 ? "over" : fn.used_pct >= 85 ? "tight" : "ok");
    }
    const properties = body.data.functions.find((fn) => fn.name === "Properties");
    assert.deepEqual(properties, { name: "Properties", budget: 11300, used_pct: 106, spent: 11978, remaining: -678, status: "over" });
    const bigCamp = body.data.functions.find((fn) => fn.name === "Big Camp");
    assert.equal(bigCamp.status, "tight");
  });
});

test("GET /api/command-centre/departments returns 12 departments with line math on parent used_pct", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/departments");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.deepEqual(body.data.departments.map((dept) => dept.name), FUNCTION_NAMES);
    const field = body.data.departments[0];
    assert.equal(field.budget, 3177120);
    assert.equal(field.spent, 1334390);
    assert.equal(field.remaining, 1842730);
    assert.equal(field.status, "ok");
    assert.equal(field.lines.length, 10);
    const wages = field.lines[0];
    assert.deepEqual(wages, { line: "Wages Taxable", budget: 1064871, spent: 447246, remaining: 617625 });
    for (const dept of body.data.departments) {
      for (const line of dept.lines) {
        assert.equal(line.spent, Math.round((line.budget * dept.used_pct) / 100));
        assert.equal(line.remaining, line.budget - line.spent);
      }
    }
  });
});

test("GET /api/command-centre/lanes returns the four lanes with remaining computed", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/lanes");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.deepEqual(body.data.lanes.map((lane) => lane.id), ["evangelism", "faith_fm", "president", "youth"]);
    for (const lane of body.data.lanes) {
      for (const key of ["id", "title", "hint", "budget", "spent", "remaining", "default_request"]) assert.ok(key in lane);
      assert.equal(lane.remaining, lane.budget - lane.spent);
    }
    const evangelism = body.data.lanes[0];
    assert.equal(evangelism.remaining, 17980);
    assert.equal(evangelism.default_request, 5000);
  });
});

test("GET /api/command-centre/staffing-baseline returns baseline numbers", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/staffing-baseline");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.equal(body.data.base_field, 18);
    assert.equal(body.data.base_office, 11);
    assert.equal(body.data.vacant_posts, 6);
    assert.deepEqual(body.data.defaults, { tithe: 5200000, ratio: 0.75, package: 150000 });
  });
});

test("GET /api/command-centre/field returns stats and load buckets", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/field");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.equal(body.data.stats.length, 5);
    assert.equal(body.data.load_buckets.length, 4);
    for (const bucket of body.data.load_buckets) {
      assert.equal(typeof bucket.pct, "number");
      assert.ok(["good", "warn", "bad", "muted"].includes(bucket.tone));
    }
    assert.equal(body.data.stats[0].value, "78");
    assert.equal(body.data.load_buckets[3].tone, "muted");
  });
});

test("GET /api/command-centre/entities computes nets and totals", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/entities");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.equal(body.data.entities.length, 2);
    assert.equal(body.data.entities[0].net, -601485);
    assert.equal(body.data.entities[1].net, 737873);
    assert.deepEqual(body.data.total, { income: 8032932, expense: 7896544, net: 136388 });
  });
});

test("GET /api/command-centre/sources returns evidence and freshness", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/sources");
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.equal(body.data.evidence.length, 4);
    assert.equal(body.data.freshness.length, 5);
    for (const item of body.data.evidence) assert.ok(["High", "Medium"].includes(item.confidence));
    for (const item of body.data.freshness) {
      assert.ok(["Current", "Stale", "Pending"].includes(item.status));
      assert.ok(["good", "warn", "bad"].includes(item.tone));
      assert.equal(typeof item.note, "string");
    }
    assert.equal(body.data.evidence[2].value, "($35,572)");
  });
});

test("POST /api/command-centre/copilot answers a grounded lane question", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: { messages: [{ role: "user", content: "Can we afford a $5,000 evangelism request?" }] },
    });
    assert.equal(status, 200);
    assertEnvelope(body);
    assert.deepEqual(body.data.matched, { kind: "lane", id: "evangelism" });
    assert.match(body.data.answer, /\$12,980/);
  });
});

test("POST /api/command-centre/copilot uses the last user message in a conversation", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/copilot", {
      method: "POST",
      body: {
        messages: [
          { role: "user", content: "Which functions are most at risk?" },
          { role: "assistant", content: "Properties and Big Camp." },
          { role: "user", content: "Can youth absorb another $3,000 request?" },
        ],
      },
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data.matched, { kind: "lane", id: "youth" });
  });
});

test("POST /api/command-centre/copilot validation returns 400 BAD_REQUEST", async () => {
  await withServer(async (base) => {
    const badBodies = [
      {},
      { messages: [] },
      { messages: "hello" },
      { messages: [{ role: "assistant", content: "hi" }] }, // no user message
      { messages: [{ role: "user" }] }, // missing content
      { messages: [{ content: "hi" }] }, // missing role
      { messages: [{ role: "user", content: "   " }] }, // empty after trim
      { messages: [{ role: "user", content: "x".repeat(4001) }] }, // too long
      { messages: Array.from({ length: 41 }, () => ({ role: "user", content: "hi" })) }, // too many
    ];
    for (const payload of badBodies) {
      const { status, body } = await requestJson(base, "/api/command-centre/copilot", { method: "POST", body: payload });
      assert.equal(status, 400, JSON.stringify(payload).slice(0, 60));
      assert.equal(body.ok, false);
      assert.equal(body.code, "BAD_REQUEST");
      assert.equal(typeof body.error, "string");
    }
  });
});

test("GET /api/command-centre/unknown falls through to the global 404", async () => {
  await withServer(async (base) => {
    const { status, body } = await requestJson(base, "/api/command-centre/unknown");
    assert.equal(status, 404);
    assert.equal(body.code, "NOT_FOUND");
  });
});

// Force degraded/synthetic mode BEFORE the app/config load. Presence of the
// keys in process.env prevents dotenv from overriding them. node --test runs
// each file in its own process, so this cannot leak into other test files.
// Nothing here touches the network, a real Mongo or the real LLM: the tool
// loop gets a fake fetch, the derivations get an injected fake db, and the
// copilot LLM stays pinned off.
process.env.MONGODB_URI = "";
process.env.CFO_DATA_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.MYOB_URL = "";
process.env.MYOB_USERNAME = "";
process.env.MYOB_PASSWORD = "";
process.env.COPILOT_LLM_DISABLED = "1";

const test = require("node:test");
const assert = require("node:assert");

const qwen = require("../src/lib/qwenClient");
const repo = require("../src/repositories/myobHistoryRepository");
const history = require("../src/services/myobHistoryService");
const service = require("../src/services/commandCentreService");

// ---------------------------------------------------------------------------
// Fakes: the accountMapping.test.js fake db ({$gte,$lte} ranges included) and
// a queue-driven fake fetch that records every request body.
// ---------------------------------------------------------------------------

function makeFakeDb() {
  const store = new Map(); // name -> { docs: [], indexes: [] }
  const state = (name) => {
    if (!store.has(name)) store.set(name, { docs: [], indexes: [] });
    return store.get(name);
  };
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return Object.entries(value).every(([op, bound]) =>
          op === "$gte" ? doc[key] >= bound : op === "$lte" ? doc[key] <= bound : false
        );
      }
      return doc[key] === value;
    });
  return {
    _store: store,
    collection(name) {
      const coll = state(name);
      return {
        async createIndex(spec, options) {
          coll.indexes.push({ spec, options });
          return options && options.name;
        },
        async updateOne(filter, update, options = {}) {
          const existing = coll.docs.find((doc) => matches(doc, filter));
          if (existing) {
            Object.assign(existing, update.$set || {});
            return { matchedCount: 1, modifiedCount: 1, upsertedCount: 0 };
          }
          if (options.upsert) {
            coll.docs.push({ _id: `id${coll.docs.length + 1}`, ...filter, ...(update.$setOnInsert || {}), ...(update.$set || {}) });
            return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1 };
          }
          return { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
        },
        async bulkWrite(ops) {
          const totals = { matchedCount: 0, modifiedCount: 0, upsertedCount: 0 };
          for (const op of ops) {
            const { filter, update, upsert } = op.updateOne;
            const result = await this.updateOne(filter, update, { upsert });
            totals.matchedCount += result.matchedCount;
            totals.modifiedCount += result.modifiedCount;
            totals.upsertedCount += result.upsertedCount;
          }
          return totals;
        },
        async findOne(filter) {
          return coll.docs.find((doc) => matches(doc, filter)) || null;
        },
        find(filter = {}) {
          const results = coll.docs.filter((doc) => matches(doc, filter)).map((doc) => ({ ...doc }));
          return {
            sort(spec = {}) {
              const [key, direction] = Object.entries(spec)[0] || [];
              if (key) results.sort((a, b) => (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) * direction);
              return { toArray: async () => results };
            },
          };
        },
      };
    },
  };
}

// Fake fetch: shifts one canned response per request and records the parsed
// request bodies so tests can assert exactly what went over the wire.
function withFakeFetch(responses) {
  const requests = [];
  const original = global.fetch;
  global.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (responses.length === 0) throw new Error("fake fetch exhausted");
    const next = responses.shift();
    const status = next.status || 200;
    return { ok: status < 400, status, text: async () => JSON.stringify(next.body) };
  };
  return { requests, restore: () => { global.fetch = original; } };
}

const choice = (message) => ({ body: { choices: [{ message }] } });
const answerMessage = (content) => ({ content });
const toolCallMessage = (name, args, id = "call_1") => ({
  content: "",
  tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
});

const CHAT = [{ role: "user", content: "hi" }];
const A_TOOL = [{ type: "function", function: { name: "fy_spend_by_function", parameters: { type: "object" } } }];

// ---------------------------------------------------------------------------
// qwenClient tool loop (fake fetch — no network)
// ---------------------------------------------------------------------------

test("chatComplete without tools keeps the pre-tools request and string contract", async () => {
  const fake = withFakeFetch([choice(answerMessage("  plain answer  "))]);
  try {
    const answer = await qwen.chatComplete({ system: "sys", messages: CHAT });
    assert.equal(answer, "plain answer");
    assert.equal(fake.requests.length, 1);
    const body = fake.requests[0].body;
    // byte-compatible payload: same keys in the same order, no tools key
    assert.deepEqual(Object.keys(body), ["model", "messages", "max_tokens", "chat_template_kwargs"]);
    assert.deepEqual(body.messages, [{ role: "system", content: "sys" }, ...CHAT]);
    assert.deepEqual(body.chat_template_kwargs, { enable_thinking: false });
  } finally {
    fake.restore();
  }
});

test("chatComplete round-trips a tool_call through the executor map", async () => {
  const fake = withFakeFetch([
    choice(toolCallMessage("fy_spend_by_function", '{"fy":"FY2025"}')),
    choice(answerMessage("FY2025 spent $150 on evangelism.")),
  ]);
  try {
    const seen = [];
    const result = { fy: "FY2025", available: true, functions: [] };
    const answer = await qwen.chatComplete({
      system: "sys",
      messages: CHAT,
      tools: A_TOOL,
      executors: { fy_spend_by_function: async (args) => { seen.push(args); return result; } },
    });
    assert.equal(answer, "FY2025 spent $150 on evangelism.");
    assert.deepEqual(seen, [{ fy: "FY2025" }]);
    // first hop carries the tool schemas
    assert.deepEqual(fake.requests[0].body.tools, A_TOOL);
    // second hop appends the assistant tool_calls turn plus the role:"tool" result
    const followUp = fake.requests[1].body.messages;
    assert.deepEqual(followUp.slice(0, 2), [{ role: "system", content: "sys" }, ...CHAT]);
    assert.equal(followUp[2].role, "assistant");
    assert.equal(followUp[2].tool_calls[0].function.name, "fy_spend_by_function");
    assert.deepEqual(followUp[3], { role: "tool", tool_call_id: "call_1", content: JSON.stringify(result) });
    assert.deepEqual(fake.requests[1].body.tools, A_TOOL); // loop keeps tools attached
  } finally {
    fake.restore();
  }
});

test("chatComplete caps the tool loop at 3 rounds, then completes without tools", async () => {
  const fake = withFakeFetch([
    choice(toolCallMessage("fy_spend_by_function", "{}", "call_1")),
    choice(toolCallMessage("fy_spend_by_function", "{}", "call_2")),
    choice(toolCallMessage("fy_spend_by_function", "{}", "call_3")),
    choice(answerMessage("plain fallback answer")),
  ]);
  try {
    const answer = await qwen.chatComplete({
      system: "sys",
      messages: CHAT,
      tools: A_TOOL,
      executors: { fy_spend_by_function: async () => ({ ok: true }) },
    });
    assert.equal(answer, "plain fallback answer");
    assert.equal(qwen.MAX_TOOL_ROUNDS, 3);
    assert.equal(fake.requests.length, 4);
    // the fallback hop is a clean no-tools completion on the ORIGINAL chat
    assert.equal(fake.requests[3].body.tools, undefined);
    assert.deepEqual(fake.requests[3].body.messages, [{ role: "system", content: "sys" }, ...CHAT]);
  } finally {
    fake.restore();
  }
});

test("malformed tool calls fall back to a plain no-tools completion", async () => {
  // unknown tool name, unparseable arguments, executor throw, HTTP 500 —
  // every malfunction path must land on the same plain retry.
  const scenarios = [
    { first: choice(toolCallMessage("no_such_tool", "{}")), executors: {} },
    { first: choice(toolCallMessage("fy_spend_by_function", "{not json")), executors: { fy_spend_by_function: async () => ({}) } },
    { first: choice(toolCallMessage("fy_spend_by_function", "{}")), executors: { fy_spend_by_function: async () => { throw new Error("boom"); } } },
    { first: { status: 500, body: { error: "down" } }, executors: {} },
  ];
  for (const scenario of scenarios) {
    const fake = withFakeFetch([scenario.first, choice(answerMessage("recovered"))]);
    try {
      const answer = await qwen.chatComplete({ messages: CHAT, tools: A_TOOL, executors: scenario.executors });
      assert.equal(answer, "recovered");
      assert.equal(fake.requests.length, 2);
      assert.equal(fake.requests[1].body.tools, undefined);
    } finally {
      fake.restore();
    }
  }
});

test("an empty answer after the tool-loop fallback still throws (deterministic fallback upstream)", async () => {
  const fake = withFakeFetch([choice(toolCallMessage("no_such_tool", "{}")), choice(answerMessage(""))]);
  try {
    await assert.rejects(
      () => qwen.chatComplete({ messages: CHAT, tools: A_TOOL, executors: {} }),
      /Qwen returned an empty answer/
    );
  } finally {
    fake.restore();
  }
});

// ---------------------------------------------------------------------------
// Historical derivations (fake db — no Mongo, no network)
// ---------------------------------------------------------------------------

// Chart in the live-gl cache's flattened shape — classification follows the
// exact classifyAccounts/lineKind rules the current-year derivation uses.
const CHART = [
  { AccountCD: "703430", Type: "Expense" },
  { AccountCD: "703460", Type: "Expense" },
  { AccountCD: "311410", Type: "Income" },
  { AccountCD: "111300", Type: "Asset" },
];

// Minimal raw history line — real docs carry the full flattened shape, but
// the derivations read only date/account/subaccount/net_debit(debit,credit).
function line(nbr, date, subaccount, fields) {
  return { module: "GL", batch: `GJ-${nbr}`, line_nbr: 1, date, subaccount, ...fields };
}

async function seedVisibleFy(db, fy) {
  const window = history.fyWindow(fy);
  await repo.upsertSyncState({ ...window, status: "complete", unmappedShare: 0 }, { db });
}

// FY2024 + FY2025 visible; FY2025 holds the interesting mix of lines.
async function seedHistory(db) {
  await seedVisibleFy(db, 2024);
  await seedVisibleFy(db, 2025);
  await repo.upsertJournalLines(
    [
      line(1, "2023-09-01", "EVA-000", { account: "703430", net_debit: 70 }), // FY2024 evangelism
      line(2, "2024-08-01", "EVA-000", { account: "703430", net_debit: 100 }), // FY2025 evangelism
      line(3, "2025-06-30", "EVA-000", { account: "703430", debit: 50, credit: 0 }), // net_debit fallback
      line(4, "2024-12-01", "ADM-000", { account: "311410", net_debit: -200 }), // income, sign-flipped
      line(5, "2024-12-01", "ADM-000", { account: "111300", net_debit: -150 }), // balance sheet, skipped
      line(6, "2025-01-15", "FAM-000", { account: "703460", net_debit: 30 }), // unmapped prefix
    ],
    { db }
  );
}

test("fySpendByFunction reuses the live derivation math and buckets Unmapped", async () => {
  const db = makeFakeDb();
  await seedHistory(db);
  const result = await history.fySpendByFunction(2025, { db, accounts: CHART });
  assert.deepEqual(result, {
    fy: "FY2025",
    available: true,
    totals: { income: 200, expense: 180, net: 20 },
    functions: [
      { functionName: "EVANGELISM", lineCount: 2, spent: 150 },
      { functionName: "Unmapped", lineCount: 1, spent: 30 },
    ],
  });
});

test("fySpendByFunction refuses gated, absent and invalid FYs with a structured result", async () => {
  const db = makeFakeDb();
  await seedHistory(db);
  // FY2026 never backfilled -> not visible
  const absent = await history.fySpendByFunction("FY2026", { db, accounts: CHART });
  assert.equal(absent.available, false);
  assert.match(absent.reason, /not in the visible history/);
  assert.deepEqual(absent.visibleFys, ["FY2024", "FY2025"]);
  // gated: complete but too much drift and not approved
  await repo.upsertSyncState({ ...history.fyWindow(2023), status: "complete", unmappedShare: 0.5 }, { db });
  const gated = await history.fySpendByFunction(2023, { db, accounts: CHART });
  assert.equal(gated.available, false);
  assert.match(gated.reason, /FY2023 is not in the visible history/);
  // invalid label never throws
  const invalid = await history.fySpendByFunction("garbage", { db, accounts: CHART });
  assert.deepEqual([invalid.fy, invalid.available], ["garbage", false]);
  assert.match(invalid.reason, /invalid financial year/);
});

test("budgetVsActual joins budget rows per account, manual winning over myob", async () => {
  const db = makeFakeDb();
  await seedHistory(db);
  // no rows yet -> structured refusal, not a throw
  const missing = await history.budgetVsActual(2025, { db, accounts: CHART });
  assert.equal(missing.available, false);
  assert.match(missing.reason, /no budget rows loaded/);

  await repo.upsertBudgets(
    [
      { fy: "FY2025", account: "703430", amount: 200, source: "manual" },
      { fy: "FY2025", account: "703430", amount: 999, source: "myob" }, // manual wins
      { fy: "FY2025", account: "999100", amount: 50, source: "manual" }, // budgeted, no activity
    ],
    { db }
  );
  const result = await history.budgetVsActual("FY2025", { db, accounts: CHART });
  assert.deepEqual(result, {
    fy: "FY2025",
    available: true,
    rows: [
      { account: "703430", source: "manual", budget: 200, actual: 150, variance: 50 },
      { account: "999100", source: "manual", budget: 50, actual: 0, variance: 50 },
    ],
    totals: { budget: 250, actual: 150, variance: 100 },
    unbudgetedActual: 230, // income 311410 (200) + unmapped expense 703460 (30)
  });
});

test("spendTrend walks the FY range, skipping non-visible years instead of interpolating", async () => {
  const db = makeFakeDb();
  await seedHistory(db);
  // case-insensitive function match; FY2023 in range but never backfilled
  const trend = await history.spendTrend("evangelism", 2023, "FY2025", { db, accounts: CHART });
  assert.deepEqual(trend, {
    functionName: "EVANGELISM",
    fromFy: "FY2023",
    toFy: "FY2025",
    available: true,
    points: [
      { fy: "FY2024", spent: 70 },
      { fy: "FY2025", spent: 150 },
    ],
    skippedFys: ["FY2023"],
  });
  // the Unmapped bucket itself is queryable
  const unmapped = await history.spendTrend("unmapped", 2025, 2025, { db, accounts: CHART });
  assert.deepEqual(unmapped.points, [{ fy: "FY2025", spent: 30 }]);

  const unknown = await history.spendTrend("Basket Weaving", 2024, 2025, { db, accounts: CHART });
  assert.equal(unknown.available, false);
  assert.match(unknown.reason, /unknown function "Basket Weaving"/);
  const inverted = await history.spendTrend("EVANGELISM", 2025, 2024, { db, accounts: CHART });
  assert.equal(inverted.available, false);
  assert.match(inverted.reason, /FY2025 is after FY2024/);
  const empty = await history.spendTrend("EVANGELISM", 2020, 2021, { db, accounts: CHART });
  assert.equal(empty.available, false);
  assert.match(empty.reason, /no visible history in that range/);
});

// ---------------------------------------------------------------------------
// Coverage facts + prompt grounding section
// ---------------------------------------------------------------------------

test("historyCoverage reports floor, visible FYs and budget coverage; null without Mongo", async () => {
  const db = makeFakeDb();
  await seedHistory(db);
  await repo.upsertBudgets([{ fy: "FY2025", account: "703430", amount: 200, source: "manual" }], { db });
  assert.deepEqual(await history.historyCoverage({ db }), {
    floorDate: "2023-07-01", // start of the oldest complete FY
    visibleFys: ["FY2024", "FY2025"],
    budgetFys: [{ fy: "FY2025", sources: ["manual"] }],
  });
  // MONGODB_URI is pinned empty -> the store is unavailable, never a throw
  assert.equal(await history.historyCoverage(), null);
});

test("copilotSystemPrompt renders the coverage section with and without history", () => {
  const coverage = {
    floorDate: "2023-07-01",
    visibleFys: ["FY2024", "FY2025"],
    budgetFys: [{ fy: "FY2025", sources: ["manual"] }],
  };
  const withHistory = service.copilotSystemPrompt(null, "det answer", coverage);
  assert.match(withHistory, /Historical data coverage: journal history is stored from 2023-07-01\./);
  assert.match(withHistory, /Prior financial years available to query: FY2024, FY2025\./);
  assert.match(withHistory, /Financial years with budget rows loaded: FY2025 \(source: manual\)\./);
  assert.match(withHistory, /state that coverage limit plainly instead of guessing/);
  // the section sits between the watchlist and the affordability rules
  assert.ok(withHistory.indexOf("Watchlist:") < withHistory.indexOf("Historical data coverage:"));
  assert.ok(withHistory.indexOf("Historical data coverage:") < withHistory.indexOf("Affordability rules"));

  const withoutHistory = service.copilotSystemPrompt(null, "det answer", null);
  assert.match(withoutHistory, /Historical data coverage: historical journal data is unavailable in this session/);
  assert.match(withoutHistory, /say plainly that historical data is unavailable/);
  // the rest of the prompt is untouched either way
  for (const prompt of [withHistory, withoutHistory]) {
    assert.match(prompt, /Board-approved FY2026 totals/);
    assert.match(prompt, /Affordability rules for a spending request against a lane/);
    assert.match(prompt, /deterministic engine reads the latest question as: "det answer"/);
  }
});

test("history tool schemas are OpenAI-format and every tool has an executor", () => {
  assert.deepEqual(
    service.HISTORY_TOOLS.map((tool) => tool.function.name),
    ["fy_spend_by_function", "budget_vs_actual", "spend_trend"]
  );
  for (const tool of service.HISTORY_TOOLS) {
    assert.equal(tool.type, "function");
    assert.equal(tool.function.parameters.type, "object");
    assert.ok(tool.function.parameters.required.length > 0);
    assert.equal(typeof service.HISTORY_TOOL_EXECUTORS[tool.function.name], "function");
  }
});

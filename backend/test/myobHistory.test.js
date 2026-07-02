// Force degraded/synthetic mode BEFORE the app/config load. Presence of the
// keys in process.env prevents dotenv from overriding them. node --test runs
// each file in its own process, so this cannot leak into other test files.
// Nothing here touches the network or a real Mongo: backfills get an injected
// fake client and fake db, and the degrade tests rely on MONGODB_URI="".
process.env.MONGODB_URI = "";
process.env.CFO_DATA_DIR = "";
process.env.MYOB_CACHE_DIR = "";
process.env.DASHBOARDS_DIR = "";
process.env.SYNTHETIC_DIR = "";
process.env.MYOB_URL = "";
process.env.MYOB_USERNAME = "";
process.env.MYOB_PASSWORD = "";

const test = require("node:test");
const assert = require("node:assert");

const repo = require("../src/repositories/myobHistoryRepository");
const history = require("../src/services/myobHistoryService");

// ---------------------------------------------------------------------------
// Fakes: enough of the mongodb driver surface for the repository's flat
// equality filters, and enough of myobClient for the backfill's two entities.
// ---------------------------------------------------------------------------

function makeFakeDb() {
  const store = new Map(); // name -> { docs: [], indexes: [] }
  const state = (name) => {
    if (!store.has(name)) store.set(name, { docs: [], indexes: [] });
    return store.get(name);
  };
  const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value);
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

// Raw entities as MYOB returns them: {value}-wrapped scalars with the
// field-name variants the flattener coalesces (same style as myobSync.test.js).
const RAW_CHART = [
  { AccountCD: { value: "703430" }, Description: { value: "Local church evangelism" } },
  { AccountCD: { value: "111300" }, Description: { value: "Cash Management Facility" } },
];

// First journal has a detail row WITHOUT LineNbr -> the whole journal falls
// back to ordinals; second journal has unique tenant LineNbrs -> kept as-is.
const RAW_JOURNALS = [
  {
    TransactionDate: { value: "2024-08-15T00:00:00+00:00" },
    BatchNbr: { value: "GJ-1001" },
    Module: { value: "GL" },
    PostPeriod: { value: "022025" },
    Description: { value: "August journal" },
    custom: {},
    _links: {},
    Details: [
      { LineNbr: { value: 1 }, AccountID: { value: "703430" }, DebitAmt: { value: 120.5 }, Subaccount: { value: "EVA-000" } },
      { Account: { value: "111300" }, CreditAmount: { value: 120.5 }, Subaccount: { value: "ADM-000" } },
    ],
  },
  {
    TransactionDate: { value: "2024-09-01T00:00:00+00:00" },
    BatchNbr: { value: "GJ-1002" },
    Module: { value: "GL" },
    PostPeriod: { value: "032025" },
    Details: [
      { LineNbr: { value: 3 }, Account: { value: "111300" }, DebitAmount: { value: 50 } },
      { LineNbr: { value: 7 }, Account: { value: "703430" }, CreditAmount: { value: 50 } },
    ],
  },
];

// journalsByFrom keys the JournalTransaction response on the ge date inside
// the $filter, so each FY window gets its own canned page.
function makeFakeClient(journalsByFrom) {
  const calls = [];
  return {
    calls,
    async withSession(fn) {
      return fn({ base: "fake://myob/entity/Default/23.200.001" });
    },
    async pagedFetch(session, entity, opts = {}) {
      calls.push({ entity, opts });
      if (entity === "Account") return RAW_CHART;
      const match = /datetimeoffset'(\d{4}-\d{2}-\d{2})'/.exec(opts.filter || "");
      const journals = journalsByFrom[match ? match[1] : ""] || [];
      return journals.length > opts.maxRows ? journals.slice(0, opts.maxRows) : journals;
    },
  };
}

// ---------------------------------------------------------------------------
// FY-window and walk-back math
// ---------------------------------------------------------------------------

test("fyWindow maps an AU financial year label to its date window", () => {
  assert.deepEqual(history.fyWindow(2025), { fy: "FY2025", fromDate: "2024-07-01", toDate: "2025-06-30" });
  assert.deepEqual(history.fyWindow("FY2026"), { fy: "FY2026", fromDate: "2025-07-01", toDate: "2026-06-30" });
  assert.throws(() => history.fyWindow("garbage"), /invalid financial year/);
  assert.throws(() => history.fyWindow(1999), /invalid financial year/);
});

test("currentFy rolls forward at July 1 (FY labeled by ending year)", () => {
  assert.equal(history.currentFy(new Date("2026-07-02T00:00:00")), 2027);
  assert.equal(history.currentFy(new Date("2026-03-15T00:00:00")), 2026);
});

test("nextDay is the exclusive upper bound for the window filter", () => {
  assert.equal(history.nextDay("2025-06-30"), "2025-07-01");
  assert.equal(history.nextDay("2024-02-28"), "2024-02-29");
  assert.equal(history.nextDay("2024-12-31"), "2025-01-01");
});

test("nextWalkBackFy picks the most recent unsynced prior FY and stops at the floor", () => {
  const now = new Date("2026-03-15T00:00:00"); // currentFy 2026 -> prior FY2025
  assert.equal(history.nextWalkBackFy([], now), 2025);
  assert.equal(history.nextWalkBackFy([{ fy: "FY2025", status: "complete" }], now), 2024);
  assert.equal(history.nextWalkBackFy([{ fy: "FY2025", status: "pending" }], now), 2025);
  assert.equal(
    history.nextWalkBackFy(
      [
        { fy: "FY2025", status: "complete" },
        { fy: "FY2024", status: "complete" },
        { fy: "FY2023", status: "empty" },
      ],
      now
    ),
    null // floor reached — never fetch below an empty FY
  );
});

// ---------------------------------------------------------------------------
// Line identity
// ---------------------------------------------------------------------------

test("toHistoryLines keeps the flattened line shape and adds a stable line_nbr", () => {
  const lines = history.toHistoryLines(RAW_JOURNALS, { 703430: "Local church evangelism" });
  assert.equal(lines.length, 4);

  // journal 1: one detail lacks LineNbr -> ordinals for the whole journal
  assert.equal(lines[0].batch, "GJ-1001");
  assert.equal(lines[0].line_nbr, 1);
  assert.equal(lines[1].line_nbr, 2);
  // journal 2: unique tenant LineNbrs preserved verbatim
  assert.equal(lines[2].batch, "GJ-1002");
  assert.equal(lines[2].line_nbr, 3);
  assert.equal(lines[3].line_nbr, 7);

  // raw storage: original account codes and the full live-gl line shape
  assert.equal(lines[0].account, "703430");
  assert.equal(lines[0].account_description, "Local church evangelism");
  assert.equal(lines[0].debit, 120.5);
  assert.equal(lines[1].net_debit, -120.5);
  assert.deepEqual(
    Object.keys(lines[0]).sort(),
    [
      "account", "account_description", "batch", "branch", "credit", "date", "debit",
      "header_description", "kind", "line_description", "line_nbr", "module", "net_debit",
      "period", "project", "reference", "source_endpoint", "subaccount", "vendor_customer",
    ]
  );
});

// ---------------------------------------------------------------------------
// Repository upsert keys / shapes / degrade
// ---------------------------------------------------------------------------

test("repository degrades to no-ops when MONGODB_URI is unset", async () => {
  assert.deepEqual(await repo.ensureIndexes(), { enabled: false });
  assert.deepEqual(await repo.upsertJournalLines([{ module: "GL", batch: "B1", line_nbr: 1 }]), {
    enabled: false, matched: 0, modified: 0, upserted: 0,
  });
  assert.deepEqual(await repo.upsertBudgets([{ fy: "FY2026", account: "703430", amount: 1, source: "manual" }]), {
    enabled: false, matched: 0, modified: 0, upserted: 0,
  });
  assert.deepEqual(await repo.upsertSyncState({ fy: "FY2025", status: "pending" }), {
    enabled: false, matched: 0, modified: 0, upserted: 0,
  });
  assert.equal(await repo.getSyncState("FY2025"), null);
  assert.deepEqual(await repo.listSyncStates(), []);
});

test("ensureIndexes creates the unique identity indexes idempotently", async () => {
  const db = makeFakeDb();
  assert.deepEqual(await repo.ensureIndexes({ db }), { enabled: true });
  const lineIndexes = db._store.get(repo.JOURNAL_LINES_COLLECTION).indexes;
  assert.deepEqual(lineIndexes[0], {
    spec: { module: 1, batch: 1, line_nbr: 1 },
    options: { unique: true, name: "line_identity" },
  });
  assert.deepEqual(lineIndexes.map((index) => index.options.name), ["line_identity", "by_date", "by_account"]);
  assert.deepEqual(db._store.get(repo.GL_BUDGETS_COLLECTION).indexes[0], {
    spec: { fy: 1, account: 1, source: 1 },
    options: { unique: true, name: "budget_identity" },
  });
  assert.deepEqual(db._store.get(repo.SYNC_STATE_COLLECTION).indexes[0], {
    spec: { fy: 1 },
    options: { unique: true, name: "by_fy" },
  });
});

test("upsertJournalLines is idempotent on the {module,batch,line_nbr} key", async () => {
  const db = makeFakeDb();
  const lines = history.toHistoryLines(RAW_JOURNALS);

  const first = await repo.upsertJournalLines(lines, { db });
  assert.deepEqual(first, { enabled: true, matched: 0, modified: 0, upserted: 4 });

  const second = await repo.upsertJournalLines(lines, { db });
  assert.deepEqual(second, { enabled: true, matched: 4, modified: 4, upserted: 0 });

  const docs = db._store.get(repo.JOURNAL_LINES_COLLECTION).docs;
  assert.equal(docs.length, 4); // no duplicates on re-run
  assert.deepEqual(
    docs.map((doc) => [doc.module, doc.batch, doc.line_nbr]),
    [["GL", "GJ-1001", 1], ["GL", "GJ-1001", 2], ["GL", "GJ-1002", 3], ["GL", "GJ-1002", 7]]
  );
});

test("upsertBudgets is keyed on fy+account+source", async () => {
  const db = makeFakeDb();
  const row = { fy: "FY2026", account: "703430", amount: 1000, source: "manual" };

  await repo.upsertBudgets([row], { db });
  const changed = await repo.upsertBudgets([{ ...row, amount: 2500 }], { db });
  assert.equal(changed.upserted, 0);
  assert.equal(changed.modified, 1);

  // a different source is a separate doc, not an overwrite
  await repo.upsertBudgets([{ ...row, source: "myob" }], { db });
  const docs = db._store.get(repo.GL_BUDGETS_COLLECTION).docs;
  assert.equal(docs.length, 2);
  assert.equal(docs[0].amount, 2500);
  assert.equal(docs[0].source, "manual");
  assert.equal(docs[1].source, "myob");
});

test("upsertSyncState defaults the mapping gate on insert and never resets it", async () => {
  const db = makeFakeDb();
  await repo.upsertSyncState(
    { fy: "FY2025", fromDate: "2024-07-01", toDate: "2025-06-30", status: "pending" },
    { db }
  );
  let state = await repo.getSyncState("FY2025", { db });
  assert.equal(state.approved, false);
  assert.equal(state.unmappedShare, null);
  assert.equal(state.status, "pending");
  assert.ok(state.id); // _id mapped to id, never exposed raw
  assert.equal(state._id, undefined);

  // another service approves the FY; a later re-sync must not clobber it
  db._store.get(repo.SYNC_STATE_COLLECTION).docs[0].approved = true;
  db._store.get(repo.SYNC_STATE_COLLECTION).docs[0].unmappedShare = 0.04;
  await repo.upsertSyncState(
    { fy: "FY2025", fromDate: "2024-07-01", toDate: "2025-06-30", status: "complete", lineCount: 4, lastSyncedAt: "2026-07-02T00:00:00" },
    { db }
  );
  state = await repo.getSyncState("FY2025", { db });
  assert.equal(state.status, "complete");
  assert.equal(state.lineCount, 4);
  assert.equal(state.approved, true);
  assert.equal(state.unmappedShare, 0.04);
});

// ---------------------------------------------------------------------------
// Backfill runs (injected fake client + fake db)
// ---------------------------------------------------------------------------

test("backfillFy pulls the FY window, upserts raw lines, and marks the watermark complete", async () => {
  const db = makeFakeDb();
  const client = makeFakeClient({ "2024-07-01": RAW_JOURNALS });
  const logs = [];

  const result = await history.backfillFy({ fy: 2025, client, db, log: (line) => logs.push(line) });
  assert.equal(result.fy, "FY2025");
  assert.equal(result.status, "complete");
  assert.equal(result.journals, 2);
  assert.equal(result.lineCount, 4);
  assert.equal(result.upserted, 4);
  assert.equal(result.capped, false);

  // window filter carries raw apostrophes with an exclusive upper bound
  const journalCall = client.calls.find((call) => call.entity === "JournalTransaction");
  assert.equal(
    journalCall.opts.filter,
    "TransactionDate ge datetimeoffset'2024-07-01' and TransactionDate lt datetimeoffset'2025-07-01'"
  );
  assert.equal(journalCall.opts.expand, "Details");

  const state = await repo.getSyncState("FY2025", { db });
  assert.equal(state.status, "complete");
  assert.equal(state.lineCount, 4);
  assert.equal(state.fromDate, "2024-07-01");
  assert.equal(state.toDate, "2025-06-30");
  assert.match(state.lastSyncedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/); // nowIso quirk: 19 chars, no Z
  assert.ok(logs.some((line) => line.includes("FY2025 complete")));

  // idempotent re-run: same doc count, updates instead of inserts
  const again = await history.backfillFy({ fy: 2025, client, db, log: () => {} });
  assert.equal(again.upserted, 0);
  assert.equal(again.modified, 4);
  assert.equal(db._store.get(repo.JOURNAL_LINES_COLLECTION).docs.length, 4);
});

test("backfillFy marks a zero-line FY as empty (the walk-back floor)", async () => {
  const db = makeFakeDb();
  const client = makeFakeClient({}); // every window returns no journals
  const result = await history.backfillFy({ fy: 2023, client, db, log: () => {} });
  assert.equal(result.status, "empty");
  assert.equal(result.lineCount, 0);
  const state = await repo.getSyncState("FY2023", { db });
  assert.equal(state.status, "empty");
  assert.equal(state.lineCount, 0);
});

test("backfillFy leaves a capped pull pending instead of complete", async () => {
  const db = makeFakeDb();
  const client = makeFakeClient({ "2024-07-01": RAW_JOURNALS });
  const result = await history.backfillFy({ fy: 2025, client, db, log: () => {}, journalLimit: 1 });
  assert.equal(result.capped, true);
  assert.equal(result.status, "pending");
  assert.equal((await repo.getSyncState("FY2025", { db })).status, "pending");
});

test("runBackfill --walk-back syncs one prior FY per invocation until the floor", async () => {
  const db = makeFakeDb();
  const now = new Date("2026-03-15T00:00:00"); // currentFy 2026 -> starts at FY2025
  const client = makeFakeClient({ "2024-07-01": RAW_JOURNALS }); // FY2025 has data, FY2024 empty
  const log = () => {};

  const first = await history.runBackfill({ walkBack: true, client, db, log, now });
  assert.equal(first.mode, "walk-back");
  assert.equal(first.fy, "FY2025");
  assert.equal(first.status, "complete");
  assert.equal(first.done, false);

  const second = await history.runBackfill({ walkBack: true, client, db, log, now });
  assert.equal(second.fy, "FY2024");
  assert.equal(second.status, "empty"); // floor recorded
  assert.equal(second.done, true);

  const third = await history.runBackfill({ walkBack: true, client, db, log, now });
  assert.deepEqual(third, { mode: "walk-back", fy: null, done: true });

  const states = await repo.listSyncStates({ db });
  assert.deepEqual(states.map((state) => [state.fy, state.status]), [
    ["FY2024", "empty"],
    ["FY2025", "complete"],
  ]);
});

test("runBackfill window mode upserts lines without touching the FY watermark", async () => {
  const db = makeFakeDb();
  const client = makeFakeClient({ "2024-08-01": RAW_JOURNALS });
  const result = await history.runBackfill({ fromDate: "2024-08-01", toDate: "2024-09-30", client, db, log: () => {} });
  assert.equal(result.mode, "window");
  assert.equal(result.lineCount, 4);
  assert.equal(db._store.get(repo.JOURNAL_LINES_COLLECTION).docs.length, 4);
  assert.deepEqual(await repo.listSyncStates({ db }), []); // partial windows never mark an FY

  await assert.rejects(
    () => history.runBackfill({ fromDate: "2024-08-01", toDate: "bad", client, db, log: () => {} }),
    /--to must be a YYYY-MM-DD date/
  );
});

// ---------------------------------------------------------------------------
// Manual budget import helpers
// ---------------------------------------------------------------------------

test("parseBudgetFile reads CSV headers in any order and JSON arrays", () => {
  const csv = 'account,amount,fy\n703430,1000,FY2026\n"111300","250.75",2025\n';
  assert.deepEqual(history.parseBudgetFile(csv, "budgets.csv"), [
    { fy: "FY2026", account: "703430", amount: "1000" },
    { fy: "2025", account: "111300", amount: "250.75" },
  ]);
  assert.deepEqual(history.parseBudgetFile('[{"fy":2026,"account":"703430","amount":1000}]', "budgets.json"), [
    { fy: 2026, account: "703430", amount: 1000 },
  ]);
  assert.throws(() => history.parseBudgetFile("a,b\n1,2", "budgets.csv"), /CSV header must include fy, account, amount/);
  assert.throws(() => history.parseBudgetFile('{"fy":2026}', "budgets.json"), /must be an array/);
});

test("normalizeBudgetRow validates and normalizes fy/account/amount", () => {
  assert.deepEqual(history.normalizeBudgetRow({ fy: "2026", account: " 703430 ", amount: "1000" }, 0), {
    ok: true,
    value: { fy: "FY2026", account: "703430", amount: 1000 },
  });
  assert.deepEqual(history.normalizeBudgetRow({ fy: "FY2025", account: "111300", amount: 250.75 }, 1), {
    ok: true,
    value: { fy: "FY2025", account: "111300", amount: 250.75 },
  });
  assert.equal(history.normalizeBudgetRow({ fy: "26", account: "703430", amount: 1 }, 2).ok, false);
  assert.equal(history.normalizeBudgetRow({ fy: "2026", account: "", amount: 1 }, 3).ok, false);
  assert.equal(history.normalizeBudgetRow({ fy: "2026", account: "703430", amount: "lots" }, 4).ok, false);
  assert.match(history.normalizeBudgetRow(null, 5).error, /^row 6: not an object$/);
});

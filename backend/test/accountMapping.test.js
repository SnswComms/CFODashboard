// Force degraded/synthetic mode BEFORE the app/config load. Presence of the
// keys in process.env prevents dotenv from overriding them. node --test runs
// each file in its own process, so this cannot leak into other test files.
// Nothing here touches the network or a real Mongo: drift and gating get an
// injected fake db, and the degrade tests rely on MONGODB_URI="".
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
const mapping = require("../src/services/accountMappingService");
const history = require("../src/services/myobHistoryService");

// ---------------------------------------------------------------------------
// Fakes: the myobHistory.test.js fake db plus {$gte,$lte} range filters, which
// listJournalLinesByDate needs for the FY date window.
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

// Minimal raw history line for the drift scan — real docs carry the full
// flattened shape, but drift reads only date/subaccount/net_debit(debit,credit).
function line(nbr, date, subaccount, fields) {
  return { module: "GL", batch: `GJ-${nbr}`, line_nbr: 1, date, subaccount, ...fields };
}

// ---------------------------------------------------------------------------
// Mapping resolver
// ---------------------------------------------------------------------------

test("resolveMapping maps subaccount prefixes to function and lane (v1 = current logic)", () => {
  assert.deepEqual(mapping.resolveMapping("EVA-000", 2025), {
    prefix: "EVA",
    functionName: "EVANGELISM",
    laneId: "evangelism",
  });
  assert.deepEqual(mapping.resolveMapping("ADM-000", "FY2026"), {
    prefix: "ADM",
    functionName: "ADMINISTRATION",
    laneId: "president_discretionary",
  });
  // separator variants and case follow the live derivation's first-segment rule
  assert.equal(mapping.resolveMapping("aav.100", 2026).functionName, "ADVENTIST ALPINE VILLAGE");
  assert.equal(mapping.resolveMapping("YTH 12", 2026).laneId, "youth");
  // full-segment lookup misses -> first-3-chars fallback, same as PREFIX_TO_DEPT
  assert.equal(mapping.resolveMapping("FFM1-000", 2026).laneId, "faith_fm");
  // departments without a decision lane resolve with laneId null
  assert.deepEqual(mapping.resolveMapping("FLD-000", 2026), { prefix: "FLD", functionName: "FIELD", laneId: null });
});

test("resolveMapping treats unmapped codes as a first-class null outcome", () => {
  // FAM is deliberately not a mapping row (PREFIX_TO_DEPT keeps it visible as
  // "UNMAPPED / FAMILY MINISTRIES", which is not an approved function)
  assert.equal(mapping.resolveMapping("FAM-000", 2026), null);
  assert.equal(mapping.resolveMapping("XYZ-000", 2026), null);
  assert.equal(mapping.resolveMapping("", 2026), null);
  assert.equal(mapping.resolveMapping(null, 2026), null);
  assert.equal(mapping.UNMAPPED_FUNCTION, "Unmapped");
});

test("resolveMapping honors effectiveFrom/effectiveTo boundaries (inclusive)", () => {
  // v1 rows start at the MYOB data floor (FY2024) and are open-ended
  assert.equal(mapping.resolveMapping("ADM-000", 2023), null);
  assert.equal(mapping.resolveMapping("ADM-000", 2024).functionName, "ADMINISTRATION");
  assert.equal(mapping.resolveMapping("ADM-000", "FY2030").functionName, "ADMINISTRATION");

  // injected entries: a closed v1 row superseded by a v2 row
  const entries = [
    { prefix: "ADM", functionName: "OLD", laneId: null, effectiveFrom: "FY2024", effectiveTo: "FY2025" },
    { prefix: "ADM", functionName: "NEW", laneId: null, effectiveFrom: "FY2026", effectiveTo: null },
  ];
  assert.equal(mapping.resolveMapping("ADM-000", 2023, entries), null);
  assert.equal(mapping.resolveMapping("ADM-000", 2024, entries).functionName, "OLD");
  assert.equal(mapping.resolveMapping("ADM-000", 2025, entries).functionName, "OLD"); // effectiveTo inclusive
  assert.equal(mapping.resolveMapping("ADM-000", 2026, entries).functionName, "NEW");

  assert.throws(() => mapping.resolveMapping("ADM-000", "garbage"), /invalid financial year/);
});

// ---------------------------------------------------------------------------
// Drift report
// ---------------------------------------------------------------------------

test("driftReport buckets a FY's lines into mapped functions and explicit unmapped codes", async () => {
  const db = makeFakeDb();
  await repo.upsertSyncState({ fy: "FY2025", fromDate: "2024-07-01", toDate: "2025-06-30", status: "complete" }, { db });
  await repo.upsertJournalLines(
    [
      line(1, "2024-07-01", "EVA-000", { net_debit: 100 }), // FY start boundary, mapped
      line(2, "2025-06-30", "ADM-000", { net_debit: -50 }), // FY end boundary, abs() weight
      line(3, "2024-12-01", "FAM-000", { net_debit: 30 }), // known-but-unmapped prefix
      line(4, "2024-12-02", "", { debit: 20, credit: 0 }), // no subaccount -> "(none)", net from debit-credit
      line(5, "2024-06-30", "EVA-000", { net_debit: 999 }), // FY2024 — outside the window
    ],
    { db }
  );

  const report = await history.driftReport(2025, { db });
  assert.equal(report.fy, "FY2025");
  assert.equal(report.lineCount, 4);
  assert.equal(report.unmappedShare, 0.25); // 50 unmapped / 200 total
  assert.deepEqual(report.mapped, {
    lineCount: 2,
    amount: 150,
    functions: [
      { functionName: "EVANGELISM", lineCount: 1, amount: 100 },
      { functionName: "ADMINISTRATION", lineCount: 1, amount: 50 },
    ],
  });
  assert.deepEqual(report.unmapped, {
    bucket: "Unmapped",
    lineCount: 2,
    amount: 50,
    codes: [
      { code: "FAM", lineCount: 1, amount: 30 },
      { code: "(none)", lineCount: 1, amount: 20 },
    ],
  });

  // the measured share lands on the FY watermark without touching the gate
  const state = await repo.getSyncState("FY2025", { db });
  assert.equal(state.unmappedShare, 0.25);
  assert.equal(state.approved, false);
});

test("driftReport never fabricates a watermark for a FY that was never backfilled", async () => {
  const db = makeFakeDb();
  const report = await history.driftReport(2027, { db });
  assert.equal(report.lineCount, 0);
  assert.equal(report.unmappedShare, 0); // zero lines -> share 0, not NaN
  assert.deepEqual(await repo.listSyncStates({ db }), []);
});

// ---------------------------------------------------------------------------
// FY visibility gate
// ---------------------------------------------------------------------------

test("visibleHistoryFys applies the gate: complete AND (approved OR unmappedShare <= 0.01)", async () => {
  const db = makeFakeDb();
  const seed = async (fy, fields) => {
    await repo.upsertSyncState({ fy, status: "complete" }, { db });
    Object.assign(db._store.get(repo.SYNC_STATE_COLLECTION).docs.find((doc) => doc.fy === fy), fields);
  };
  await seed("FY2020", { unmappedShare: 0.01 }); // boundary: exactly the gate passes
  await seed("FY2021", { unmappedShare: null }); // never drift-checked, not approved
  await seed("FY2022", { status: "empty", unmappedShare: 0 }); // clean share but not complete
  await seed("FY2023", { status: "pending", approved: true }); // approved but not complete
  await seed("FY2024", { approved: true, unmappedShare: 0.2 }); // human approval overrides drift
  await seed("FY2025", { unmappedShare: 0.005 }); // clean drift, no approval needed
  await seed("FY2026", { unmappedShare: 0.05 }); // too much drift, not approved

  assert.deepEqual(await history.visibleHistoryFys({ db }), ["FY2020", "FY2024", "FY2025"]);
  assert.equal(history.UNMAPPED_SHARE_GATE, 0.01);
});

test("approveFy flips the gate on an existing watermark and returns null otherwise", async () => {
  const db = makeFakeDb();
  await repo.upsertSyncState({ fy: "FY2026", status: "complete", lineCount: 4 }, { db });

  assert.deepEqual(await history.visibleHistoryFys({ db }), []); // unmappedShare null, not approved
  const state = await history.approveFy("FY2026", { db });
  assert.equal(state.approved, true);
  assert.equal(state.status, "complete"); // approval touches nothing else
  assert.ok(state.id);
  assert.deepEqual(await history.visibleHistoryFys({ db }), ["FY2026"]);

  assert.equal(await history.approveFy(2024, { db }), null); // never backfilled
  assert.deepEqual(await repo.listSyncStates({ db }), [await repo.getSyncState("FY2026", { db })]);
});

// ---------------------------------------------------------------------------
// Graceful degrade without Mongo
// ---------------------------------------------------------------------------

test("drift and gating degrade to empty results when MONGODB_URI is unset", async () => {
  assert.deepEqual(await repo.listJournalLinesByDate("2024-07-01", "2025-06-30"), []);
  assert.deepEqual(await repo.setSyncStateFields("FY2025", { approved: true }), {
    enabled: false, matched: 0, modified: 0, upserted: 0,
  });
  const report = await history.driftReport(2025);
  assert.equal(report.lineCount, 0);
  assert.equal(report.unmappedShare, 0);
  assert.deepEqual(await history.visibleHistoryFys(), []);
  assert.equal(await history.approveFy(2025), null);
});

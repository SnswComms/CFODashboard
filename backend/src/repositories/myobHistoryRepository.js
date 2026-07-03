// Durable MYOB history store in MongoDB — a PARALLEL layer to the live-cache
// JSON files (myobCacheRepository); the dashboard's live views never read it.
// Follows the lib/mongo getDb() convention (usable only AFTER connectMongo()
// succeeded) but degrades to a no-op when MONGODB_URI is unset, and accepts an
// injected db so tests never touch a real Mongo.
//
// Collections (every write is an idempotent upsert — safe to re-run backfills):
//   myob_journal_lines — RAW flattened journal lines (original account codes,
//     no department/function mapping), keyed on the tenant's stable line
//     identity {module, batch, line_nbr}.
//   myob_gl_budgets    — {fy, account, amount, source} keyed on
//     fy+account+source; source "manual" (scripts/import-budgets.js) or
//     "myob" (reserved — the tenant's Budget entity 500s server-side).
//   myob_sync_state    — one watermark doc per AU financial year:
//     { fy, fromDate, toDate, status: "pending"|"complete"|"empty",
//       lineCount, lastSyncedAt, approved: false, unmappedShare: null }
//     approved/unmappedShare are the mapping gate other services own — upserts
//     here only default them on insert, never overwrite an existing value.
const config = require("../config");
const { getDb } = require("../lib/mongo");

const JOURNAL_LINES_COLLECTION = "myob_journal_lines";
const GL_BUDGETS_COLLECTION = "myob_gl_budgets";
const SYNC_STATE_COLLECTION = "myob_sync_state";

const DISABLED_WRITE = { enabled: false, matched: 0, modified: 0, upserted: 0 };

// Match the sync layer's timestamp quirk: 19 chars, no Z (see myobSyncService).
function nowIso() {
  return new Date().toISOString().slice(0, 19);
}

// db injection point for tests; null (graceful no-op) when Mongo is disabled.
function resolveDb(db) {
  if (db) return db;
  if (!config.mongoUri) return null;
  return getDb();
}

// Mapping rule: expose `id` (String(_id)), never `_id`, to callers.
function mapDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: String(_id), ...rest };
}

// Idempotent — createIndex is a no-op when the index already exists.
// Promise<{enabled}>
async function ensureIndexes({ db } = {}) {
  const database = resolveDb(db);
  if (!database) return { enabled: false };
  const lines = database.collection(JOURNAL_LINES_COLLECTION);
  await lines.createIndex({ module: 1, batch: 1, line_nbr: 1 }, { unique: true, name: "line_identity" });
  await lines.createIndex({ date: 1 }, { name: "by_date" });
  await lines.createIndex({ account: 1 }, { name: "by_account" });
  await database
    .collection(GL_BUDGETS_COLLECTION)
    .createIndex({ fy: 1, account: 1, source: 1 }, { unique: true, name: "budget_identity" });
  await database.collection(SYNC_STATE_COLLECTION).createIndex({ fy: 1 }, { unique: true, name: "by_fy" });
  return { enabled: true };
}

// Promise<{enabled,matched,modified,upserted}> — lines already carry line_nbr
// (myobHistoryService.toHistoryLines) and are stored raw, one doc per line.
async function upsertJournalLines(lines, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return { ...DISABLED_WRITE };
  if (lines.length === 0) return { enabled: true, matched: 0, modified: 0, upserted: 0 };
  const result = await database.collection(JOURNAL_LINES_COLLECTION).bulkWrite(
    lines.map((line) => ({
      updateOne: {
        filter: { module: line.module, batch: line.batch, line_nbr: line.line_nbr },
        update: { $set: line },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { enabled: true, matched: result.matchedCount, modified: result.modifiedCount, upserted: result.upsertedCount };
}

// rows: Array<{fy, account, amount, source}> with source "myob"|"manual".
// Promise<{enabled,matched,modified,upserted}>
async function upsertBudgets(rows, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return { ...DISABLED_WRITE };
  if (rows.length === 0) return { enabled: true, matched: 0, modified: 0, upserted: 0 };
  const result = await database.collection(GL_BUDGETS_COLLECTION).bulkWrite(
    rows.map((row) => ({
      updateOne: {
        filter: { fy: row.fy, account: row.account, source: row.source },
        update: { $set: { fy: row.fy, account: row.account, source: row.source, amount: row.amount, updatedAt: nowIso() } },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return { enabled: true, matched: result.matchedCount, modified: result.modifiedCount, upserted: result.upsertedCount };
}

// Upsert the per-FY watermark keyed on fy. Mapping-gate fields (approved,
// unmappedShare) only get their defaults on first insert — a re-sync never
// resets an approval another service granted.
// Promise<{enabled,matched,modified,upserted}>
async function upsertSyncState(state, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return { ...DISABLED_WRITE };
  const { fy, ...rest } = state;
  const setOnInsert = {};
  if (!("approved" in rest)) setOnInsert.approved = false;
  if (!("unmappedShare" in rest)) setOnInsert.unmappedShare = null;
  const update = { $set: { fy, ...rest } };
  if (Object.keys(setOnInsert).length > 0) update.$setOnInsert = setOnInsert;
  const result = await database.collection(SYNC_STATE_COLLECTION).updateOne({ fy }, update, { upsert: true });
  return { enabled: true, matched: result.matchedCount, modified: result.modifiedCount, upserted: result.upsertedCount };
}

// $set fields on an EXISTING FY watermark only — never upserts, so a drift
// run or approval can never fabricate a half-formed watermark (a doc without
// a status would confuse the walk-back logic).
// Promise<{enabled,matched,modified,upserted}>
async function setSyncStateFields(fy, fields, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return { ...DISABLED_WRITE };
  const result = await database.collection(SYNC_STATE_COLLECTION).updateOne({ fy }, { $set: fields });
  return { enabled: true, matched: result.matchedCount, modified: result.modifiedCount, upserted: 0 };
}

// Promise<Array<object>> — raw lines whose date falls in [fromDate, toDate].
// Dates are stored as YYYY-MM-DD strings (myobSyncService.dateOnly), so a
// string range compare is exact; the by_date index covers it.
async function listJournalLinesByDate(fromDate, toDate, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return [];
  const docs = await database
    .collection(JOURNAL_LINES_COLLECTION)
    .find({ date: { $gte: fromDate, $lte: toDate } })
    .sort({ date: 1 })
    .toArray();
  return docs.map(mapDoc);
}

// Promise<Array<object>> — budget rows for one FY (source "manual"|"myob"),
// account order, _id mapped to id.
async function listBudgetsByFy(fy, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return [];
  const docs = await database.collection(GL_BUDGETS_COLLECTION).find({ fy }).sort({ account: 1 }).toArray();
  return docs.map(mapDoc);
}

// Promise<Array<{fy, sources}>> — which FYs have budget rows loaded and from
// which sources (oldest FY first, sources sorted) — the copilot's coverage
// facts, cheap enough at a few hundred accounts per FY.
async function listBudgetFys({ db } = {}) {
  const database = resolveDb(db);
  if (!database) return [];
  const docs = await database.collection(GL_BUDGETS_COLLECTION).find({}).sort({ fy: 1 }).toArray();
  const byFy = new Map();
  for (const doc of docs) {
    if (!byFy.has(doc.fy)) byFy.set(doc.fy, new Set());
    byFy.get(doc.fy).add(doc.source);
  }
  return [...byFy.entries()].map(([fy, sources]) => ({ fy, sources: [...sources].sort() }));
}

// Promise<object|null> — one FY watermark, _id mapped to id (string)
async function getSyncState(fy, { db } = {}) {
  const database = resolveDb(db);
  if (!database) return null;
  const doc = await database.collection(SYNC_STATE_COLLECTION).findOne({ fy });
  return mapDoc(doc);
}

// Promise<Array<object>> — every FY watermark, oldest FY first
async function listSyncStates({ db } = {}) {
  const database = resolveDb(db);
  if (!database) return [];
  const docs = await database.collection(SYNC_STATE_COLLECTION).find({}).sort({ fy: 1 }).toArray();
  return docs.map(mapDoc);
}

module.exports = {
  JOURNAL_LINES_COLLECTION,
  GL_BUDGETS_COLLECTION,
  SYNC_STATE_COLLECTION,
  ensureIndexes,
  upsertJournalLines,
  upsertBudgets,
  upsertSyncState,
  setSyncStateFields,
  listJournalLinesByDate,
  listBudgetsByFy,
  listBudgetFys,
  getSyncState,
  listSyncStates,
};

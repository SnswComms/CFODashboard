#!/usr/bin/env node
// Backfill historical MYOB journal lines into the durable Mongo store
// (myob_journal_lines + the per-FY myob_sync_state watermark). Read-only
// against MYOB: one login/GET/logout bracket per run, exactly like the
// dashboard sync.
//
//   Usage: node scripts/backfill-history.js --fy 2025
//          node scripts/backfill-history.js --from 2024-01-01 --to 2024-03-31
//          node scripts/backfill-history.js --walk-back
//          node scripts/backfill-history.js --drift 2025
//
// --fy syncs one AU financial year (labeled by ending year: FY2025 =
// 2024-07-01..2025-06-30). --from/--to syncs an arbitrary window for testing
// (lines only — it never touches the per-FY watermark). --walk-back syncs the
// most recent prior FY not yet complete, one FY per invocation, and stops at
// the data floor (a FY that returned zero lines, recorded as status "empty").
// --drift prints the chart-of-accounts drift report for a backfilled FY and
// records unmappedShare on its watermark — Mongo only, no MYOB session.
// Optional --company test targets the test tenant. Idempotent — re-running
// any window upserts in place. Requires MONGODB_URI and MYOB_* credentials
// (MYOB not needed for --drift).
//
// Acumatica caps concurrent API sessions, so this must not run while a
// dashboard sync is in flight; the script refuses when sync-status.json
// shows a run without a finishedAt.
const config = require("../src/config");
const { connectMongo, closeMongo } = require("../src/lib/mongo");
const { readJsonFile } = require("../src/repositories/jsonFileRepository");
const { ensureIndexes } = require("../src/repositories/myobHistoryRepository");
const { driftReport, runBackfill } = require("../src/services/myobHistoryService");

const USAGE =
  "Usage: node scripts/backfill-history.js --fy 2025 | --from YYYY-MM-DD --to YYYY-MM-DD | --walk-back | --drift 2025 [--company test]";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const eq = token.indexOf("=");
    const flag = eq === -1 ? token : token.slice(0, eq);
    const value = eq === -1 ? argv[i + 1] : token.slice(eq + 1);
    if (flag === "--walk-back") args.walkBack = true;
    if (flag === "--fy") args.fy = value;
    if (flag === "--from") args.from = value;
    if (flag === "--to") args.to = value;
    if (flag === "--drift") args.drift = value;
    if (flag === "--company") args.company = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const modes = [
    args.fy !== undefined,
    args.from !== undefined || args.to !== undefined,
    args.walkBack === true,
    args.drift !== undefined,
  ];
  if (modes.filter(Boolean).length !== 1) {
    console.error(USAGE);
    process.exit(1);
  }
  if (args.company !== undefined && args.company !== "test") {
    console.error('--company only accepts "test" (omit it for the default tenant)');
    process.exit(1);
  }
  if (!config.mongoUri) {
    console.error("MONGODB_URI is not set. Configure backend/.env and start the tunnel: npm run db:tunnel");
    process.exit(1);
  }
  // --drift reads Mongo only; the MYOB credential and session checks are for
  // the backfill modes that open an Acumatica session.
  if (args.drift === undefined) {
    if (!config.myob.url || !config.myob.username || !config.myob.password) {
      console.error("MYOB credentials are not configured (MYOB_URL/MYOB_USERNAME/MYOB_PASSWORD)");
      process.exit(1);
    }

    // Refuse to open a second Acumatica session while a dashboard sync runs.
    const statusPath = config.resolve("myobCache", "sync-status.json");
    const status = statusPath ? readJsonFile(statusPath) : null;
    const lastRun = status && status.last_run;
    if (lastRun && lastRun.startedAt && !lastRun.finishedAt) {
      console.error(`A dashboard MYOB sync appears to be in flight (started ${lastRun.startedAt}); retry after it finishes.`);
      process.exit(1);
    }
  }

  try {
    await connectMongo();
  } catch (err) {
    console.error(`MongoDB is unreachable: ${err.message}`);
    console.error("Start the SSH tunnel first: npm run db:tunnel");
    process.exit(1);
  }

  await ensureIndexes();
  if (args.drift !== undefined) {
    const report = await driftReport(args.drift);
    console.log(JSON.stringify(report, null, 2));
  } else {
    const result = await runBackfill({
      fy: args.fy,
      fromDate: args.from,
      toDate: args.to,
      walkBack: args.walkBack === true,
      company: args.company === "test" ? config.myob.companyTest : undefined,
    });
    console.log(`backfill result: ${JSON.stringify(result)}`);
  }

  await closeMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

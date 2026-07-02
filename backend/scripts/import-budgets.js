#!/usr/bin/env node
// Import manually maintained GL budgets into the myob_gl_budgets collection.
// The tenant's MYOB Budget entity is broken server-side (HTTP 500 from
// BQL-delegate view filters), so budgets arrive as a file export instead and
// are upserted with source "manual" keyed on fy+account+source.
//
//   Usage: node scripts/import-budgets.js path/to/budgets.csv
//          node scripts/import-budgets.js path/to/budgets.json
//
// CSV needs a header row naming fy, account, amount columns (any order);
// JSON is an array of {fy, account, amount} objects. fy accepts "2026" or
// "FY2026" (AU FY labeled by ending year). Idempotent: re-running the same
// file updates amounts in place. Requires MONGODB_URI.
const fs = require("fs");

const config = require("../src/config");
const { connectMongo, closeMongo } = require("../src/lib/mongo");
const { ensureIndexes, upsertBudgets } = require("../src/repositories/myobHistoryRepository");
const { parseBudgetFile, normalizeBudgetRow } = require("../src/services/myobHistoryService");

async function main() {
  const filePath = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!filePath) {
    console.error("Usage: node scripts/import-budgets.js path/to/budgets.csv|json");
    process.exit(1);
  }
  if (!config.mongoUri) {
    console.error("MONGODB_URI is not set. Configure backend/.env and start the tunnel: npm run db:tunnel");
    process.exit(1);
  }

  let text;
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }

  let rawRows;
  try {
    rawRows = parseBudgetFile(text, filePath);
  } catch (err) {
    console.error(`Cannot parse ${filePath}: ${err.message}`);
    process.exit(1);
  }

  const valid = [];
  const errors = [];
  rawRows.forEach((row, index) => {
    const result = normalizeBudgetRow(row, index);
    if (result.ok) valid.push({ ...result.value, source: "manual" });
    else errors.push(result.error);
  });
  for (const error of errors) console.error(`skipped ${error}`);
  if (valid.length === 0) {
    console.error(`No valid rows in ${filePath} (${rawRows.length} read, ${errors.length} invalid)`);
    process.exit(1);
  }

  try {
    await connectMongo();
  } catch (err) {
    console.error(`MongoDB is unreachable: ${err.message}`);
    console.error("Start the SSH tunnel first: npm run db:tunnel");
    process.exit(1);
  }

  await ensureIndexes();
  const result = await upsertBudgets(valid);
  console.log(
    `budgets imported from ${filePath}: ${rawRows.length} rows read, ${valid.length} valid, ` +
      `${errors.length} invalid, ${result.upserted} inserted, ${result.modified} updated`
  );

  await closeMongo();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

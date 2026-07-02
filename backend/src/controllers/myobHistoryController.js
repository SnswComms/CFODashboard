const config = require("../config");
const { envelope } = require("../lib/envelope");
const { BadRequestError, NotFoundError } = require("../lib/errors");
const myobHistoryService = require("../services/myobHistoryService");

// AU financial year labeled by ending year — accepts "2025" or "FY2025".
function fyParam(value, name) {
  const digits = String(value ?? "").trim().replace(/^FY/i, "");
  const year = Number(digits);
  if (!/^\d{4}$/.test(digits) || year < 2000 || year > 2100) {
    throw new BadRequestError(`${name} must be a financial year like 2025 or FY2025`);
  }
  return year;
}

// The history store degrades gracefully without Mongo; surface that instead
// of returning silently-empty figures.
function mongoWarnings() {
  return config.mongoUri ? [] : ["MONGODB_URI is not set; the history store is disabled"];
}

// GET /api/myob/history/drift?fy=2025 — read-only chart-of-accounts drift for
// one backfilled FY; also records unmappedShare on the FY watermark.
async function getDrift(request, response) {
  const fy = fyParam(request.query.fy, "fy");
  const report = await myobHistoryService.driftReport(fy);
  response.json(envelope(report, { dataSource: "mongo-history", warnings: mongoWarnings() }));
}

// POST /api/myob/history/approve { fy } — human sign-off on the FY's account
// mapping; flips the visibility gate regardless of unmappedShare.
async function approveFy(request, response) {
  const fy = fyParam(request.body && request.body.fy, "fy");
  const state = await myobHistoryService.approveFy(fy);
  if (!state) throw new NotFoundError(`FY${fy} has no history sync state to approve`);
  response.json(envelope(state, { dataSource: "mongo-history", warnings: mongoWarnings() }));
}

module.exports = { getDrift, approveFy };

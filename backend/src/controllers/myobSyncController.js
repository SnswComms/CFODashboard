const { envelope } = require("../lib/envelope");
const { enumParam, dateParam } = require("../lib/validate");
const { BadRequestError } = require("../lib/errors");
const myobSyncService = require("../services/myobSyncService");

// POST /api/myob/sync — start a read-only sync run (async in-process).
// company=test targets MYOB_COMPANY_TEST; 409 when a run is already going.
// An optional custom extract window (from_date/to_date, YYYY-MM-DD) may be sent
// in the JSON body; when omitted the run uses the env/FY-start default. All
// three inputs are accepted from the body first, then the query string.
async function startSync(request, response) {
  const body = request.body || {};
  const company = enumParam(body.company ?? request.query.company, ["church", "test"], "company");
  const fromDate = dateParam(body.from_date ?? request.query.from_date, "from_date");
  const toDate = dateParam(body.to_date ?? request.query.to_date, "to_date");
  if (fromDate && toDate && fromDate > toDate) {
    throw new BadRequestError("from_date must be on or before to_date");
  }
  const result = myobSyncService.startSync({ company, fromDate, toDate });
  const { data, meta } = result.status;
  if (!result.started) {
    response.status(409).json(envelope(data, { ...meta, warnings: ["a sync run is already in progress"] }));
    return;
  }
  response.status(202).json(envelope(data, meta));
}

async function getStatus(request, response) {
  const { data, meta } = myobSyncService.getStatus();
  response.json(envelope(data, meta));
}

module.exports = { startSync, getStatus };

const { envelope } = require("../lib/envelope");
const { enumParam } = require("../lib/validate");
const myobSyncService = require("../services/myobSyncService");

// POST /api/myob/sync — start a read-only sync run (async in-process).
// ?company=test targets MYOB_COMPANY_TEST; 409 when a run is already going.
async function startSync(request, response) {
  const company = enumParam(request.query.company, ["church", "test"], "company");
  const result = myobSyncService.startSync({ company });
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

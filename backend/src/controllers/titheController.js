const { envelope } = require("../lib/envelope");
const { boolParam } = require("../lib/validate");
const titheService = require("../services/titheService");

function titheEnvelope(result) {
  return envelope(result.data, result.meta);
}

function getDashboard(_request, response) {
  response.json(titheEnvelope(titheService.getDashboard()));
}

function getChurch(request, response) {
  response.json(titheEnvelope(titheService.getChurch({ churchId: request.params.churchId })));
}

async function triggerMonthlyEmail(request, response) {
  const previewOnly = (request.body && request.body.previewOnly) === true || boolParam(request.body && request.body.previewOnly);
  const result = await titheService.triggerMonthlyEmail({
    churchId: request.body && request.body.churchId,
    to: request.body && request.body.to,
    previewOnly,
  });
  response.json(titheEnvelope(result));
}

async function triggerMonthlyEmailBatch(request, response) {
  const previewOnly =
    (request.body && request.body.previewOnly) !== false && !boolParam(request.body && request.body.send);
  const result = await titheService.triggerMonthlyEmailBatch({
    churchIds: (request.body && request.body.churchIds) || [],
    previewOnly,
    testTo: request.body && request.body.testTo,
  });
  response.json(titheEnvelope(result));
}

module.exports = {
  getDashboard,
  getChurch,
  triggerMonthlyEmail,
  triggerMonthlyEmailBatch,
};

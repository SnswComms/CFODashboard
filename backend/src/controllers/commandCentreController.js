const { envelope } = require("../lib/envelope");
const commandCentreService = require("../services/commandCentreService");

function send(response, result) {
  response.json(envelope(result.data, result.meta));
}

function getOverview(request, response) {
  send(response, commandCentreService.getOverview());
}

function getFunctions(request, response) {
  send(response, commandCentreService.getFunctions());
}

function getDepartments(request, response) {
  send(response, commandCentreService.getDepartments());
}

function getLanes(request, response) {
  send(response, commandCentreService.getLanes());
}

function getStaffingBaseline(request, response) {
  send(response, commandCentreService.getStaffingBaseline());
}

function getField(request, response) {
  send(response, commandCentreService.getField());
}

function getEntities(request, response) {
  send(response, commandCentreService.getEntities());
}

function getSources(request, response) {
  send(response, commandCentreService.getSources());
}

// Async: the copilot may call the local LLM. The route's asyncHandler wrapper
// already forwards rejections (including BadRequestError) to the error
// middleware, so no route change is needed.
async function postCopilot(request, response) {
  send(response, await commandCentreService.postCopilot(request.body));
}

module.exports = {
  getOverview,
  getFunctions,
  getDepartments,
  getLanes,
  getStaffingBaseline,
  getField,
  getEntities,
  getSources,
  postCopilot,
};

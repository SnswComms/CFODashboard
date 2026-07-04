const { envelope } = require("../lib/envelope");
const { dateParam } = require("../lib/validate");
const commandCentreService = require("../services/commandCentreService");

function send(response, result) {
  response.json(envelope(result.data, result.meta));
}

function rangeFrom(request) {
  const fromDate = dateParam(request.query.from_date, "from_date");
  const toDate = dateParam(request.query.to_date, "to_date");
  if (fromDate && toDate && fromDate > toDate) {
    const { BadRequestError } = require("../lib/errors");
    throw new BadRequestError("from_date must be on or before to_date");
  }
  const labels = {
    fytd: "FY2026 to date",
    month: "This month",
    quarter: "This quarter",
    "12m": "Last 12 months",
    year: "Full year FY2026",
    custom: "Custom range",
  };
  const key = request.query.range ? String(request.query.range) : undefined;
  return {
    fromDate,
    toDate,
    label: key ? labels[key] || key : undefined,
  };
}

function getOverview(request, response) {
  send(response, commandCentreService.getOverview(rangeFrom(request)));
}

// Async: the observation line may call the local LLM (cached per data change).
async function getFunctions(request, response) {
  send(response, await commandCentreService.getFunctions(rangeFrom(request)));
}

function getDepartments(request, response) {
  send(response, commandCentreService.getDepartments(rangeFrom(request)));
}

function getLanes(request, response) {
  send(response, commandCentreService.getLanes(rangeFrom(request)));
}

function getStaffingBaseline(request, response) {
  send(response, commandCentreService.getStaffingBaseline());
}

function getField(request, response) {
  send(response, commandCentreService.getField());
}

function getEntities(request, response) {
  send(response, commandCentreService.getEntities(rangeFrom(request)));
}

function getSources(request, response) {
  send(response, commandCentreService.getSources(rangeFrom(request)));
}

// Async: the copilot may call the local LLM. The route's asyncHandler wrapper
// already forwards rejections (including BadRequestError) to the error
// middleware, so no route change is needed.
async function postCopilot(request, response) {
  send(response, await commandCentreService.postCopilot(request.body, rangeFrom(request)));
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

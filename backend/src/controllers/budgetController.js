const { envelope } = require("../lib/envelope");
const { BadRequestError } = require("../lib/errors");
const { parsePagination } = require("../lib/pagination");
const { enumParam } = require("../lib/validate");
const budgetService = require("../services/budgetService");

function send(response, result) {
  response.json(envelope(result.data, result.meta));
}

// Optional numeric query param; undefined when absent, 400 when not a finite number.
function numberParam(value, name) {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new BadRequestError(`${name} must be a number`);
  return parsed;
}

function getConference(_request, response) {
  send(response, budgetService.getConference());
}

function getConferenceHealth(_request, response) {
  send(response, budgetService.getConferenceHealth());
}

function getConferenceFunctions(request, response) {
  const status = enumParam(request.query.status, ["over", "tight"], "status");
  const sort = enumParam(request.query.sort, ["expense_budget", "expense_remaining", "used_pct"], "sort");
  const pagination = parsePagination(request.query, { defaultLimit: 100, maxLimit: 500 });
  send(response, budgetService.getFunctions({ status, sort, pagination }));
}

function getConferenceDecisionCards(request, response) {
  const { id } = request.query;
  const requestAmount = numberParam(request.query.request, "request");
  send(response, budgetService.getDecisionCards({ id, request: requestAmount }));
}

function getSummary(_request, response) {
  send(response, budgetService.getSummary());
}

function getApproved(_request, response) {
  send(response, budgetService.getApproved());
}

function getDepartments(request, response) {
  const source = enumParam(request.query.source, ["auto", "myob", "velixo"], "source") ?? "auto";
  const status = enumParam(request.query.status, ["ok", "tight", "over"], "status");
  const pagination = parsePagination(request.query, { defaultLimit: 100, maxLimit: 500 });
  send(response, budgetService.getDepartments({ source, status, q: request.query.q, pagination }));
}

function getDepartmentsMapping(_request, response) {
  send(response, budgetService.getDepartmentsMapping());
}

function getDepartmentsPace(request, response) {
  const month = numberParam(request.query.month, "month");
  if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) {
    throw new BadRequestError("month must be an integer between 1 and 12");
  }
  send(response, budgetService.getDepartmentsPace({ month }));
}

function getDepartment(request, response) {
  send(response, budgetService.getDepartment(request.params.slug));
}

function getReportPacks(_request, response) {
  send(response, budgetService.getReportPacks());
}

function getReportPackFile(request, response) {
  const { absolutePath, contentType } = budgetService.getReportPackFile(request.params.id, request.params.file);
  response.type(contentType);
  response.sendFile(absolutePath);
}

function getFieldProjections(_request, response) {
  send(response, budgetService.getFieldProjections());
}

function saveFieldProjections(request, response) {
  send(response, budgetService.saveFieldProjections(request.body));
}

module.exports = {
  getConference,
  getConferenceHealth,
  getConferenceFunctions,
  getConferenceDecisionCards,
  getSummary,
  getApproved,
  getDepartments,
  getDepartmentsMapping,
  getDepartmentsPace,
  getDepartment,
  getReportPacks,
  getReportPackFile,
  getFieldProjections,
  saveFieldProjections,
};

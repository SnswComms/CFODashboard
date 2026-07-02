const { envelope } = require("../lib/envelope");
const { digitsParam } = require("../lib/validate");
const myobService = require("../services/myobService");

function send(response, result) {
  response.json(envelope(result.payload, result.meta));
}

async function getSources(request, response) {
  send(response, myobService.getSources());
}

async function listAccounts(request, response) {
  send(response, myobService.listAccounts(request.query));
}

async function getAccount(request, response) {
  const code = digitsParam(request.params.code, "code");
  send(response, myobService.getAccount(code));
}

async function getAccountDrilldown(request, response) {
  const code = digitsParam(request.params.code, "code");
  send(response, myobService.getAccountDrilldown(code, request.query));
}

async function listAccountTransactions(request, response) {
  const code = digitsParam(request.params.code, "code");
  send(response, myobService.listAccountTransactions(code, request.query));
}

async function listDrilldowns(request, response) {
  send(response, myobService.listDrilldowns());
}

async function listEntityRows(request, response) {
  send(response, myobService.listEntityRows(request.params.entity, request.query));
}

async function getBroadSummary(request, response) {
  send(response, myobService.getBroadSummary());
}

async function getBroadBranches(request, response) {
  send(response, myobService.getBroadBranches());
}

async function getGlSummary(request, response) {
  send(response, myobService.getGlSummary());
}

async function listGlAccounts(request, response) {
  send(response, myobService.listGlAccounts(request.query));
}

async function listGlLines(request, response) {
  send(response, myobService.listGlLines(request.query));
}

async function listGlPeriods(request, response) {
  send(response, myobService.listGlPeriods());
}

async function listGlActivity(request, response) {
  send(response, myobService.listGlActivity(request.query));
}

async function getBenefitsSummary(request, response) {
  send(response, myobService.getBenefitsSummary());
}

async function listBenefitsEmployees(request, response) {
  send(response, myobService.listBenefitsEmployees(request.query));
}

async function getBenefitsEmployee(request, response) {
  send(response, myobService.getBenefitsEmployee(request.params.code));
}

async function listBenefitsTransactions(request, response) {
  send(response, myobService.listBenefitsTransactions(request.query));
}

async function listBenefitsCategories(request, response) {
  send(response, myobService.listBenefitsCategories());
}

module.exports = {
  getSources,
  listAccounts,
  getAccount,
  getAccountDrilldown,
  listAccountTransactions,
  listDrilldowns,
  listEntityRows,
  getBroadSummary,
  getBroadBranches,
  getGlSummary,
  listGlAccounts,
  listGlLines,
  listGlPeriods,
  listGlActivity,
  getBenefitsSummary,
  listBenefitsEmployees,
  getBenefitsEmployee,
  listBenefitsTransactions,
  listBenefitsCategories,
};

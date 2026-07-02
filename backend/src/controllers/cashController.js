const { envelope } = require("../lib/envelope");
const { parsePagination } = require("../lib/pagination");
const { enumParam, dateParam, digitsParam, boolParam } = require("../lib/validate");
const cashService = require("../services/cashService");

function cashEnvelope(result) {
  return envelope(result.data, {
    ...result.meta,
    extra: { source_rule: cashService.SOURCE_RULE, ...(result.meta.extra || {}) },
  });
}

function optionalDigits(value, name) {
  if (value === undefined || value === null || value === "") return undefined;
  return digitsParam(value, name);
}

function getPosition(request, response) {
  const unmasked = boolParam(request.query.unmasked);
  response.json(cashEnvelope(cashService.getPosition({ unmasked })));
}

function getTargets(request, response) {
  const system = enumParam(request.query.system, ["Westpac", "CMF"], "system");
  const unmasked = boolParam(request.query.unmasked);
  response.json(cashEnvelope(cashService.getTargets({ system, unmasked })));
}

function getCandidates(request, response) {
  const pagination = parsePagination(request.query, { defaultLimit: 30, maxLimit: 120 });
  const endpoint = request.query.endpoint || undefined;
  response.json(cashEnvelope(cashService.getCandidates({ endpoint, pagination })));
}

function getCmfSummary(_request, response) {
  response.json(cashEnvelope(cashService.getCmfSummary()));
}

function getCmfBalances(request, response) {
  const account = optionalDigits(request.query.account, "account");
  const groupBy = enumParam(request.query.groupBy, ["account", "subaccount"], "groupBy") || "account";
  response.json(cashEnvelope(cashService.getCmfBalances({ account, groupBy })));
}

function getCmfLines(request, response) {
  const account = optionalDigits(request.query.account, "account");
  const subaccount = request.query.subaccount || undefined;
  const from = dateParam(request.query.from, "from");
  const to = dateParam(request.query.to, "to");
  const pagination = parsePagination(request.query, { defaultLimit: 100, maxLimit: 500 });
  response.json(cashEnvelope(cashService.getCmfLines({ account, subaccount, from, to, pagination })));
}

function getMovementsTrend(request, response) {
  const account = optionalDigits(request.query.account, "account");
  const granularity =
    enumParam(request.query.granularity, ["day", "week", "month"], "granularity") || "month";
  const from = dateParam(request.query.from, "from");
  const to = dateParam(request.query.to, "to");
  response.json(cashEnvelope(cashService.getMovementsTrend({ account, granularity, from, to })));
}

function getProbe(request, response) {
  const full = boolParam(request.query.full);
  response.json(cashEnvelope(cashService.getProbe({ full })));
}

function getStatus(_request, response) {
  response.json(cashEnvelope(cashService.getStatus()));
}

module.exports = {
  getPosition,
  getTargets,
  getCandidates,
  getCmfSummary,
  getCmfBalances,
  getCmfLines,
  getMovementsTrend,
  getProbe,
  getStatus,
};

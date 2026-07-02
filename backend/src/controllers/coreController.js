const { envelope } = require("../lib/envelope");
const { parsePagination } = require("../lib/pagination");
const coreService = require("../services/coreService");

// Exact-compat: legacy body, unwrapped.
function health(_request, response) {
  response.json({ ok: true });
}

// Exact-compat: live Next.js frontend contract, unwrapped.
function status(_request, response) {
  response.json(coreService.getStatus());
}

function getConfig(_request, response) {
  const result = coreService.getPublicConfig();
  response.json(envelope(result.data, result.meta));
}

function getTheme(_request, response) {
  const result = coreService.getTheme();
  response.json(envelope(result.data, result.meta));
}

function getThemeCss(_request, response) {
  response.type("text/css; charset=utf-8").send(coreService.getThemeCss());
}

function getSummary(request, response) {
  const result = coreService.getSummary(request.query.entity);
  response.json(envelope(result.data, result.meta));
}

function listDashboards(request, response) {
  const pagination = parsePagination(request.query, { defaultLimit: 100, maxLimit: 500 });
  const result = coreService.getDashboards(pagination);
  response.json(envelope(result.data, result.meta));
}

function getDashboardData(request, response) {
  const result = coreService.getDashboardData(request.params.slug);
  response.json(envelope(result.data, result.meta));
}

module.exports = {
  health,
  status,
  getConfig,
  getTheme,
  getThemeCss,
  getSummary,
  listDashboards,
  getDashboardData,
};

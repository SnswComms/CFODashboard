const { envelope } = require("../lib/envelope");
const entitiesService = require("../services/entitiesService");

function send(response, result) {
  response.json(envelope(result.data, result.meta));
}

function listEntities(request, response) {
  send(response, entitiesService.getEntitiesList(request.query));
}

function getEntity(request, response) {
  send(response, entitiesService.getEntity(request.params.entityId));
}

function getConstituencyHistory(request, response) {
  send(response, entitiesService.getConstituencyHistory(request.query));
}

function getConstituencyYear(request, response) {
  send(response, entitiesService.getConstituencyYear(request.params.year));
}

function getConstituencyClaims(request, response) {
  send(response, entitiesService.getConstituencyClaims(request.query));
}

function getFieldPastoral(request, response) {
  send(response, entitiesService.getFieldPastoral());
}

function getFieldPastoralStaff(request, response) {
  send(response, entitiesService.getFieldPastoralStaff(request.query));
}

function getHistoryComparison(request, response) {
  send(response, entitiesService.getHistoryComparison(request.query));
}

function getEvidenceRegistry(request, response) {
  send(response, entitiesService.getEvidenceRegistry(request.query));
}

function getEvidenceMetric(request, response) {
  send(response, entitiesService.getEvidenceMetric(request.params.metricId));
}

function getEmailIntelligence(request, response) {
  send(response, entitiesService.getEmailIntelligence());
}

function getFinanceSources(request, response) {
  send(response, entitiesService.getFinanceSources(request.query));
}

function getFinanceLane(request, response) {
  send(response, entitiesService.getFinanceLane(request.params.laneId));
}

module.exports = {
  listEntities,
  getEntity,
  getConstituencyHistory,
  getConstituencyYear,
  getConstituencyClaims,
  getFieldPastoral,
  getFieldPastoralStaff,
  getHistoryComparison,
  getEvidenceRegistry,
  getEvidenceMetric,
  getEmailIntelligence,
  getFinanceSources,
  getFinanceLane,
};

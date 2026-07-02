const { envelope } = require("../lib/envelope");
const { parsePagination, paginate } = require("../lib/pagination");
const staffingService = require("../services/staffingService");

function pagedEnvelope(rows, meta, query, { defaultLimit = 100, maxLimit = 500 } = {}) {
  if (rows === null) return envelope(null, meta);
  const paged = paginate(rows, parsePagination(query, { defaultLimit, maxLimit }));
  return envelope(paged.rows, {
    ...meta,
    extra: { total: paged.total, limit: paged.limit, offset: paged.offset },
  });
}

// ---- staffing budget app -------------------------------------------------

async function getBudgetApp(request, response) {
  const { data, meta } = staffingService.getBudgetApp();
  response.json(envelope(data, meta));
}

async function getPastorLoad(request, response) {
  const { rows, meta } = staffingService.getPastorLoad();
  response.json(pagedEnvelope(rows, meta, request.query));
}

async function getPayroll(request, response) {
  const { payroll, meta } = staffingService.getPayroll(request.query.category);
  response.json(envelope(payroll, meta));
}

async function postScenario(request, response) {
  const { scenario, meta } = staffingService.computeScenario(request.body ?? {});
  response.json(envelope(scenario, meta));
}

// ---- office staff modelling map -------------------------------------------

async function getOfficeMap(request, response) {
  const { data, meta } = staffingService.getOfficeMap();
  response.json(envelope(data, meta));
}

async function getOfficePeople(request, response) {
  const { rows, meta } = staffingService.getOfficePeople({
    q: request.query.q,
    category: request.query.category,
  });
  response.json(pagedEnvelope(rows, meta, request.query));
}

// ---- staff role overrides (legacy bodies, unwrapped) -----------------------

async function getRoles(request, response) {
  response.json(staffingService.getRolesDocument());
}

async function postRoles(request, response) {
  try {
    response.json(staffingService.saveRoles(request.body));
  } catch (error) {
    // Byte-compatible with staff_role_api.py: 400 {"ok": false, "error": "..."}
    response.status(400).json({ ok: false, error: error.message });
  }
}

async function getRolesHealth(request, response) {
  response.json(staffingService.rolesHealth());
}

// ---- allowance emails (legacy bodies, unwrapped) ----------------------------

// Legacy allowance_email_server.py contract: any failure -> 500 {"error": "..."}
function legacyAllowanceHandler(produce) {
  return async (request, response) => {
    try {
      response.json(produce(request));
    } catch (error) {
      response.status(500).json({ error: error.message });
    }
  };
}

const getAllowancePreview = legacyAllowanceHandler(() => staffingService.getAllowancePreview());

const postAllowanceSend = legacyAllowanceHandler((request) =>
  staffingService.sendAllowanceEmails(request.body ?? {}));

module.exports = {
  getBudgetApp,
  getPastorLoad,
  getPayroll,
  postScenario,
  getOfficeMap,
  getOfficePeople,
  getRoles,
  postRoles,
  getRolesHealth,
  getAllowancePreview,
  postAllowanceSend,
};

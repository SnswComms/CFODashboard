const config = require("../config");
const { BadRequestError, UnavailableError } = require("../lib/errors");
const { enumParam } = require("../lib/validate");
const { capacityRecommendation } = require("./statusRules");
const { resolveData } = require("../repositories/dataSourceResolver");
const rolesRepository = require("../repositories/rolesRepository");

// Fixed office category whitelist from generate_office_staff_mapping_dashboard.py.
const OFFICE_CATEGORIES = [
  "Admin / Executive",
  "Finance",
  "Department director",
  "Department support",
  "Other conference",
];

const CONFIRM_TOKEN = "SEND_PASTOR_ALLOWANCES";

const PEOPLE_SEARCH_FIELDS = [
  "staff_id",
  "payroll_name",
  "final_category",
  "analysis_category",
  "category",
  "role",
  "job_or_area",
  "notes",
];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Mirrors money_num() from the Python generators: strip $/commas, parens = negative.
function moneyNum(value) {
  if (value === null || value === undefined || value === "") return 0;
  let candidate = value;
  if (typeof candidate === "string") {
    candidate = candidate.replace(/\$/g, "").replace(/,/g, "").replace(/\(/g, "-").replace(/\)/g, "");
  }
  const parsed = Number(candidate);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function isoSeconds() {
  return new Date().toISOString().slice(0, 19);
}

// ---------------------------------------------------------------------------
// Data loading (all reads go through the shared resolver)
// ---------------------------------------------------------------------------

function loadBudgetApp() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "staffing-budget-app-data.json" }],
    fixture: "staffing-budget-app.json",
  });
}

function loadOfficeMap() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "office-staff-modelling-map-data.json" }],
    fixture: "staffing-office-map.json",
  });
}

function loadAllowanceTargets() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: "allowance-email-preview-data.json" }],
    fixture: "staffing-allowance-targets.json",
  });
}

// ---------------------------------------------------------------------------
// Staffing budget app
// ---------------------------------------------------------------------------

function getBudgetApp() {
  return loadBudgetApp();
}

function getPastorLoad() {
  const { data, meta } = loadBudgetApp();
  const rows = data && Array.isArray(data.pastor_load) ? data.pastor_load : null;
  return { rows, meta };
}

function getPayroll(category) {
  const { data, meta } = loadBudgetApp();
  const payroll = data && isPlainObject(data.exact_payroll) ? data.exact_payroll : null;
  if (!payroll || !category) return { payroll, meta };
  const allowed = (payroll.by_category || []).map((entry) => entry.category);
  enumParam(category, allowed, "category");
  return {
    payroll: {
      ...payroll,
      by_category: (payroll.by_category || []).filter((entry) => entry.category === category),
      people: (payroll.people || []).filter((person) => person.category === category),
    },
    meta,
  };
}

function scenarioNumber(body, snakeKey, camelKey, fallback, name) {
  const raw = body[snakeKey] !== undefined ? body[snakeKey] : body[camelKey];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const parsed = Number(typeof raw === "string" ? raw.replace(/[$,]/g, "") : raw);
  if (!Number.isFinite(parsed)) throw new BadRequestError(`${name} must be a number`);
  return parsed;
}

// Replicates assess_staffing_capacity() plus the in-page recalc from
// generate_staffing_budget_app.py; expected values encoded in
// test_staffing_budget_app.py (max=tithe*ratio, headroom, fte 1dp).
function computeScenario(body) {
  if (!isPlainObject(body)) throw new BadRequestError("scenario body must be a JSON object");
  const { data: model, meta } = loadBudgetApp();
  if (!model) throw new UnavailableError("staffing budget app data unavailable");
  const assumptions = isPlainObject(model.assumptions) ? model.assumptions : {};
  const costs = isPlainObject(model.costs) ? model.costs : {};

  const packageCost =
    scenarioNumber(body, "package_cost", "packageCost", moneyNum(assumptions.package_cost), "package_cost") || 150000;
  const titheTarget = scenarioNumber(
    body, "tithe_target", "titheTarget", moneyNum(assumptions.default_tithe_target), "tithe_target");
  const targetStaffRatio = scenarioNumber(
    body, "target_staff_ratio", "targetStaffRatio", moneyNum(assumptions.target_staff_ratio), "target_staff_ratio");
  const extraFieldFte = scenarioNumber(body, "extra_field_fte", "extraFieldFte", 0, "extra_field_fte");
  const extraOfficeFte = scenarioNumber(body, "extra_office_fte", "extraOfficeFte", 0, "extra_office_fte");

  const currentCost = moneyNum(costs.total_placeholder_staff_cost);
  const projectedCost = round2(currentCost + (extraFieldFte + extraOfficeFte) * packageCost);
  const maxStaffCost = round2(titheTarget * targetStaffRatio);
  const headroom = round2(maxStaffCost - projectedCost);
  const fteHeadroom = packageCost ? round1(headroom / packageCost) : 0;

  // Threshold rule lives in statusRules; legacy wording preserved verbatim.
  const bucket = capacityRecommendation(fteHeadroom);
  let recommendation;
  if (bucket === "capacity to add staff") {
    recommendation = `Can afford about ${fteHeadroom.toFixed(1)} more FTE at the placeholder package, before governance/cash checks.`;
  } else if (bucket === "over target staffing capacity") {
    recommendation = `Scenario warning, not a staffing recommendation: over target by about ${Math.abs(fteHeadroom).toFixed(1)} FTE at the placeholder package unless income rises, costs move, or restricted/offset funding is confirmed.`;
  } else {
    recommendation = "No meaningful FTE headroom at the placeholder package; hold staffing unless offsetting savings/income are identified.";
  }

  return {
    scenario: {
      tithe_target: titheTarget,
      target_staff_ratio: targetStaffRatio,
      package_cost: packageCost,
      extra_field_fte: extraFieldFte,
      extra_office_fte: extraOfficeFte,
      projected_staff_cost: projectedCost,
      max_staff_cost_at_target: maxStaffCost,
      current_placeholder_staff_cost: currentCost,
      headroom,
      fte_headroom: fteHeadroom,
      recommendation,
    },
    meta,
  };
}

// ---------------------------------------------------------------------------
// Office staff modelling map
// ---------------------------------------------------------------------------

function getOfficeMap() {
  return loadOfficeMap();
}

function personCategory(row) {
  return row.final_category || row.analysis_category || row.category || "";
}

function getOfficePeople({ q, category } = {}) {
  enumParam(category, OFFICE_CATEGORIES, "category");
  const { data, meta } = loadOfficeMap();
  const people = data && Array.isArray(data.office_people) ? data.office_people : null;
  if (!people) return { rows: null, meta };
  let rows = people;
  if (category) rows = rows.filter((row) => personCategory(row) === category);
  if (q) {
    const needle = String(q).toLowerCase();
    rows = rows.filter((row) =>
      PEOPLE_SEARCH_FIELDS.some((field) => String(row[field] ?? "").toLowerCase().includes(needle)));
  }
  return { rows, meta };
}

// ---------------------------------------------------------------------------
// Staff role overrides (byte-compatible with staff_role_api.py)
// ---------------------------------------------------------------------------

function getRolesDocument() {
  return rolesRepository.readOverrides();
}

function saveRoles(body) {
  if (!isPlainObject(body)) throw new BadRequestError("roles must be an object");
  // Quirk preserved from staff_role_api.py: roles = incoming.get('roles', incoming)
  const roles = Object.prototype.hasOwnProperty.call(body, "roles") ? body.roles : body;
  if (!isPlainObject(roles)) throw new BadRequestError("roles must be an object");
  const existing = rolesRepository.readOverrides();
  const existingRoles = existing.roles;
  // Merge; only object values are applied, blank strings inside are kept.
  for (const [staffId, value] of Object.entries(roles)) {
    if (isPlainObject(value)) existingRoles[String(staffId)] = value;
  }
  rolesRepository.writeOverrides({ updated_at: isoSeconds(), roles: existingRoles });
  return { ok: true, saved: Object.keys(roles).length, file: rolesRepository.overridesPath() };
}

function rolesHealth() {
  return { ok: true, file: rolesRepository.overridesPath() };
}

// ---------------------------------------------------------------------------
// Allowance emails (legacy allowance_email_server.py bodies; never sends mail)
// ---------------------------------------------------------------------------

function fmtMoney2(value) {
  const amount = moneyNum(value);
  const formatted = `$${Math.abs(amount).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
  return amount < 0 ? `(${formatted})` : formatted;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function emailHtml(target, note) {
  const first = escapeHtml(String(target.name || "there").split(/\s+/)[0]);
  const rows = [
    `<tr><td>Employee Exempt Benefits / FTB balance</td><td style='text-align:right'>${fmtMoney2(target.ftb_balance)}</td><td>MYOB acct 312510 via Benefits Tracker; as at ${escapeHtml(target.ftb_as_of || "current sync")}</td></tr>`,
    `<tr><td>2026 Professional Development &amp; Equipment allowance</td><td style='text-align:right'>${fmtMoney2(target.pde_allowance_2026)}</td><td>2026 policy: base allowance for Ministerial Schedule employees</td></tr>`,
    `<tr><td>2026 Evangelist additional allowance</td><td style='text-align:right'>${fmtMoney2(target.evangelist_extra_2026)}</td><td>Only where approved/applicable</td></tr>`,
    `<tr><td>2026 First-year intern additional allowance</td><td style='text-align:right'>${fmtMoney2(target.first_year_intern_extra_2026)}</td><td>Only first-year interns</td></tr>`,
  ];
  if (target.book_balance_2025 !== null && target.book_balance_2025 !== undefined) {
    rows.push(`<tr><td>Book/equipment balance from 2025 workbook</td><td style='text-align:right'>${fmtMoney2(target.book_balance_2025)}</td><td>Prior workbook reference, not final 2026 MYOB balance</td></tr>`);
  }
  const noteBlock = note ? `<p>${escapeHtml(note)}</p>` : "";
  return `<div style='font-family:-apple-system,Segoe UI,Arial,sans-serif;color:#1f2937;line-height:1.5;max-width:760px'>
<p>Hi ${first},</p>
<p>For Monday's pastoral budget/allowance demo, here is your current allowance snapshot held in the finance dashboard.</p>
<table style='border-collapse:collapse;width:100%;font-size:14px'>
<thead><tr style='background:#f3f4f6'><th style='text-align:left;padding:8px'>Item</th><th style='text-align:right;padding:8px'>Amount</th><th style='text-align:left;padding:8px'>Source / note</th></tr></thead>
<tbody>${rows.join("")}</tbody></table>
<p><strong>Appointment context:</strong> ${escapeHtml(target.district || "")} — ${escapeHtml(target.assignment || "")}; ${escapeHtml(target.churches || "")}</p>
${noteBlock}
<p>If anything looks off, reply to this email and Finance can correct the source data before final release.</p>
<p style='font-size:12px;color:#6b7280'>Sent via snswfinance@adventist.bot from the CFO budget dashboard · ${new Date().toISOString().slice(0, 10)}</p>
</div>`;
}

function getAllowancePreview() {
  const { data } = loadAllowanceTargets();
  if (!data || !Array.isArray(data.targets)) {
    throw new Error("allowance email sources unavailable: no cached preview data or synthetic targets found");
  }
  return {
    generated_at: isoSeconds(),
    targets: data.targets,
    sources: isPlainObject(data.sources)
      ? data.sources
      : { pathways: null, pde_policy: null, book_2025: null, morpheus: null },
  };
}

// Double-gated exactly like allowance_email_server.py; this backend has no mail
// transport, so even a fully authorised live send only records "skipped".
function sendAllowanceEmails(payload) {
  const body = isPlainObject(payload) ? payload : {};
  const dryRun = body.dry_run === undefined ? true : Boolean(body.dry_run);
  const testTo = body.test_to || null;
  const onlyCodes = new Set(Array.isArray(body.only_codes) ? body.only_codes : []);
  const note = body.note || "";
  if (!dryRun && !config.allowanceLiveSendEnabled) {
    throw new Error(
      "Live send disabled in local CFO dashboard. Set SNSW_ALLOWANCE_EMAIL_LIVE_SEND=1 only after Kyle explicitly approves a live send session.");
  }
  if (!dryRun && body.confirm !== CONFIRM_TOKEN) {
    throw new Error(`Live send blocked. confirm must be '${CONFIRM_TOKEN}'.`);
  }
  let targets = getAllowancePreview().targets;
  if (onlyCodes.size > 0) targets = targets.filter((target) => onlyCodes.has(target.code));
  const results = targets.map((target) => {
    const to = testTo ? [testTo] : target.email ? [target.email] : [];
    const subject = body.subject || `Your 2026 allowance snapshot — ${new Date().toISOString().slice(0, 10)}`;
    const result = { name: target.name, code: target.code ?? null, to, subject, dry_run: dryRun };
    if (to.length === 0) {
      return { ...result, status: "skipped", reason: "no email matched" };
    }
    if (dryRun) {
      return { ...result, status: "preview", html: emailHtml(target, note) };
    }
    return { ...result, status: "skipped", reason: "live send not performed: no mail transport is configured in this backend" };
  });
  return {
    dry_run: dryRun,
    count: results.length,
    sent: results.filter((result) => result.status === "sent").length,
    results,
  };
}

module.exports = {
  OFFICE_CATEGORIES,
  getBudgetApp,
  getPastorLoad,
  getPayroll,
  computeScenario,
  getOfficeMap,
  getOfficePeople,
  getRolesDocument,
  saveRoles,
  rolesHealth,
  getAllowancePreview,
  sendAllowanceEmails,
};

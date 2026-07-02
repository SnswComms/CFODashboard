// Shared status/threshold derivations — every domain derives status through
// these rules so the thresholds exist exactly once.

function departmentStatus(remaining, usedPct) {
  if (typeof remaining === "number" && remaining < 0) return "over";
  if (typeof usedPct === "number" && usedPct > 85) return "tight";
  return "ok";
}

function healthStatus(warnings, errors) {
  if (errors && errors.length > 0) return "ERROR";
  if (warnings && warnings.length > 0) return "WARN";
  return "OK";
}

function decisionCardStatus(afterRequest, budget) {
  if (afterRequest >= Math.max(1000, budget * 0.1)) return "good";
  if (afterRequest >= 0) return "warn";
  return "bad";
}

function capacityRecommendation(fteHeadroom) {
  if (fteHeadroom >= 0.5) return "capacity to add staff";
  if (fteHeadroom <= -0.5) return "over target staffing capacity";
  return "at capacity";
}

module.exports = { departmentStatus, healthStatus, decisionCardStatus, capacityRecommendation };

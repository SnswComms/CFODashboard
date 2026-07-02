// Versioned chart-of-accounts mapping for the MYOB history layer. v1 is the
// CURRENT command-centre mapping extracted verbatim — nothing invented: the
// live derivation attributes P&L lines to functions by the FIRST MYOB
// subaccount segment/prefix (PREFIX_TO_DEPT in approvedBudget.js), NOT by GL
// account code, so the mapping key here is that prefix. laneId is the first
// DECISION_LANES lane whose function_terms match the department (EVA also
// feeds the faith_fm lane at runtime via detail terms; detail/exclude term
// filtering stays a runtime concern in commandCentreDerivation).
//
// Entries are FY-versioned (AU financial years labeled by ending year) so a
// future chart restructure appends new rows with their own effectiveFrom /
// effectiveTo instead of mutating history. effectiveFrom FY2024 is the MYOB
// data floor — no journal lines exist before 2023-10-11.
//
// FAM is deliberately NOT a mapping row: PREFIX_TO_DEPT keeps it visible as
// "UNMAPPED / FAMILY MINISTRIES", which is not an approved function — in the
// history layer that is exactly the first-class Unmapped outcome, so FAM
// resolves to null and lands in the explicit Unmapped bucket.

// Aggregation bucket label for codes the resolver returns null for. Unmapped
// is a first-class outcome — never fold these into a real function.
const UNMAPPED_FUNCTION = "Unmapped";

const ACCOUNT_MAPPING = [
  { prefix: "ADM", functionName: "ADMINISTRATION", laneId: "president_discretionary", effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "AAV", functionName: "ADVENTIST ALPINE VILLAGE", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "FLD", functionName: "FIELD", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "YTH", functionName: "YOUTH MINISTRY", laneId: "youth", effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "FFM", functionName: "FAITH FM ADMINISTRATION", laneId: "faith_fm", effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "COM", functionName: "COMMUNICATIONS", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "MIN", functionName: "MINISTERIAL", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "EVA", functionName: "EVANGELISM", laneId: "evangelism", effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "DEP", functionName: "PERSONAL MINISTRIES / DEPARTMENT LIAISONS", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "OTH", functionName: "OTHER OPERATIONS", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "BIG", functionName: "BIG CAMP", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "PRO", functionName: "PROPERTIES", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
  { prefix: "PER", functionName: "PERSONAL MINISTRIES / DEPARTMENT LIAISONS", laneId: null, effectiveFrom: "FY2024", effectiveTo: null },
];

module.exports = { ACCOUNT_MAPPING, UNMAPPED_FUNCTION };

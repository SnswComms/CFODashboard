// Resolver over the versioned chart-of-accounts mapping
// (constants/accountMapping.js). Pure and synchronous — no Mongo, no network.
// The mapping key follows the live derivation exactly: the FIRST subaccount
// segment/prefix (commandCentreDerivation.deptForSubaccount), looked up by
// full segment first and then by its first 3 characters.
const { ACCOUNT_MAPPING, UNMAPPED_FUNCTION } = require("../constants/accountMapping");

// Ending year of an AU financial year label — accepts 2025 or "FY2025".
function fyYear(fy) {
  const year = Number(String(fy).replace(/^FY/i, ""));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error(`invalid financial year: ${fy}`);
  }
  return year;
}

// First subaccount segment, split/trim/uppercase — same rule as the live
// derivation so history mapping can never drift from the dashboard's.
function mappingPrefix(subaccount) {
  return String(subaccount || "").split(/[-./ ]/)[0].trim().toUpperCase();
}

// A row is in force for a FY when effectiveFrom <= fy <= effectiveTo
// (effectiveTo null = still current).
function entryActive(entry, year) {
  return year >= fyYear(entry.effectiveFrom) && (entry.effectiveTo === null || year <= fyYear(entry.effectiveTo));
}

// (accountCode/subaccount, fy) -> { prefix, functionName, laneId } or null
// when the code has no mapping in force for that FY. Callers MUST route null
// into the explicit UNMAPPED_FUNCTION bucket, never a real function.
// `entries` is injectable so tests can exercise effectiveFrom/To boundaries.
function resolveMapping(code, fy, entries = ACCOUNT_MAPPING) {
  const year = fyYear(fy);
  const segment = mappingPrefix(code);
  if (segment === "") return null;
  const entry =
    entries.find((candidate) => candidate.prefix === segment && entryActive(candidate, year)) ||
    entries.find((candidate) => candidate.prefix === segment.slice(0, 3) && entryActive(candidate, year)) ||
    null;
  return entry ? { prefix: entry.prefix, functionName: entry.functionName, laneId: entry.laneId } : null;
}

module.exports = { resolveMapping, mappingPrefix, UNMAPPED_FUNCTION };

const config = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonFileRepository");

const OVERRIDES_FILE = "staff-role-overrides.json";

// The staff-role overrides live in the payroll data dir when one is configured
// (mirrors staff_role_api.py); otherwise they persist alongside the fixtures.
function overridesPath() {
  return config.resolve("payroll", OVERRIDES_FILE) || config.resolve("synthetic", OVERRIDES_FILE);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readOverrides() {
  const document = readJsonFile(overridesPath());
  if (isPlainObject(document)) {
    return {
      updated_at: document.updated_at ?? null,
      // Shallow-copy so callers can merge into `roles` without mutating the
      // shared mtime cache held by jsonFileRepository (per-staff entries are
      // replaced wholesale on merge, never mutated in place).
      roles: isPlainObject(document.roles) ? { ...document.roles } : {},
    };
  }
  return { updated_at: null, roles: {} };
}

function writeOverrides(document) {
  writeJsonFile(overridesPath(), document);
}

module.exports = { overridesPath, readOverrides, writeOverrides };

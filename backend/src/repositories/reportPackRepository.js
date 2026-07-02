const fs = require("fs");
const path = require("path");

const config = require("../config");
const { readJsonFile } = require("./jsonFileRepository");

// Department-budget report packs live in timestamped directories:
// <REPORT_PACKS_DIR>/department-budget/<YYYYMMDD-HHMMSS>/{four whitelisted files}
// plus an optional "latest" symlink (macOS) that may be absent on Windows.

const PACK_ID_PATTERN = /^\d{8}-\d{6}$/;

const PACK_FILE_CONTENT_TYPES = {
  "department-summary.csv": "text/csv",
  "department-lines.csv": "text/csv",
  "department-evidence-sample.csv": "text/csv",
  "source-manifest.json": "application/json",
};

function packsRoot() {
  return config.resolve("reportPacks", "department-budget");
}

function isValidPackId(id) {
  return id === "latest" || PACK_ID_PATTERN.test(String(id));
}

function isAllowedPackFile(file) {
  return Object.prototype.hasOwnProperty.call(PACK_FILE_CONTENT_TYPES, String(file));
}

function contentTypeFor(file) {
  return PACK_FILE_CONTENT_TYPES[String(file)] ?? null;
}

function listPackIds() {
  const root = packsRoot();
  if (!root) return [];
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => PACK_ID_PATTERN.test(entry.name) && entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

// "latest" resolves via the symlink when present, otherwise by newest dir name.
// Rejects anything outside the id whitelist so path traversal is impossible
// even if a caller skips its own validation.
function resolvePackId(id) {
  if (!isValidPackId(id)) return null;
  const root = packsRoot();
  if (!root) return null;
  if (id === "latest") {
    const latestPath = path.join(root, "latest");
    try {
      if (fs.statSync(latestPath).isDirectory()) return "latest";
    } catch {
      // fall through to newest timestamped directory
    }
    const ids = listPackIds();
    return ids.length > 0 ? ids[0] : null;
  }
  try {
    return fs.statSync(path.join(root, id)).isDirectory() ? id : null;
  } catch {
    return null;
  }
}

function readManifest(packId) {
  const root = packsRoot();
  if (!root) return null;
  return readJsonFile(path.join(root, packId, "source-manifest.json"));
}

function listPacks() {
  return listPackIds().map((id) => {
    const manifest = readManifest(id);
    return {
      id,
      generated_at: manifest?.generated_at ?? null,
      source_kind: manifest?.period_context?.source_kind ?? null,
      files: manifest?.files ?? null,
    };
  });
}

// Returns {absolutePath, contentType} for an existing whitelisted pack file, else null.
function resolvePackFile(id, file) {
  if (!isAllowedPackFile(file)) return null;
  const root = packsRoot();
  if (!root) return null;
  const resolvedId = resolvePackId(id);
  if (!resolvedId) return null;
  const absolutePath = path.join(root, resolvedId, file);
  try {
    if (!fs.statSync(absolutePath).isFile()) return null;
  } catch {
    return null;
  }
  return { absolutePath, contentType: contentTypeFor(file) };
}

module.exports = {
  packsRoot,
  isValidPackId,
  isAllowedPackFile,
  listPacks,
  resolvePackFile,
};

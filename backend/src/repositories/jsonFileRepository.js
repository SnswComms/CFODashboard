const fs = require("fs");

const cache = new Map();

function statOrNull(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function readJsonFile(filePath) {
  if (!filePath) return null;
  const stat = statOrNull(filePath);
  if (!stat || !stat.isFile()) return null;
  const cached = cache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.value;
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    cache.set(filePath, { mtimeMs: stat.mtimeMs, value });
    return value;
  } catch {
    return null;
  }
}

function fileModifiedAt(filePath) {
  const stat = filePath ? statOrNull(filePath) : null;
  return stat ? stat.mtime.toISOString() : null;
}

// Atomic write (temp file + rename) so readers never see a half-written cache.
function writeJsonFile(filePath, value) {
  fs.mkdirSync(require("path").dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
  cache.delete(filePath);
}

module.exports = { readJsonFile, fileModifiedAt, writeJsonFile };

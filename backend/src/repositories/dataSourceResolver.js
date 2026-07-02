const config = require("../config");
const { readJsonFile, fileModifiedAt } = require("./jsonFileRepository");
const { readFixture } = require("./syntheticRepository");

// Single fallback policy for every read: live cache candidates in order,
// then the synthetic fixture, then an explicit "missing" result.
// candidates: [{ dirKey, file }] resolved against configured data dirs.
function resolveData({ candidates = [], fixture = null, transform = null }) {
  for (const candidate of candidates) {
    const filePath = config.resolve(candidate.dirKey, candidate.file);
    const raw = readJsonFile(filePath);
    if (raw !== null && raw !== undefined) {
      const data = transform ? transform(raw) : raw;
      return {
        data,
        meta: {
          dataSource: "live-cache",
          sourcePath: filePath,
          generated_at: raw.generated_at ?? fileModifiedAt(filePath),
        },
      };
    }
  }
  if (fixture) {
    const raw = readFixture(fixture);
    if (raw !== null && raw !== undefined) {
      const data = transform ? transform(raw) : raw;
      return {
        data,
        meta: { dataSource: "synthetic", sourcePath: null, generated_at: raw.generated_at ?? null },
      };
    }
  }
  return { data: null, meta: { dataSource: "missing", sourcePath: null, generated_at: null } };
}

module.exports = { resolveData };

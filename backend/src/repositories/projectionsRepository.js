const config = require("../config");
const { readJsonFile, writeJsonFile } = require("./jsonFileRepository");

// FY2027 FIELD line projections, persisted as {savedAt, field:{<line>: number}}.
// Written to the configured dashboards data dir when available, otherwise to the
// synthetic fixtures dir so the store still works without CFO_DATA_DIR.

const PROJECTIONS_FILE = "field-budget-projections.json";

function projectionsTarget() {
  const livePath = config.resolve("dashboards", PROJECTIONS_FILE);
  if (livePath) return { filePath: livePath, dataSource: "live-cache" };
  return { filePath: config.resolve("synthetic", PROJECTIONS_FILE), dataSource: "synthetic" };
}

function readProjections() {
  const target = projectionsTarget();
  return { ...target, value: readJsonFile(target.filePath) };
}

function writeProjections(value) {
  const target = projectionsTarget();
  writeJsonFile(target.filePath, value);
  return target;
}

module.exports = { readProjections, writeProjections };

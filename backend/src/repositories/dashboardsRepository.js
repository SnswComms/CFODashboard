const fs = require("fs");

const config = require("../config");
const { fileModifiedAt } = require("./jsonFileRepository");

const DATA_SUFFIX = "-data.json";
const HTML_SUFFIX = ".html";

// Filename whitelist: dashboard slugs are plain lowercase-ish tokens; anything
// else (dots, slashes, encoded traversal) is rejected before touching the fs.
const SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]*$/i;

function isSafeSlug(slug) {
  return SLUG_PATTERN.test(String(slug));
}

function dashboardsRoot() {
  return config.dirs.dashboards;
}

// Scan DASHBOARDS_DIR for generated artifacts: `<slug>.html` pages and
// `<slug>-data.json` payloads. Returns null when the dir is unset or missing.
function listDashboardEntries() {
  const root = dashboardsRoot();
  if (!root) return null;
  let names;
  try {
    names = fs.readdirSync(root);
  } catch {
    return null;
  }
  const bySlug = new Map();
  const entryFor = (slug) => {
    if (!bySlug.has(slug)) bySlug.set(slug, { slug, htmlFile: null, jsonFile: null });
    return bySlug.get(slug);
  };
  for (const name of names) {
    const lower = name.toLowerCase();
    if (lower.endsWith(DATA_SUFFIX)) {
      entryFor(name.slice(0, -DATA_SUFFIX.length)).jsonFile = name;
    } else if (lower.endsWith(HTML_SUFFIX)) {
      entryFor(name.slice(0, -HTML_SUFFIX.length)).htmlFile = name;
    }
  }
  return [...bySlug.values()]
    .filter((entry) => isSafeSlug(entry.slug))
    .map((entry) => ({
      slug: entry.slug,
      htmlFile: entry.htmlFile,
      jsonFile: entry.jsonFile,
      modifiedAt: latestModifiedAt(entry),
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

function latestModifiedAt(entry) {
  const stamps = [entry.htmlFile, entry.jsonFile]
    .filter(Boolean)
    .map((file) => fileModifiedAt(config.resolve("dashboards", file)))
    .filter(Boolean)
    .sort();
  return stamps.length > 0 ? stamps[stamps.length - 1] : null;
}

// Filename convention for a dashboard's JSON payload lives here only; the
// actual read goes through dataSourceResolver.resolveData (single fallback
// policy) — no bespoke read function in this repository.
function dataFileFor(slug) {
  return `${slug}${DATA_SUFFIX}`;
}

module.exports = { listDashboardEntries, dashboardsRoot, isSafeSlug, dataFileFor };

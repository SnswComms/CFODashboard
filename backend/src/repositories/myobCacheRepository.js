const fs = require("fs");
const path = require("path");

const config = require("../config");
const { digitsParam } = require("../lib/validate");
const { readJsonFile, fileModifiedAt } = require("./jsonFileRepository");
const { readFixture } = require("./syntheticRepository");
const { resolveData } = require("./dataSourceResolver");

// Relative locations of the MYOB caches under MYOB_CACHE_DIR (mirrors the
// Python extractor output layout under finance/myob-cache/).
const CACHE_FILES = {
  broad: path.join("morpheus-broad-readonly", "morpheus-broad-readonly-cache.json"),
  liveGl: path.join("live-gl", "myob-live-gl-latest.json"),
  liveGlSummary: path.join("live-gl", "myob-live-gl-summary.json"),
  benefits: path.join("morpheus-benefits-312510", "morpheus-benefits-312510-cache.json"),
  drilldownSummary: path.join("account-drilldowns", "key-account-drilldown-summary.json"),
};

const FIXTURES = {
  broad: "myob-broad.json",
  liveGl: "myob-live-gl.json",
  benefits: "myob-benefits.json",
  drilldowns: "myob-drilldowns.json",
};

const DRILLDOWN_FILE_PATTERN = /^myob-account-([0-9]+)-drilldown\.json$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Flatten MYOB Advanced {value: x} wrappers, drop custom/_links/note, and keep
// nested arrays (e.g. journal Details) — mirrors the Python simp() helper but
// preserves detail arrays so callers can roll lines up.
function flattenRecord(record) {
  if (Array.isArray(record)) return record.map(flattenRecord);
  if (!record || typeof record !== "object") return record;
  const flattened = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "custom" || key === "_links" || key === "note") continue;
    if (value && typeof value === "object" && !Array.isArray(value) && "value" in value) {
      flattened[key] = value.value;
    } else if (Array.isArray(value)) {
      flattened[key] = value.map(flattenRecord);
    } else if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      flattened[key] = value;
    }
  }
  return flattened;
}

// First non-null, non-empty field from a fallback chain (Python val(row, *names)).
function pickField(record, ...names) {
  if (!record || typeof record !== "object") return "";
  for (const name of names) {
    const value = record[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

// myobService addresses the broad journal sample through this exact endpoint
// key (its JOURNAL_SAMPLE_KEY constant). Live sync runs name the key after the
// actual extract window start (JournalTransaction_since_<from>_sample), so the
// loader renames any JournalTransaction* key to the canonical one when the
// canonical key is absent. Idempotent for the fixture, which already uses it.
const CANONICAL_JOURNAL_SAMPLE_KEY = "JournalTransaction_since_2025_07_01_sample";

function normalizeBroadCache(raw) {
  if (!raw || typeof raw !== "object" || !raw.endpoints) return raw;
  if (raw.endpoints[CANONICAL_JOURNAL_SAMPLE_KEY]) return raw;
  const journalKey = Object.keys(raw.endpoints).find((key) => key.startsWith("JournalTransaction"));
  if (!journalKey) return raw;
  const { [journalKey]: journalRecord, ...rest } = raw.endpoints;
  return { ...raw, endpoints: { ...rest, [CANONICAL_JOURNAL_SAMPLE_KEY]: journalRecord } };
}

function loadBroad() {
  return resolveData({
    candidates: [{ dirKey: "myobCache", file: CACHE_FILES.broad }],
    fixture: FIXTURES.broad,
    transform: normalizeBroadCache,
  });
}

function loadLiveGl() {
  return resolveData({
    candidates: [{ dirKey: "myobCache", file: CACHE_FILES.liveGl }],
    fixture: FIXTURES.liveGl,
  });
}

function windowCacheFile(fromDate, toDate) {
  if (!ISO_DATE_PATTERN.test(String(fromDate || "")) || !ISO_DATE_PATTERN.test(String(toDate || ""))) return null;
  return path.join("live-gl", "windows", `myob-live-gl-${fromDate}_to_${toDate}.json`);
}

function loadLiveGlForRange(range = {}) {
  const file = windowCacheFile(range.fromDate, range.toDate);
  if (!file) return loadLiveGl();
  const exact = resolveData({
    candidates: [{ dirKey: "myobCache", file }],
  });
  return exact.meta.dataSource === "live-cache" ? exact : loadLiveGl();
}

// Summary file only exists next to a live extract; callers derive a summary
// from the full cache when this comes back missing.
function loadLiveGlSummary() {
  return resolveData({
    candidates: [{ dirKey: "myobCache", file: CACHE_FILES.liveGlSummary }],
  });
}

function loadBenefits() {
  return resolveData({
    candidates: [{ dirKey: "myobCache", file: CACHE_FILES.benefits }],
    fixture: FIXTURES.benefits,
  });
}

// Per-account drilldown. Live: one file per account; synthetic: the fixture
// keeps all drilldowns under an accounts map keyed by code. The code goes into
// a filename, so it is re-sanitized here regardless of caller validation.
function loadDrilldown(code) {
  const safeCode = digitsParam(code, "code");
  return resolveData({
    candidates: [
      { dirKey: "myobCache", file: path.join("account-drilldowns", `myob-account-${safeCode}-drilldown.json`) },
    ],
    fixture: FIXTURES.drilldowns,
    transform: (raw) => (raw && raw.accounts && !raw.account ? raw.accounts[safeCode] ?? null : raw),
  });
}

function drilldownExists(code) {
  const { data } = loadDrilldown(code);
  return data !== null && data !== undefined;
}

// Tolerates both key-account summary writer shapes ({accounts:[...]} items
// with or without label/exit_code) plus the synthetic fixture wrapper.
function loadDrilldownSummary() {
  return resolveData({
    candidates: [{ dirKey: "myobCache", file: CACHE_FILES.drilldownSummary }],
    fixture: FIXTURES.drilldowns,
    transform: (raw) => (raw && raw.summary ? raw.summary : raw),
  });
}

function listDrilldownCodes() {
  const dir = config.resolve("myobCache", "account-drilldowns");
  if (dir) {
    try {
      const codes = fs
        .readdirSync(dir)
        .map((name) => DRILLDOWN_FILE_PATTERN.exec(name))
        .filter(Boolean)
        .map((match) => match[1]);
      if (codes.length > 0) return { codes, synthetic: false };
    } catch {
      // fall through to the synthetic fixture
    }
  }
  const fixture = readFixture(FIXTURES.drilldowns);
  return { codes: Object.keys((fixture && fixture.accounts) || {}), synthetic: true };
}

function describeSources() {
  const entries = [
    { key: "broad", file: CACHE_FILES.broad, fixture: FIXTURES.broad },
    { key: "live-gl", file: CACHE_FILES.liveGl, fixture: FIXTURES.liveGl },
    { key: "benefits", file: CACHE_FILES.benefits, fixture: FIXTURES.benefits },
    { key: "drilldowns", file: CACHE_FILES.drilldownSummary, fixture: FIXTURES.drilldowns },
  ];
  return entries.map(({ key, file, fixture }) => {
    const livePath = config.resolve("myobCache", file);
    const live = readJsonFile(livePath);
    if (live !== null && live !== undefined) {
      return {
        key,
        path: livePath,
        exists: true,
        synthetic: false,
        generated_at: live.generated_at ?? fileModifiedAt(livePath),
      };
    }
    const fallback = readFixture(fixture);
    return {
      key,
      path: livePath,
      exists: false,
      synthetic: fallback !== null && fallback !== undefined,
      generated_at: (fallback && fallback.generated_at) ?? null,
    };
  });
}

module.exports = {
  flattenRecord,
  pickField,
  CANONICAL_JOURNAL_SAMPLE_KEY,
  normalizeBroadCache,
  loadBroad,
  loadLiveGl,
  loadLiveGlForRange,
  windowCacheFile,
  loadLiveGlSummary,
  loadBenefits,
  loadDrilldown,
  drilldownExists,
  loadDrilldownSummary,
  listDrilldownCodes,
  describeSources,
};

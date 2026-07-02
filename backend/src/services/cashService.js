const { UnavailableError } = require("../lib/errors");
const { paginate } = require("../lib/pagination");
const { resolveData } = require("../repositories/dataSourceResolver");
const {
  SOURCE_RULE,
  SOURCE_STATUS_NOT_REFRESHED,
  CMF_STATUS_NOT_REFRESHED,
  TARGET_STATUS_AWAITING,
  WESTPAC_TARGETS,
  CMF_TARGETS,
  RECOMMENDED_MYOB_ACCOUNTS,
} = require("../constants/cashTargets");

const POSITION_FILE = "cash-position-dashboard-data.json";
const PROBE_LATEST_FILE = "cash-position/myob-cash-endpoint-probe-latest.json";
const PROBE_SUMMARY_FILE = "cash-position/myob-cash-endpoint-probe-summary.json";
const CMF_SUMMARY_FILE = "cmf-cash/myob-cmf-cash-summary.json";
const CMF_LATEST_FILE = "cmf-cash/myob-cmf-cash-latest.json";

const POSITION_FIXTURE = "cash-position.json";
const PROBE_FIXTURE = "cash-probe.json";
const CMF_FIXTURE = "cash-cmf.json";

const CMF_MOVEMENT_WARNING =
  "balances_by_account values are net movements over the extract window, not balances";

// Port of mask_account in generate_cash_position_dashboard.py (idempotent for
// identifiers stored pre-masked in constants).
function maskAccount(identifier) {
  const text = String(identifier ?? "");
  if (text.includes("••••")) return text;
  const raw = text.replace(/[^0-9a-zA-Z]/g, "");
  if (raw.length <= 4) return "••••";
  return `•••• ${raw.slice(-4)}`;
}

function maskTargets(targets, unmasked) {
  if (!Array.isArray(targets)) return targets;
  if (unmasked) return targets;
  return targets.map((target) => ({ ...target, external_account: maskAccount(target.external_account) }));
}

function constantTargets() {
  return [...WESTPAC_TARGETS, ...CMF_TARGETS].map((target) => ({
    ...target,
    myob_source: null,
    myob_balance: null,
    status: TARGET_STATUS_AWAITING,
  }));
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function nowIsoSeconds() {
  return new Date().toISOString().slice(0, 19);
}

function resolvePositionFile() {
  return resolveData({ candidates: [{ dirKey: "dashboards", file: POSITION_FILE }] });
}

// Latest probe cache, optionally also accepting the summary cache and/or the
// synthetic fixture as fallbacks. Single definition of the probe candidates.
function resolveProbe({ fixture = false, includeSummary = false } = {}) {
  const candidates = [{ dirKey: "myobCache", file: PROBE_LATEST_FILE }];
  if (includeSummary) candidates.push({ dirKey: "myobCache", file: PROBE_SUMMARY_FILE });
  return resolveData({ candidates, fixture: fixture ? PROBE_FIXTURE : null });
}

function stripLines(document) {
  const { lines, ...rest } = document;
  return rest;
}

// CMF summary document (lines always stripped): summary cache, then the
// latest cache, then optionally the synthetic fixture.
function resolveCmfSummaryDoc({ fixture = false } = {}) {
  return resolveData({
    candidates: [
      { dirKey: "myobCache", file: CMF_SUMMARY_FILE },
      { dirKey: "myobCache", file: CMF_LATEST_FILE },
    ],
    fixture: fixture ? CMF_FIXTURE : null,
    transform: stripLines,
  });
}

// CMF document with journal lines: latest cache, then the synthetic fixture.
function resolveCmfLatest() {
  return resolveData({
    candidates: [{ dirKey: "myobCache", file: CMF_LATEST_FILE }],
    fixture: CMF_FIXTURE,
  });
}

function sourceStatusLine(probeData) {
  return probeData
    ? `MYOB cash endpoint probe ${probeData.generated_at}`
    : SOURCE_STATUS_NOT_REFRESHED;
}

function cmfStatusLine(cmfData) {
  return cmfData ? `MYOB CMF cash extractor ${cmfData.generated_at}` : CMF_STATUS_NOT_REFRESHED;
}

function maskedPositionResult(document, meta, unmasked) {
  const data = { source_rule: SOURCE_RULE, ...document };
  data.targets = maskTargets(data.targets, unmasked);
  return { data, meta };
}

// /position — dashboard file, else assembled from probe + CMF caches
// (mirrors generate_cash_position_dashboard.py), else synthetic fixture,
// else explicit missing placeholders (targets always come from constants).
function getPosition({ unmasked = false } = {}) {
  const fromFile = resolvePositionFile();
  if (fromFile.meta.dataSource === "live-cache") {
    return maskedPositionResult(fromFile.data, fromFile.meta, unmasked);
  }

  const probe = resolveProbe();
  const cmf = resolveCmfSummaryDoc();
  if (probe.meta.dataSource === "live-cache" || cmf.meta.dataSource === "live-cache") {
    const data = {
      generated_at: nowIsoSeconds(),
      source_rule: SOURCE_RULE,
      source_status: sourceStatusLine(probe.data),
      cmf_status: cmfStatusLine(cmf.data),
      cash_account_candidates: (probe.data && probe.data.cash_account_candidates) || [],
      targets: maskTargets(constantTargets(), unmasked),
      recommended_myob_accounts: RECOMMENDED_MYOB_ACCOUNTS,
    };
    const liveMeta = probe.meta.dataSource === "live-cache" ? probe.meta : cmf.meta;
    return {
      data,
      meta: {
        dataSource: "live-cache",
        sourcePath: liveMeta.sourcePath,
        generated_at: data.generated_at,
        warnings: ["assembled from probe/CMF caches; cash-position dashboard file not present"],
      },
    };
  }

  const fixture = resolveData({ fixture: POSITION_FIXTURE });
  if (fixture.meta.dataSource === "synthetic") {
    return maskedPositionResult(fixture.data, fixture.meta, unmasked);
  }

  return {
    data: {
      generated_at: null,
      source_rule: SOURCE_RULE,
      source_status: SOURCE_STATUS_NOT_REFRESHED,
      cmf_status: CMF_STATUS_NOT_REFRESHED,
      cash_account_candidates: [],
      targets: maskTargets(constantTargets(), unmasked),
      recommended_myob_accounts: RECOMMENDED_MYOB_ACCOUNTS,
    },
    meta: {
      dataSource: "missing",
      sourcePath: null,
      generated_at: null,
      warnings: ["no cash caches or fixtures available; targets served from constants"],
    },
  };
}

function getTargets({ system, unmasked = false } = {}) {
  const position = getPosition({ unmasked });
  let targets = Array.isArray(position.data.targets) ? position.data.targets : [];
  if (system) targets = targets.filter((target) => target.system === system);
  return { data: { targets }, meta: position.meta };
}

function coalesceCandidate(row) {
  return {
    _endpoint: firstNonEmpty(row._endpoint),
    account: firstNonEmpty(row.CashAccountCD, row.AccountCD, row.AccountID),
    description: firstNonEmpty(row.Description, row.Descr, row.Name),
    balance: firstNonEmpty(row.Balance, row.CurrentBalance, row.AvailableBalance),
    raw: row,
  };
}

function getCandidates({ endpoint, pagination } = {}) {
  const probe = resolveProbe({ fixture: true });
  const rawCandidates = (probe.data && probe.data.cash_account_candidates) || [];
  let candidates = rawCandidates.map(coalesceCandidate);
  if (endpoint) candidates = candidates.filter((candidate) => candidate._endpoint === endpoint);
  const page = paginate(candidates, pagination);
  return {
    data: {
      generated_at: probe.data ? probe.data.generated_at ?? null : null,
      count: page.rows.length,
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      candidates: page.rows,
    },
    meta: probe.meta,
  };
}

function getCmfSummary() {
  const summary = resolveCmfSummaryDoc({ fixture: true });
  const warnings = [CMF_MOVEMENT_WARNING];
  if (summary.meta.dataSource === "missing") {
    return {
      data: {
        generated_at: null,
        source: null,
        from_date: null,
        to_date: null,
        base_endpoint_family: null,
        target_accounts: [],
        journals_scanned: null,
        line_count: null,
        accounts: [],
        balances_by_account: null,
        balances_by_account_subaccount: null,
      },
      meta: { ...summary.meta, warnings: [...warnings, CMF_STATUS_NOT_REFRESHED] },
    };
  }
  return { data: summary.data, meta: { ...summary.meta, warnings } };
}

function getCmfBalances({ account, groupBy = "account" } = {}) {
  const summary = getCmfSummary();
  const document = summary.data;
  let byAccount = document.balances_by_account ?? null;
  let byAccountSubaccount = document.balances_by_account_subaccount ?? null;
  if (account && byAccount) {
    byAccount = Object.fromEntries(
      Object.entries(byAccount).filter(([accountCode]) => accountCode === account)
    );
  }
  if (account && Array.isArray(byAccountSubaccount)) {
    byAccountSubaccount = byAccountSubaccount.filter((row) => row.account === account);
  }
  return {
    data: { as_of: document.generated_at ?? null, groupBy, byAccount, byAccountSubaccount },
    meta: summary.meta,
  };
}

function lineDate(line) {
  return String(line.date ?? "").slice(0, 10);
}

function filterLines(lines, { account, subaccount, from, to }) {
  return lines.filter((line) => {
    if (account && line.account !== account) return false;
    if (subaccount && line.subaccount !== subaccount) return false;
    const date = lineDate(line);
    if (from && (!date || date < from)) return false;
    if (to && (!date || date > to)) return false;
    return true;
  });
}

function resolveCmfLinesSource() {
  const latest = resolveCmfLatest();
  if (latest.meta.dataSource === "live-cache" && !Array.isArray(latest.data.lines)) {
    throw new UnavailableError(
      "CMF journal lines unavailable: cache file has no lines array; re-run the CMF extractor"
    );
  }
  if (latest.meta.dataSource !== "live-cache") {
    const summaryOnly = resolveData({ candidates: [{ dirKey: "myobCache", file: CMF_SUMMARY_FILE }] });
    if (summaryOnly.meta.dataSource === "live-cache") {
      throw new UnavailableError(
        "CMF journal lines unavailable: only the summary cache exists (lines are stripped from myob-cmf-cash-summary.json)"
      );
    }
  }
  return latest;
}

function getCmfLines({ account, subaccount, from, to, pagination } = {}) {
  const source = resolveCmfLinesSource();
  const lines = (source.data && source.data.lines) || [];
  const filtered = filterLines(lines, { account, subaccount, from, to });
  const page = paginate(filtered, pagination);
  return {
    data: { total: page.total, limit: page.limit, offset: page.offset, lines: page.rows },
    meta: source.meta,
  };
}

function isoWeekKey(dateText) {
  const target = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(target.getTime())) return null;
  const dayNumber = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNumber + 3);
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 3600 * 1000));
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function periodKey(dateText, granularity) {
  if (!dateText) return null;
  if (granularity === "day") return dateText;
  if (granularity === "week") return isoWeekKey(dateText);
  return dateText.slice(0, 7);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function getMovementsTrend({ account, granularity = "month", from, to } = {}) {
  const source = resolveCmfLatest();
  const lines = (source.data && source.data.lines) || [];
  const filtered = filterLines(lines, { account, from, to });
  const buckets = new Map();
  for (const line of filtered) {
    const key = periodKey(lineDate(line), granularity);
    if (!key) continue;
    const bucket = buckets.get(key) || { period: key, net_debit: 0, debit: 0, credit: 0, line_count: 0 };
    bucket.net_debit += Number(line.net_debit) || 0;
    bucket.debit += Number(line.debit) || 0;
    bucket.credit += Number(line.credit) || 0;
    bucket.line_count += 1;
    buckets.set(key, bucket);
  }
  const series = [...buckets.values()]
    .map((bucket) => ({
      period: bucket.period,
      net_debit: round2(bucket.net_debit),
      debit: round2(bucket.debit),
      credit: round2(bucket.credit),
      line_count: bucket.line_count,
    }))
    .sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  const meta =
    source.meta.dataSource === "missing"
      ? { ...source.meta, warnings: ["no CMF journal lines available; trend series is empty"] }
      : source.meta;
  return {
    data: { account: account ?? null, granularity, from: from ?? null, to: to ?? null, series },
    meta,
  };
}

function deriveProbeSummary(document) {
  const endpoints = (document && document.endpoints) || {};
  return {
    generated_at: document ? document.generated_at ?? null : null,
    base: document ? document.base ?? null : null,
    ok_endpoints: Object.entries(endpoints)
      .filter(([, info]) => info && info.status === 200)
      .map(([name]) => name),
    cash_account_candidate_count: document
      ? ((document.cash_account_candidates && document.cash_account_candidates.length) ?? 0)
      : null,
  };
}

function getProbe({ full = false } = {}) {
  if (full) {
    const latest = resolveProbe({ fixture: true });
    if (latest.meta.dataSource === "missing") {
      return {
        data: { generated_at: null, base: null, endpoints: null, cash_account_candidates: [] },
        meta: { ...latest.meta, warnings: [SOURCE_STATUS_NOT_REFRESHED] },
      };
    }
    return latest;
  }

  const summary = resolveData({ candidates: [{ dirKey: "myobCache", file: PROBE_SUMMARY_FILE }] });
  if (summary.meta.dataSource === "live-cache") return summary;

  const latest = resolveProbe({ fixture: true });
  if (latest.meta.dataSource === "missing") {
    return {
      data: deriveProbeSummary(null),
      meta: { ...latest.meta, warnings: [SOURCE_STATUS_NOT_REFRESHED] },
    };
  }
  return { data: deriveProbeSummary(latest.data), meta: latest.meta };
}

function getStatus() {
  const probe = resolveProbe({ fixture: true, includeSummary: true });
  const cmf = resolveCmfSummaryDoc({ fixture: true });
  const sources = [probe.meta.dataSource, cmf.meta.dataSource];
  const dataSource = sources.includes("live-cache")
    ? "live-cache"
    : sources.includes("synthetic")
      ? "synthetic"
      : "missing";
  const data = {
    source_status: sourceStatusLine(probe.data),
    cmf_status: cmfStatusLine(cmf.data),
    probe: {
      exists: probe.meta.dataSource !== "missing",
      generated_at: probe.data ? probe.data.generated_at ?? null : null,
    },
    cmf: {
      exists: cmf.meta.dataSource !== "missing",
      generated_at: cmf.data ? cmf.data.generated_at ?? null : null,
    },
    dataSource,
  };
  return {
    data,
    meta: {
      dataSource,
      sourcePath: probe.meta.sourcePath ?? cmf.meta.sourcePath ?? null,
      generated_at: data.probe.generated_at ?? data.cmf.generated_at ?? null,
    },
  };
}

module.exports = {
  SOURCE_RULE,
  maskAccount,
  getPosition,
  getTargets,
  getCandidates,
  getCmfSummary,
  getCmfBalances,
  getCmfLines,
  getMovementsTrend,
  getProbe,
  getStatus,
};

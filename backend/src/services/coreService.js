const config = require("../config");
const { BadRequestError, NotFoundError } = require("../lib/errors");
const { paginate } = require("../lib/pagination");
const { matchesSlugOrName, slugify } = require("../lib/slug");
const { THEME_NAME, THEME_TOKENS, STRIPE_CFO_CSS } = require("../constants/themeTokens");
const { resolveData } = require("../repositories/dataSourceResolver");
const dashboardsRepository = require("../repositories/dashboardsRepository");

const SUMMARY_FIXTURE = "summary.json";

// Exact live frontend contract — field names must not change.
function getStatus() {
  return {
    app: "CFO Dashboard API",
    status: "ready",
    timestamp: new Date().toISOString(),
  };
}

// Non-secret runtime configuration only; never expose env values verbatim
// beyond resolved directory roots.
function getPublicConfig() {
  return {
    data: {
      dashboardsRoot: config.dirs.dashboards ?? null,
      workspaceRoot: config.cfoDataDir ?? null,
      dataMode: config.dataMode(),
      port: config.port,
    },
    meta: { dataSource: config.dataMode(), sourcePath: null, generated_at: null },
  };
}

function getTheme() {
  return {
    data: { name: THEME_NAME, tokens: { ...THEME_TOKENS } },
    meta: { dataSource: "synthetic", sourcePath: null, generated_at: null },
  };
}

function getThemeCss() {
  return STRIPE_CFO_CSS;
}

// Entity income/expense/net rollup; snake_case field names preserved for
// parity with the Python generators (generated_at, source, entities).
function getSummary(entityFilter) {
  const result = resolveData({
    candidates: [
      { dirKey: "dashboards", file: dashboardsRepository.dataFileFor("summary") },
      { dirKey: "dashboards", file: "summary.json" },
    ],
    fixture: SUMMARY_FIXTURE,
  });
  if (result.data === null) {
    return {
      data: { generated_at: null, source: null, entities: null },
      meta: result.meta,
    };
  }
  let data = result.data;
  if (entityFilter !== undefined && entityFilter !== null && entityFilter !== "") {
    const entities = Array.isArray(data.entities)
      ? data.entities.filter((row) => matchesSlugOrName(entityFilter, row.name))
      : [];
    data = { ...data, entities };
  }
  return { data, meta: result.meta };
}

function titleFromSlug(slug) {
  return String(slug)
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function getDashboards(pagination) {
  const entries = dashboardsRepository.listDashboardEntries();
  if (entries === null) {
    return {
      data: { dashboards: [], total: 0, limit: pagination.limit, offset: pagination.offset },
      meta: {
        dataSource: "synthetic",
        sourcePath: null,
        generated_at: null,
        warnings: ["dashboards directory not configured or missing; returning empty list"],
      },
    };
  }
  const page = paginate(entries, pagination);
  const dashboards = page.rows.map((entry) => ({
    slug: entry.slug,
    title: titleFromSlug(entry.slug),
    htmlFile: entry.htmlFile,
    jsonFile: entry.jsonFile,
    modifiedAt: entry.modifiedAt,
  }));
  return {
    data: { dashboards, total: page.total, limit: page.limit, offset: page.offset },
    meta: {
      dataSource: "live-cache",
      sourcePath: dashboardsRepository.dashboardsRoot(),
      generated_at: null,
    },
  };
}

function getDashboardData(slugParam) {
  const slug = String(slugParam);
  if (!dashboardsRepository.isSafeSlug(slug)) {
    throw new BadRequestError("slug must contain only letters, digits, hyphens or underscores");
  }
  const result = resolveData({
    candidates: [{ dirKey: "dashboards", file: dashboardsRepository.dataFileFor(slug) }],
    fixture: slugify(slug) === "summary" ? SUMMARY_FIXTURE : null,
  });
  if (result.data === null) {
    throw new NotFoundError(`dashboard '${slug}' not found`);
  }
  return result;
}

module.exports = {
  getStatus,
  getPublicConfig,
  getTheme,
  getThemeCss,
  getSummary,
  getDashboards,
  getDashboardData,
};

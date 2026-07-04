const { BadRequestError } = require("../lib/errors");
const config = require("../config");
const { mailStatus, sendMail } = require("../lib/mailer");
const { flattenRecord, loadBroad, loadLiveGl } = require("../repositories/myobCacheRepository");
const { resolveData } = require("../repositories/dataSourceResolver");
const { renderTitheOnePagerEmail } = require("../emails");
const { slugify } = require("../lib/slug");

const DASHBOARD_FILE = "tithe-dashboard-data.json";
const FIXTURE = "tithe-dashboard.json";
const TITHE_INCOME_ACCOUNT = "610100";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

let schedulerState = { lastRunMonth: null, running: false };

function resolveTitheDashboard() {
  return resolveData({
    candidates: [{ dirKey: "dashboards", file: DASHBOARD_FILE }],
    fixture: FIXTURE,
  });
}

function sum(values) {
  return values.reduce((acc, value) => acc + value, 0);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

function monthIndexFromDate(value) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? -1 : date.getUTCMonth();
}

function field(record, name) {
  return record && record[name] !== undefined && record[name] !== null ? String(record[name]) : "";
}

function churchCodeFromAccountRef(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = /(CH[A-Z0-9]+)$/.exec(text);
  return match ? match[1] : "";
}

function churchCodeFromSubaccount(value) {
  const text = String(value || "").trim().toUpperCase();
  const match = /(CH[A-Z0-9]+)$/.exec(text);
  return match ? match[1] : "";
}

function churchNameFromCode(code) {
  const raw = String(code || "").replace(/^CH/, "").replace(/\d+$/, "");
  return raw ? `${raw} church` : "Unmapped church";
}

function emptyMonthly() {
  return MONTHS.map((month) => ({ month, current: 0, prior: 0, conference: 0 }));
}

function customerRowsFromBroad(broad) {
  const rows = broad?.endpoints?.Customer?.rows || broad?.endpoints?.Customer || [];
  return Array.isArray(rows) ? rows.map(flattenRecord) : [];
}

function snsWChurchCustomers(broad) {
  const byCode = new Map();
  for (const customer of customerRowsFromBroad(broad)) {
    const customerClass = field(customer, "CustomerClass").toUpperCase();
    const visibility = field(customer, "RestrictVisibilityTo").toUpperCase();
    const shippingBranch = field(customer, "ShippingBranch").toUpperCase();
    if (customerClass !== "AUCHURCH") continue;
    if (visibility && visibility !== "SNU") continue;
    if (!visibility && shippingBranch && shippingBranch !== "SNU") continue;
    const code = churchCodeFromAccountRef(field(customer, "AccountRef"));
    if (!code) continue;
    byCode.set(code, {
      code,
      id: slugify(field(customer, "CustomerName") || code),
      name: field(customer, "CustomerName") || churchNameFromCode(code),
      district: field(customer, "RestrictVisibilityTo") || field(customer, "ShippingBranch") || "SNSW",
      pastor: "",
      members: 0,
      recipient: field(customer, "Email") || undefined,
      customer_id: field(customer, "CustomerID") || null,
      account_ref: field(customer, "AccountRef") || null,
      monthly: emptyMonthly(),
    });
  }
  return byCode;
}

function buildTitheDashboardFromMyob(liveGl, broad, meta = {}) {
  const churchesByCode = snsWChurchCustomers(broad);
  const monthlyConference = Array(12).fill(0);
  let titheLineCount = 0;
  let unmappedTitheLineCount = 0;
  let unmappedTitheTotal = 0;
  const unmappedCodes = new Set();

  for (const line of liveGl?.journal_lines || []) {
    if (String(line.account) !== TITHE_INCOME_ACCOUNT) continue;
    const monthIndex = monthIndexFromDate(line.date);
    if (monthIndex < 0 || monthIndex >= 12) continue;
    const code = churchCodeFromSubaccount(line.subaccount);
    if (!code) continue;
    const amount = round2((Number(line.credit) || 0) - (Number(line.debit) || 0));
    if (!churchesByCode.has(code)) {
      unmappedCodes.add(code);
      unmappedTitheLineCount += 1;
      unmappedTitheTotal = round2(unmappedTitheTotal + amount);
      continue;
    }
    const church = churchesByCode.get(code);
    church.monthly[monthIndex].current = round2(church.monthly[monthIndex].current + amount);
    monthlyConference[monthIndex] = round2(monthlyConference[monthIndex] + amount);
    titheLineCount += 1;
  }

  const churches = [...churchesByCode.values()]
    .map((church) => ({
      ...church,
      monthly: church.monthly.map((row, index) => ({ ...row, conference: monthlyConference[index] })),
    }))
    .sort((a, b) => {
      const totalA = sum(a.monthly.map((row) => row.current));
      const totalB = sum(b.monthly.map((row) => row.current));
      if (totalA !== totalB) return totalB - totalA;
      return a.name.localeCompare(b.name);
    });

  const latestIndex = monthlyConference.reduce((latest, value, index) => (value > 0 ? index : latest), -1);
  const asOf = latestIndex >= 0 ? `${MONTHS[latestIndex]} 2026` : "FY2026";
  const currentTotal = sum(monthlyConference);
  return {
    generated_at: liveGl?.generated_at || meta.generated_at || null,
    source: "MYOB live GL cache · Account 610100 Tithe income grouped by SNU AUCHURCH Customer AccountRef",
    source_detail: {
      account: TITHE_INCOME_ACCOUNT,
      tithe_line_count: titheLineCount,
      unmapped_tithe_line_count: unmappedTitheLineCount,
      unmapped_tithe_total: unmappedTitheTotal,
      church_customer_count: churchesByCode.size,
      unmapped_church_codes: [...unmappedCodes].sort(),
    },
    conference: {
      name: "South NSW Conference",
      as_of: asOf,
      monthly_email: "Scheduled for the 5th business day",
      churches_reporting: churches.filter((church) => church.monthly.some((row) => Number(row.current) > 0)).length,
      churches_total: churches.length,
      year_target: Math.max(Math.round(currentTotal || 0), 1),
      prior_year_total: 0,
    },
    churches,
  };
}

function activeMonths(church) {
  return (church.monthly || []).filter((month) => Number(month.current) > 0).length;
}

function roundPct(value) {
  return Math.round(value * 1000) / 10;
}

function decorateChurch(church, conference) {
  const months = activeMonths(church);
  const elapsedRows = (church.monthly || []).slice(0, months);
  const currentYtd = sum(elapsedRows.map((row) => Number(row.current) || 0));
  const priorYtd = sum(elapsedRows.map((row) => Number(row.prior) || 0));
  const conferenceYtd = sum(elapsedRows.map((row) => Number(row.conference) || 0));
  const priorFullYear = sum((church.monthly || []).map((row) => Number(row.prior) || 0));
  const projectedFullYear = months ? Math.round((currentYtd / months) * 12) : 0;
  return {
    ...church,
    metrics: {
      months_reported: months,
      current_ytd: currentYtd,
      prior_ytd: priorYtd,
      yoy_delta: currentYtd - priorYtd,
      yoy_pct: priorYtd ? roundPct((currentYtd - priorYtd) / priorYtd) : null,
      conference_ytd: conferenceYtd,
      conference_share_pct: conferenceYtd ? roundPct(currentYtd / conferenceYtd) : null,
      projected_full_year: projectedFullYear,
      projected_vs_prior_pct: priorFullYear ? roundPct((projectedFullYear - priorFullYear) / priorFullYear) : null,
      conference_target_pace_pct:
        conference && conference.year_target ? roundPct(conferenceYtd / Number(conference.year_target)) : null,
    },
  };
}

function decorateDashboard(document) {
  const conference = document.conference || {};
  const churches = (document.churches || []).map((church) => decorateChurch(church, conference));
  return {
    generated_at: document.generated_at || null,
    conference,
    churches,
    default_church_id: churches[0] ? churches[0].id : null,
    email_automation: {
      cadence: "monthly",
      trigger: "5th business day after month close",
      endpoint: "/api/tithe/monthly-email/trigger",
      batch_endpoint: "/api/tithe/monthly-email/trigger-batch",
      mode: mailStatus().live ? "live" : "dry-run",
      scheduler_enabled: config.titheMonthlyEmail.schedulerEnabled,
      scheduler_live_send: config.titheMonthlyEmail.liveSend,
    },
  };
}

function getDashboard() {
  const liveGl = loadLiveGl();
  const broad = loadBroad();
  if (liveGl.meta.dataSource === "live-cache" && broad.meta.dataSource === "live-cache") {
    const warnings = [];
    const document = buildTitheDashboardFromMyob(liveGl.data, broad.data, liveGl.meta);
    if ((document.source_detail?.unmapped_church_codes || []).length > 0) {
      warnings.push(
        `MYOB tithe rows included ${document.source_detail.unmapped_church_codes.length} church subaccount code(s) not found in Customer AUCHURCH rows`
      );
    }
    return {
      data: decorateDashboard(document),
      meta: {
        ...liveGl.meta,
        warnings,
        extra: {
          source_detail: document.source_detail,
          customerSourcePath: broad.meta.sourcePath,
        },
      },
    };
  }

  const resolved = resolveTitheDashboard();
  if (!resolved.data) {
    return {
      data: {
        generated_at: null,
        conference: {},
        churches: [],
        default_church_id: null,
        email_automation: {
          cadence: "monthly",
          trigger: "5th business day after month close",
          endpoint: "/api/tithe/monthly-email/trigger",
          batch_endpoint: "/api/tithe/monthly-email/trigger-batch",
          mode: mailStatus().live ? "live" : "dry-run",
          scheduler_enabled: config.titheMonthlyEmail.schedulerEnabled,
          scheduler_live_send: config.titheMonthlyEmail.liveSend,
        },
      },
      meta: { ...resolved.meta, warnings: ["no tithe dashboard data available"] },
    };
  }
  return { data: decorateDashboard(resolved.data), meta: resolved.meta };
}

function getChurch({ churchId } = {}) {
  const dashboard = getDashboard();
  const churches = dashboard.data.churches || [];
  const selected = churches.find((church) => church.id === churchId) || churches[0] || null;
  if (!selected) throw new BadRequestError("No tithe church data available");
  return {
    data: {
      generated_at: dashboard.data.generated_at,
      conference: dashboard.data.conference,
      church: selected,
      email_automation: dashboard.data.email_automation,
    },
    meta: dashboard.meta,
  };
}

async function triggerMonthlyEmail({ churchId, to, previewOnly = false } = {}) {
  const churchResult = getChurch({ churchId });
  const { conference, church } = churchResult.data;
  const recipient = String(to || church.recipient || "").trim();
  if (!recipient) throw new BadRequestError("to is required when the church has no configured recipient");
  const rendered = renderTitheOnePagerEmail({ church, conference });
  const status = mailStatus();
  const sendResult = previewOnly
    ? { dryRun: true, previewOnly: true }
    : await sendMail({ to: recipient, subject: rendered.subject, html: rendered.html, text: rendered.text });
  return {
    data: {
      church_id: church.id,
      church_name: church.name,
      to: recipient,
      subject: rendered.subject,
      mail_status: status,
      send_result: sendResult,
      preview: { html: rendered.html, text: rendered.text },
    },
    meta: churchResult.meta,
  };
}

async function triggerMonthlyEmailBatch({ churchIds = [], previewOnly = true, testTo = null } = {}) {
  const dashboard = getDashboard();
  const selectedIds = new Set((churchIds || []).filter(Boolean));
  const churches = (dashboard.data.churches || []).filter(
    (church) => selectedIds.size === 0 || selectedIds.has(church.id)
  );
  const results = [];
  for (const church of churches) {
    const result = await triggerMonthlyEmail({
      churchId: church.id,
      to: testTo || church.recipient,
      previewOnly,
    });
    const { preview, ...summary } = result.data;
    results.push(summary);
  }
  return {
    data: {
      count: results.length,
      preview_only: previewOnly,
      mail_status: mailStatus(),
      results,
    },
    meta: dashboard.meta,
  };
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function shouldRunMonthlyEmail({ now = new Date(), lastRunMonth = null, dayOfMonth = 5, checkHour = 9 } = {}) {
  if (now.getDate() < dayOfMonth) return false;
  if (now.getHours() < checkHour) return false;
  return monthKey(now) !== lastRunMonth;
}

async function runScheduledMonthlyEmail({ now = new Date() } = {}) {
  if (schedulerState.running) return { started: false, reason: "already running" };
  if (
    !shouldRunMonthlyEmail({
      now,
      lastRunMonth: schedulerState.lastRunMonth,
      dayOfMonth: config.titheMonthlyEmail.dayOfMonth,
      checkHour: config.titheMonthlyEmail.checkHour,
    })
  ) {
    return { started: false, reason: "not due" };
  }

  schedulerState.running = true;
  try {
    const result = await triggerMonthlyEmailBatch({
      churchIds: config.titheMonthlyEmail.churchIds,
      previewOnly: !config.titheMonthlyEmail.liveSend,
      testTo: config.titheMonthlyEmail.testTo,
    });
    schedulerState.lastRunMonth = monthKey(now);
    return { started: true, result: result.data };
  } finally {
    schedulerState.running = false;
  }
}

function startMonthlyEmailScheduler() {
  if (!config.titheMonthlyEmail.schedulerEnabled) return null;
  const intervalMs = 24 * 60 * 60 * 1000;
  const tick = async (reason) => {
    try {
      const outcome = await runScheduledMonthlyEmail();
      if (outcome.started) {
        console.log(
          `tithe monthly email: ${outcome.result.preview_only ? "previewed" : "sent"} ${outcome.result.count} one-pagers (${reason})`
        );
      }
    } catch (error) {
      console.error("tithe monthly email: scheduled run failed", error && error.message ? error.message : error);
    }
  };
  const bootTimer = setTimeout(() => tick("boot check"), 30_000);
  bootTimer.unref();
  const interval = setInterval(() => tick("daily check"), intervalMs);
  interval.unref();
  console.log(
    `tithe monthly email: scheduler active (day >= ${config.titheMonthlyEmail.dayOfMonth}, hour >= ${config.titheMonthlyEmail.checkHour}, live=${config.titheMonthlyEmail.liveSend})`
  );
  return { interval, bootTimer };
}

function resetMonthlyEmailSchedulerState() {
  schedulerState = { lastRunMonth: null, running: false };
}

module.exports = {
  getDashboard,
  getChurch,
  triggerMonthlyEmail,
  triggerMonthlyEmailBatch,
  shouldRunMonthlyEmail,
  runScheduledMonthlyEmail,
  startMonthlyEmailScheduler,
  resetMonthlyEmailSchedulerState,
  buildTitheDashboardFromMyob,
};

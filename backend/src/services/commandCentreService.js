// CFO Command Centre service. Actuals come from the live MYOB GL cache when
// one is configured (commandCentreDerivation.js); otherwise every getter
// serves the design/synthetic figures per CONTRACT.md v1.0, byte-identical to
// the pre-live contract. Budgets are always the board-approved constants.
// Shared derived money math lives here (single shared helper) so frontend and
// backend agree on rounding.

const config = require("../config");
const { BadRequestError } = require("../lib/errors");
const { chatComplete } = require("../lib/qwenClient");
const { loadLiveGl } = require("../repositories/myobCacheRepository");
const { buildLiveModel } = require("./commandCentreDerivation");
const {
  GENERATED_AT,
  APPROVED_TOTALS,
  FUNCTIONS_RAW,
  DEPT_RAW,
  LANES_RAW,
  ENT_DEFS,
  OVERVIEW_KPIS,
  DASH_CARDS,
  ALERTS,
  FRESHNESS,
  PERIOD,
  OP_KPIS,
  COMPOSITION,
  OBSERVATION,
  STAFFING_BASELINE,
  FIELD_STATS,
  LOAD_BUCKETS,
  EVIDENCE,
  FRESHNESS_FULL,
} = require("../constants/commandCentre");

const META = { dataSource: "synthetic" };

// Live-gl cache model, or null when only the synthetic fixture is available.
// loadLiveGl falls back to fixtures/myob-live-gl.json, but the command centre
// deliberately ignores that fallback — its synthetic contract is the design
// constants above, not sums over the fixture.
function liveModel() {
  const { data, meta } = loadLiveGl();
  if (meta.dataSource !== "live-cache" || !data || !Array.isArray(data.journal_lines)) return null;
  return buildLiveModel(data, meta);
}

// ---- shared derivation helpers (contract §2 rules) ----

function computeUsage(budget, usedPct) {
  const spent = Math.round((budget * usedPct) / 100);
  const remaining = budget - spent;
  const status = remaining < 0 ? "over" : usedPct >= 85 ? "tight" : "ok";
  return { spent, remaining, status };
}

// laneStatus thresholds ported verbatim from the design source (app-script.js).
function laneStatus(budget, spent, request) {
  const remaining = budget - spent;
  const after = remaining - request;
  let verdict;
  if (after >= Math.max(1000, budget * 0.1)) verdict = "good";
  else if (after >= 0) verdict = "warn";
  else verdict = "bad";
  return { remaining, after, verdict };
}

// fmtF semantics: $1,234,567 with negatives as ($1,234).
function fmtMoney(x) {
  const s = "$" + Math.round(Math.abs(x)).toLocaleString("en-US");
  return x < 0 ? "(" + s + ")" : s;
}

// ---- GET endpoints ----

function getOverview() {
  const live = liveModel();
  if (!live) {
    return {
      data: {
        generated_at: GENERATED_AT,
        kpis: OVERVIEW_KPIS,
        dash_cards: DASH_CARDS,
        alerts: ALERTS,
        freshness: FRESHNESS,
      },
      meta: META,
    };
  }
  return {
    data: {
      generated_at: live.generated_at,
      kpis: live.overviewKpis,
      dash_cards: DASH_CARDS,
      alerts: ALERTS,
      freshness: [...FRESHNESS, live.freshnessEntry],
      // Additive fields (live only): derived YTD totals, the board-approved
      // totals, and the cumulative monthly trend backing the overview chart.
      totals: live.totals,
      approved_totals: APPROVED_TOTALS,
      trend: live.trend,
    },
    meta: live.meta,
  };
}

function getFunctions() {
  const live = liveModel();
  if (live) {
    return {
      data: {
        generated_at: live.generated_at,
        period: live.period,
        kpis: live.opKpis,
        composition: live.composition,
        observation: live.observation,
        functions: live.functions,
      },
      meta: live.meta,
    };
  }
  const functions = FUNCTIONS_RAW.map((fn) => {
    const { spent, remaining, status } = computeUsage(fn.budget, fn.used);
    return { name: fn.name, budget: fn.budget, used_pct: fn.used, spent, remaining, status };
  });
  return {
    data: {
      generated_at: GENERATED_AT,
      period: PERIOD,
      kpis: OP_KPIS,
      composition: COMPOSITION,
      observation: OBSERVATION,
      functions,
    },
    meta: META,
  };
}

function getDepartments() {
  const live = liveModel();
  if (live) {
    return { data: { generated_at: live.generated_at, departments: live.departments }, meta: live.meta };
  }
  const departments = DEPT_RAW.map((dept) => {
    const { spent, remaining, status } = computeUsage(dept.budget, dept.used);
    // Line math uses the PARENT department's used_pct (contract §3).
    const lines = dept.lines.map(([line, lineBudget]) => {
      const lineSpent = Math.round((lineBudget * dept.used) / 100);
      return { line, budget: lineBudget, spent: lineSpent, remaining: lineBudget - lineSpent };
    });
    return { name: dept.name, budget: dept.budget, used_pct: dept.used, spent, remaining, status, lines };
  });
  return { data: { generated_at: GENERATED_AT, departments }, meta: META };
}

function getLanes() {
  const lanes = LANES_RAW.map((lane) => ({
    id: lane.id,
    title: lane.title,
    hint: lane.hint,
    budget: lane.budget,
    spent: lane.spent,
    remaining: lane.budget - lane.spent,
    default_request: lane.default_request,
  }));
  return { data: { generated_at: GENERATED_AT, lanes }, meta: META };
}

function getStaffingBaseline() {
  return { data: { generated_at: GENERATED_AT, ...STAFFING_BASELINE }, meta: META };
}

function getField() {
  return { data: { generated_at: GENERATED_AT, stats: FIELD_STATS, load_buckets: LOAD_BUCKETS }, meta: META };
}

function getEntities() {
  const live = liveModel();
  if (live) {
    return {
      data: { generated_at: live.generated_at, entities: live.entities, total: live.entityTotal },
      meta: live.meta,
    };
  }
  const entities = ENT_DEFS.map((entity) => ({
    ...entity,
    net: entity.income - entity.expense,
  }));
  const income = ENT_DEFS.reduce((acc, entity) => acc + entity.income, 0);
  const expense = ENT_DEFS.reduce((acc, entity) => acc + entity.expense, 0);
  return {
    data: { generated_at: GENERATED_AT, entities, total: { income, expense, net: income - expense } },
    meta: META,
  };
}

function getSources() {
  const live = liveModel();
  if (live) {
    return {
      data: {
        generated_at: live.generated_at,
        evidence: EVIDENCE,
        freshness: [...FRESHNESS_FULL, live.freshnessFullEntry],
      },
      meta: live.meta,
    };
  }
  return { data: { generated_at: GENERATED_AT, evidence: EVIDENCE, freshness: FRESHNESS_FULL }, meta: META };
}

// ---- POST /copilot — LLM answers grounded in dashboard figures, with the
// contract §5 deterministic answers kept as the always-available fallback ----

function validateMessages(body) {
  const messages = body ? body.messages : undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new BadRequestError("messages must be a non-empty array");
  }
  if (messages.length > 40) {
    throw new BadRequestError("messages must contain at most 40 entries");
  }
  for (const message of messages) {
    if (
      !message ||
      typeof message !== "object" ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string"
    ) {
      throw new BadRequestError("each message needs a role of user|assistant and string content");
    }
    if (message.content.length > 4000) {
      throw new BadRequestError("message content must be at most 4000 characters");
    }
  }
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    throw new BadRequestError("messages must include at least one user message");
  }
  const question = lastUser.content.trim();
  if (!question) {
    throw new BadRequestError("the last user message is empty");
  }
  return question.toLowerCase();
}

// First amount-looking token where the number is >= 100 or carries a $/k/m marker.
function extractAmount(q) {
  const pattern = /(\$)?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(k|m)\b)?/gi;
  let match;
  while ((match = pattern.exec(q)) !== null) {
    const hasDollar = Boolean(match[1]);
    const suffix = (match[3] || "").toLowerCase();
    const value = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    if (value >= 100 || hasDollar || suffix) {
      if (suffix === "k") return value * 1e3;
      if (suffix === "m") return value * 1e6;
      return value;
    }
  }
  return null;
}

// Lane keyword match — first hit wins, in contract order. lanes is LANES_RAW
// or the live-derived list (same order, live spent).
function matchLane(q, lanes) {
  if (q.includes("evangel") || q.includes("outreach")) return lanes[0];
  if (q.includes("faith fm") || q.includes("microphone") || q.includes("radio") || q.includes("studio")) {
    return lanes[1];
  }
  if (q.includes("president") || (q.includes("usa") && q.includes("invit"))) return lanes[2];
  if (q.includes("youth")) return lanes[3];
  return null;
}

// Functions with resolved usage figures — live derivation when available,
// otherwise the synthetic constants through the shared computeUsage math.
function resolvedFunctions(live) {
  if (live) return live.functions;
  return FUNCTIONS_RAW.map((fn) => ({
    name: fn.name,
    budget: fn.budget,
    used_pct: fn.used,
    ...computeUsage(fn.budget, fn.used),
  }));
}

function laneAnswer(lane, amount) {
  const request = amount == null ? lane.default_request : amount;
  const { remaining, after, verdict } = laneStatus(lane.budget, lane.spent, request);
  const opening =
    "In the " +
    lane.hint +
    " the FY2026 budget is " +
    fmtMoney(lane.budget) +
    " with about " +
    fmtMoney(lane.spent) +
    " spent, leaving " +
    fmtMoney(remaining) +
    ".";
  let verdictSentence;
  if (verdict === "good") {
    verdictSentence =
      "A " +
      fmtMoney(request) +
      " request would leave " +
      fmtMoney(after) +
      " — likely affordable, but flag it for restricted-funding checks before approving.";
  } else if (verdict === "warn") {
    verdictSentence =
      "A " +
      fmtMoney(request) +
      " request would leave only " +
      fmtMoney(after) +
      " — possible, but tight; flag it for CFO judgement and restricted-funding checks before approving.";
  } else {
    verdictSentence =
      "A " +
      fmtMoney(request) +
      " request would exceed the visible lane by " +
      fmtMoney(Math.abs(after)) +
      " — not affordable in lane without CFO judgement on reallocation or restricted funding.";
  }
  return { answer: opening + " " + verdictSentence, matched: { kind: "lane", id: lane.id } };
}

// Small-count words for the watchlist opening ("Two functions are at risk.").
const COUNT_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];

function watchlistAnswer(functions) {
  const overs = functions.filter((fn) => fn.status === "over");
  const tights = functions.filter((fn) => fn.status === "tight");
  const atRisk = overs.length + tights.length;
  if (atRisk === 0) {
    return {
      answer: "No functions are at risk. Every function still sits at or under elapsed-year pace.",
      matched: { kind: "watchlist", id: null },
    };
  }
  const parts = [];
  for (const fn of overs) {
    parts.push(
      fn.name +
        " is over budget at " +
        fn.used_pct +
        "% used — " +
        fmtMoney(fn.spent) +
        " spent against an approved " +
        fmtMoney(fn.budget) +
        ", so it is " +
        fmtMoney(Math.abs(fn.remaining)) +
        " over.",
    );
  }
  for (const fn of tights) {
    parts.push(
      fn.name +
        " is " +
        fn.used_pct +
        "% committed with " +
        fmtMoney(fn.spent) +
        " spent of " +
        fmtMoney(fn.budget) +
        ", leaving " +
        fmtMoney(fn.remaining) +
        ".",
    );
  }
  const opening =
    (COUNT_WORDS[atRisk] || String(atRisk)) + " function" + (atRisk === 1 ? " is" : "s are") + " at risk. ";
  const closing = atRisk === functions.length ? "" : " Every other function still sits at or under elapsed-year pace.";
  return { answer: opening + parts.join(" ") + closing, matched: { kind: "watchlist", id: null } };
}

function functionAnswer(fn) {
  const { used_pct, spent, remaining, status } = fn;
  const statusNote =
    status === "over"
      ? "It has exceeded its full-year allocation — flag for CFO judgement before approving anything further."
      : status === "tight"
        ? "Headroom is tight, so treat new requests with care and flag them for CFO judgement."
        : "That sits at or under elapsed-year pace.";
  const answer =
    fn.name +
    " has an approved FY2026 budget of " +
    fmtMoney(fn.budget) +
    ". Spend to date is about " +
    fmtMoney(spent) +
    " (" +
    used_pct +
    "% used), leaving " +
    fmtMoney(remaining) +
    ". " +
    statusNote;
  return { answer, matched: { kind: "function", id: fn.name } };
}

function generalAnswer() {
  const answer =
    "The Board-approved FY2026 budget totals " +
    fmtMoney(APPROVED_TOTALS.income) +
    " income against " +
    fmtMoney(APPROVED_TOTALS.expense) +
    " expense, a surplus target of " +
    fmtMoney(APPROVED_TOTALS.net) +
    ". For function-level detail, the operating position page shows every function against elapsed-year pace. There is no live cash balance available, so cash-on-hand cannot be quoted.";
  return { answer, matched: { kind: "general", id: null } };
}

// Deterministic keyword-matched result (contract §5). Always computed even on
// the LLM path: it supplies matched {kind,id} and is the network-free fallback.
// Same matching logic either way; live mode only swaps in derived figures so
// the canned answers cite real remaining amounts.
function deterministicCopilot(q, live, meta) {
  const lane = matchLane(q, live ? live.lanes : LANES_RAW);
  if (lane) {
    return { data: laneAnswer(lane, extractAmount(q)), meta };
  }
  if (q.includes("risk") || q.includes("overspend") || q.includes("over budget") || q.includes("watch")) {
    return { data: watchlistAnswer(resolvedFunctions(live)), meta };
  }
  const fn = resolvedFunctions(live).find((candidate) => q.includes(candidate.name.toLowerCase()));
  if (fn) {
    return { data: functionAnswer(fn), meta };
  }
  return { data: generalAnswer(), meta };
}

// Grounding facts for the LLM system prompt — serialised from the SAME
// resolved model the deterministic path answers from (live derivation when a
// cache is configured, otherwise the synthetic contract constants), so the
// model can only cite figures the dashboard itself shows.
function copilotSystemPrompt(live, deterministicAnswer) {
  const lanes = live ? live.lanes : LANES_RAW;
  const functions = resolvedFunctions(live);
  const period = live ? live.period : PERIOD;
  const generatedAt = live ? live.generated_at : GENERATED_AT;
  const overs = functions.filter((fn) => fn.status === "over");
  const tights = functions.filter((fn) => fn.status === "tight");
  const laneLines = lanes.map(
    (lane) =>
      `- ${lane.title} (${lane.hint}): budget ${fmtMoney(lane.budget)}, spent ${fmtMoney(lane.spent)}, remaining ${fmtMoney(lane.budget - lane.spent)}, typical request ${fmtMoney(lane.default_request)}`,
  );
  const functionLines = functions.map(
    (fn) =>
      `- ${fn.name}: budget ${fmtMoney(fn.budget)}, spent ${fmtMoney(fn.spent)} (${fn.used_pct}% used), remaining ${fmtMoney(fn.remaining)}, status ${fn.status}`,
  );
  const watchlist =
    overs.length + tights.length === 0
      ? "No functions are over budget or tight; every function sits at or under elapsed-year pace."
      : `Over budget: ${overs.map((fn) => fn.name).join(", ") || "none"}. Tight (85%+ used): ${tights.map((fn) => fn.name).join(", ") || "none"}.`;
  return [
    "You are the Decision Copilot on a church conference CFO dashboard. You help the CFO and administrators judge budget questions and spending requests.",
    "",
    `Data mode: ${live ? "live MYOB GL cache" : "synthetic design figures"}. Figures as at ${generatedAt || "unknown"}. Period: ${period.label} (${period.elapsed_pct}% of the year elapsed).`,
    "",
    `Board-approved FY2026 totals: income ${fmtMoney(APPROVED_TOTALS.income)}, expense ${fmtMoney(APPROVED_TOTALS.expense)}, surplus target ${fmtMoney(APPROVED_TOTALS.net)}.`,
    "",
    "Discretionary decision lanes:",
    ...laneLines,
    "",
    "Operating functions:",
    ...functionLines,
    "",
    `Watchlist: ${watchlist}`,
    "",
    "Affordability rules for a spending request against a lane: if the remainder after the request is at least the larger of $1,000 and 10% of the lane budget, it is likely affordable but should still be flagged for restricted-funding checks; if the remainder is smaller but not negative, it is possible but tight and must be flagged for CFO judgement and restricted-funding checks; if the request exceeds the remaining lane, it is not affordable in lane without CFO judgement on reallocation or restricted funding. Treat any request touching an over-budget or tight function the same way: recommend flagging it for CFO judgement.",
    "",
    "Rules: answer ONLY from the figures above and never invent, estimate or extrapolate numbers. All amounts are AUD; format them like $12,980. Reply in plain text only — no markdown, bullets or headings. Keep answers to 2-5 sentences. If something is not in this data (for example there is NO live cash balance, so cash on hand can never be quoted), say so plainly.",
    "",
    `For reference, the dashboard's deterministic engine reads the latest question as: "${deterministicAnswer}"`,
  ].join("\n");
}

// Most recent conversation turns forwarded to the LLM. validateMessages has
// already bounded count and length; this cap just keeps the prompt small.
const COPILOT_LLM_TURNS = 12;

// Async because of the LLM hop. Any LLM failure (disabled, timeout, non-2xx,
// empty answer) degrades to the deterministic result, so the endpoint never
// fails harder than the pre-LLM contract.
async function postCopilot(body) {
  const q = validateMessages(body);
  const live = liveModel();
  const meta = live ? live.meta : META;
  const fallback = deterministicCopilot(q, live, meta);
  if (!config.copilot.llmEnabled) {
    return fallback;
  }
  try {
    const answer = await chatComplete({
      system: copilotSystemPrompt(live, fallback.data.answer),
      messages: body.messages.slice(-COPILOT_LLM_TURNS).map((message) => ({ role: message.role, content: message.content })),
    });
    return { data: { answer, matched: fallback.data.matched }, meta };
  } catch (error) {
    console.warn(`copilot: LLM unavailable, serving deterministic answer (${error.message})`);
    return fallback;
  }
}

module.exports = {
  computeUsage,
  laneStatus,
  fmtMoney,
  extractAmount,
  getOverview,
  getFunctions,
  getDepartments,
  getLanes,
  getStaffingBaseline,
  getField,
  getEntities,
  getSources,
  postCopilot,
};

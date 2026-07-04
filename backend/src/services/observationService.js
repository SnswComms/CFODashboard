// Qwen-written observation sentence for the operating position (rendered on
// the Overview and Operating pages). The deterministic observationFrom()
// sentence stays as the grounding reference and the fallback whenever the LLM
// is disabled or unreachable — same degradation contract as the copilot.
//
// The generated sentence is cached against a fingerprint of the exact figures
// it describes, in memory and in a small file beside the live GL cache, so
// the wording only changes when the underlying MYOB data changes — never per
// page load, and not across server restarts. LLM failures are NOT cached:
// that response serves the templated fallback and the next request retries.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const config = require("../config");
const { chatComplete } = require("../lib/qwenClient");
const { writeJsonFile } = require("../repositories/jsonFileRepository");

let memory = { key: null, sentence: null };
let pending = null; // { key, promise } — dedupes concurrent first loads
let diskLoaded = false;

function cachePath() {
  return config.resolve("myobCache", path.join("live-gl", "observation-cache.json"));
}

function loadDiskCache() {
  if (diskLoaded) return;
  diskLoaded = true;
  const file = cachePath();
  if (!file) return;
  try {
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw.key === "string" && typeof raw.sentence === "string" && raw.sentence) {
      memory = { key: raw.key, sentence: raw.sentence };
    }
  } catch {
    // no cache yet (or unreadable) — first request will generate one
  }
}

function saveDiskCache() {
  const file = cachePath();
  if (!file) return;
  try {
    writeJsonFile(file, memory);
  } catch (error) {
    console.warn(`observation: could not persist cache (${error.message})`);
  }
}

// The sentence must be re-generated exactly when the figures it cites change,
// so the key is a hash of those figures — not the extract timestamp, which
// moves on every sync even when the numbers are identical.
function fingerprint(model) {
  const facts = {
    period: model.period,
    functions: model.functions.map((fn) => [fn.name, fn.budget, fn.spent, fn.status]),
  };
  return crypto.createHash("sha1").update(JSON.stringify(facts)).digest("hex");
}

const SYSTEM_PROMPT = [
  "You write the short observation line shown above the budget-vs-spend chart on a church conference CFO dashboard.",
  "In one or two plain-text sentences, state which operating functions have overrun their full-year budget, which are close to their limit, and how the rest sit relative to the elapsed year.",
  "Use ONLY the figures provided — never invent, estimate or extrapolate numbers. All amounts are AUD.",
  "No markdown, no bullets, no headings, and do not wrap the answer in quotation marks. Maximum 45 words.",
].join(" ");

function observationPrompt(model) {
  const money = (x) => "$" + Math.round(x).toLocaleString("en-US");
  const lines = model.functions.map(
    (fn) =>
      `- ${fn.name}: approved budget ${money(fn.budget)}, spent ${money(fn.spent)} (${fn.used_pct}% used, status ${fn.status}), remaining ${money(fn.remaining)}`,
  );
  return [
    `Period: ${model.period.label}, ${model.period.elapsed_pct}% of the year elapsed.`,
    'Operating functions (status "over" = spent exceeds the full-year budget, "tight" = 85%+ used, "ok" = at or under pace):',
    ...lines,
    "",
    "Write the observation line for these figures.",
  ].join("\n");
}

// Collapse whitespace and strip a wrapping quote pair if the model adds one.
function sanitize(answer) {
  let clean = String(answer || "").replace(/\s+/g, " ").trim();
  if (/^["'“].*["'”]$/.test(clean)) clean = clean.slice(1, -1).trim();
  return clean;
}

async function generate(model, key) {
  try {
    const sentence = sanitize(
      await chatComplete({
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: observationPrompt(model) }],
      }),
    );
    if (!sentence) throw new Error("empty observation");
    memory = { key, sentence };
    saveDiskCache();
    return sentence;
  } finally {
    pending = null;
  }
}

// The LLM observation for a live model, or the model's own templated sentence
// when the LLM is disabled or the call fails. Never throws.
async function observationSentence(model) {
  if (!config.copilot.llmEnabled) return model.observation;
  loadDiskCache();
  const key = fingerprint(model);
  if (memory.key === key && memory.sentence) return memory.sentence;
  if (!pending || pending.key !== key) {
    pending = { key, promise: generate(model, key) };
  }
  try {
    return await pending.promise;
  } catch (error) {
    console.warn(`observation: LLM unavailable, serving templated sentence (${error.message})`);
    return model.observation;
  }
}

// Test hook: drop all cached state so each test starts cold.
function resetObservationCache() {
  memory = { key: null, sentence: null };
  pending = null;
  diskLoaded = false;
}

module.exports = { observationSentence, resetObservationCache };

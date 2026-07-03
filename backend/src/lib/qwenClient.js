// Minimal OpenAI-compatible chat-completions client for the Qwen model served
// by vLLM on morpheus (Tailscale peer — no auth, per the local-only rule).
// vLLM runs with a reasoning parser, so choices[0].message.content carries only
// the final answer (the chain-of-thought lands in message.reasoning and is
// discarded here). Reasoning tokens still count toward max_tokens, hence the
// generous default budget in config. The server also runs
// --enable-auto-tool-choice --tool-call-parser qwen3_coder, so OpenAI-format
// tools can be passed straight through (see the bounded tool loop below).
const config = require("../config");

// Hard cap on tool rounds per chatComplete call — a model that is still
// requesting tools after this many round trips is treated as malfunctioning
// and the call retries as a plain no-tools completion.
const MAX_TOOL_ROUNDS = 3;

class QwenHttpError extends Error {
  constructor(status, body, url) {
    const detail = typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body ?? "").slice(0, 200);
    super(`Qwen request failed (${status}) ${url}: ${detail}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// One POST to {llmUrl}/chat/completions. Returns choices[0].message (object)
// so the tool loop can read tool_calls; throws QwenHttpError on non-2xx and
// the abort error on timeout (each hop gets its own AbortSignal, matching the
// pre-tools behavior of one signal per fetch).
async function postChat(chat, tools) {
  const { llmUrl, llmModel, llmTimeoutMs, llmMaxTokens } = config.copilot;
  const url = `${llmUrl}/chat/completions`;
  // enable_thinking:false suppresses Qwen's chain-of-thought (verified live:
  // reasoning comes back empty and latency drops from ~45s+ to a few
  // seconds). Reasoning would otherwise eat most of the max_tokens budget.
  const payload = {
    model: llmModel,
    messages: chat,
    max_tokens: llmMaxTokens,
    chat_template_kwargs: { enable_thinking: false },
  };
  if (tools) payload.tools = tools;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(llmTimeoutMs),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!response.ok) throw new QwenHttpError(response.status, body, url);
  return body && body.choices && body.choices[0] ? body.choices[0].message : null;
}

function contentOf(message) {
  return message && typeof message.content === "string" ? message.content.trim() : "";
}

// Bounded tool loop: POST with tools, execute any tool_calls through the
// caller's executor map, append the results as role:"tool" messages and
// re-request. Returns the final answer string, or "" when the model never
// produced one (still asking for tools at the cap, or an empty reply) — the
// caller then retries as a plain no-tools completion. Malformed tool calls
// (unknown tool, unparseable arguments, executor throw) throw for the same
// fallback treatment.
async function runToolLoop(chat, tools, executors) {
  const transcript = [...chat];
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const message = await postChat(transcript, tools);
    const toolCalls = message && Array.isArray(message.tool_calls) ? message.tool_calls : [];
    if (toolCalls.length === 0) return contentOf(message);
    transcript.push({ role: "assistant", content: message.content ?? "", tool_calls: toolCalls });
    for (const call of toolCalls) {
      const name = call.function ? call.function.name : undefined;
      const executor = executors[name];
      if (!executor) throw new Error(`Qwen requested an unknown tool "${name}"`);
      const args = JSON.parse(call.function.arguments || "{}");
      const result = await executor(args);
      transcript.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return "";
}

// POST {llmUrl}/chat/completions with an optional system prompt prepended.
// Returns the trimmed assistant answer string. Throws QwenHttpError on
// non-2xx, the abort error on timeout (latency runs to tens of seconds with
// reasoning on), and a plain Error when the model returns no usable content —
// callers treat any throw as "fall back to the deterministic answer".
// Optional `tools` (OpenAI format) and `executors` (name -> async fn) engage
// the bounded tool loop; any tool-loop malfunction degrades to a plain
// no-tools completion first, so the string contract never changes.
async function chatComplete({ messages, system, tools, executors } = {}) {
  const { llmUrl } = config.copilot;
  const url = `${llmUrl}/chat/completions`;
  const chat = system ? [{ role: "system", content: system }, ...messages] : [...messages];
  if (Array.isArray(tools) && tools.length > 0) {
    try {
      const answer = await runToolLoop(chat, tools, executors || {});
      if (answer) return answer;
      console.warn("qwen: tool loop ended without an answer, retrying without tools");
    } catch (error) {
      console.warn(`qwen: tool loop failed, retrying without tools (${error.message})`);
    }
  }
  const answer = contentOf(await postChat(chat, null));
  if (!answer) throw new Error(`Qwen returned an empty answer (${url})`);
  return answer;
}

module.exports = {
  QwenHttpError,
  chatComplete,
  MAX_TOOL_ROUNDS,
};

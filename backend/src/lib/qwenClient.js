// Minimal OpenAI-compatible chat-completions client for the Qwen model served
// by vLLM on morpheus (Tailscale peer — no auth, per the local-only rule).
// vLLM runs with a reasoning parser, so choices[0].message.content carries only
// the final answer (the chain-of-thought lands in message.reasoning and is
// discarded here). Reasoning tokens still count toward max_tokens, hence the
// generous default budget in config.
const config = require("../config");

class QwenHttpError extends Error {
  constructor(status, body, url) {
    const detail = typeof body === "string" ? body.slice(0, 200) : JSON.stringify(body ?? "").slice(0, 200);
    super(`Qwen request failed (${status}) ${url}: ${detail}`);
    this.status = status;
    this.body = body;
    this.url = url;
  }
}

// POST {llmUrl}/chat/completions with an optional system prompt prepended.
// Returns the trimmed assistant answer string. Throws QwenHttpError on
// non-2xx, the abort error on timeout (latency runs to tens of seconds with
// reasoning on), and a plain Error when the model returns no usable content —
// callers treat any throw as "fall back to the deterministic answer".
async function chatComplete({ messages, system } = {}) {
  const { llmUrl, llmModel, llmTimeoutMs, llmMaxTokens } = config.copilot;
  const url = `${llmUrl}/chat/completions`;
  const chat = system ? [{ role: "system", content: system }, ...messages] : [...messages];
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    // enable_thinking:false suppresses Qwen's chain-of-thought (verified live:
    // reasoning comes back empty and latency drops from ~45s+ to a few
    // seconds). Reasoning would otherwise eat most of the max_tokens budget.
    body: JSON.stringify({
      model: llmModel,
      messages: chat,
      max_tokens: llmMaxTokens,
      chat_template_kwargs: { enable_thinking: false },
    }),
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
  const message = body && body.choices && body.choices[0] ? body.choices[0].message : null;
  const answer = message && typeof message.content === "string" ? message.content.trim() : "";
  if (!answer) throw new Error(`Qwen returned an empty answer (${url})`);
  return answer;
}

module.exports = {
  QwenHttpError,
  chatComplete,
};

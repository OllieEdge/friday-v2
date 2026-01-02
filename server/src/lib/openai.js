const { envString } = require("../config/env");

function redactSecrets(text) {
  const s = String(text || "");
  const key = envString("OPENAI_API_KEY", "");
  if (!key) return s;
  return s.split(key).join("[REDACTED]");
}

function buildOpenAiSystemText({ contextText }) {
  return (
    "You are Friday v2, Oliver’s personal assistant.\n" +
    "You must follow the context below (ordered, deterministic).\n" +
    "Be dry-witted but useful (FRIDAY-ish), and do not overpromise.\n" +
    "If the user asks for a state-changing action, treat it as explicit intent and explain what you will do.\n" +
    "Do not run shell commands or modify files unless explicitly asked.\n\n" +
    "Context:\n\n" +
    contextText
  );
}

async function runOpenAiChat({ messages }) {
  const apiKey = envString("OPENAI_API_KEY", "");
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const baseUrl = envString("OPENAI_BASE_URL", "https://api.openai.com").replace(/\/+$/, "");
  const model = envString("OPENAI_MODEL", "gpt-4o-mini");
  const timeoutMs = Number(envString("OPENAI_TIMEOUT_MS", "60000")) || 60000;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
      }),
      signal: controller.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      throw new Error(`OpenAI API error (${resp.status}): ${redactSecrets(text).slice(0, 2000)}`);
    }

    const json = JSON.parse(text);
    const content = json?.choices?.[0]?.message?.content;
    const usage = json?.usage
      ? {
          inputTokens: Number(json.usage.prompt_tokens) || 0,
          cachedInputTokens: 0,
          outputTokens: Number(json.usage.completion_tokens) || 0,
        }
      : null;
    return { content: String(content || "").trim(), usage };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { buildOpenAiSystemText, runOpenAiChat };

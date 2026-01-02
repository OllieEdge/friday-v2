const DEFAULT_MODEL = "gpt-4o-mini";

function buildContextText(contextItems) {
  return (contextItems || [])
    .map((i) => `# ${i.filename}\n\n${String(i.content || "").trim()}\n`)
    .join("\n\n---\n\n");
}

async function runOpenAI({ context, chat }) {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing (set it in .env)");

  const model = String(process.env.OPENAI_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const contextText = buildContextText(context?.items || []);

  const systemText =
    "You are Friday v2, Oliver’s personal assistant.\n" +
    "You must follow the context documents provided below (ordered, deterministic).\n" +
    "If a request requires state-changing actions, follow the safety rules in context.\n\n" +
    "Context:\n\n" +
    contextText;

  const messages = (chat?.messages || []).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: [{ type: "text", text: String(m.content || "") }],
  }));

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: [{ role: "system", content: [{ type: "text", text: systemText }] }, ...messages],
    }),
  });

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = json?.error?.message || json?.message || `OpenAI error HTTP ${res.status}`;
    throw new Error(msg);
  }

  const text = json?.output_text;
  if (typeof text === "string" && text.trim()) return text.trim();

  // Fallback: try to extract from output blocks if present
  const blocks = json?.output?.flatMap((o) => o?.content || []) || [];
  const parts = blocks.filter((b) => b?.type === "output_text").map((b) => b?.text).filter(Boolean);
  return String(parts.join("\n")).trim() || "(No text returned by runner)";
}

module.exports = { runOpenAI };


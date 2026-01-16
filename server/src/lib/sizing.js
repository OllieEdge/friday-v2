const { envString } = require("../config/env");
const { runVertexChat } = require("./vertex");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```json\n([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : raw;
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

async function sizeProject({ transcript, settings, googleAccounts }) {
  const model = normalizeText(envString("PM_SIZING_MODEL", "gemini-2.0-flash"));
  const authMode = normalizeText(settings?.get("vertex_auth_mode")) || envString("VERTEX_AUTH_MODE", "aws_secret");
  const googleAccountKey = normalizeText(settings?.get("vertex_google_account_key")) || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work");
  const serviceAccountJson = normalizeText(settings?.get("vertex_service_account_json"));

  const system =
    "You are a project sizing assistant. Return a strict JSON object with keys: " +
    "sizeLabel (S/M/L/XL/XXL), timeEstimate (short string), risks (array of short strings). " +
    "Do not include any extra text.";

  const prompt =
    "Project transcript:\n" +
    normalizeText(transcript) +
    "\n\nReturn JSON only.";

  const result = await runVertexChat({
    system,
    messages: [{ role: "user", content: prompt }],
    model,
    authMode,
    googleAccountKey,
    googleAccounts: authMode === "google_oauth" ? googleAccounts : undefined,
    serviceAccountJson: serviceAccountJson || undefined,
  });

  const parsed = extractJson(result?.content || "");
  if (!parsed) return { ok: false, error: "sizing_parse_failed", raw: result?.content || "" };

  const sizeLabel = normalizeText(parsed.sizeLabel || parsed.size || "");
  const timeEstimate = normalizeText(parsed.timeEstimate || parsed.estimate || "");
  const risks = Array.isArray(parsed.risks) ? parsed.risks.map((r) => normalizeText(r)).filter(Boolean) : [];

  if (!sizeLabel) return { ok: false, error: "sizing_label_missing", raw: parsed };

  return { ok: true, sizeLabel, timeEstimate, risks };
}

module.exports = { sizeProject };

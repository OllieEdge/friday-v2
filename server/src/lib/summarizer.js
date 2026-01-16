const { envString } = require("../config/env");
const { runVertexChat } = require("./vertex");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function buildSystem(purpose) {
  const p = normalizeText(purpose);
  return (
    "You are a concise summarizer.\n" +
    "Return a short, clear summary that is easy to scan.\n" +
    "Avoid filler and keep wording crisp.\n" +
    (p ? `Purpose: ${p}\n` : "")
  );
}

async function summarizeText({ text, purpose, settings, googleAccounts }) {
  const content = normalizeText(text);
  if (!content) return { ok: false, error: "text_required" };

  const model = normalizeText(envString("PM_SUMMARIZER_MODEL", "gemini-2.0-flash"));
  const authMode = normalizeText(settings?.get("vertex_auth_mode")) || envString("VERTEX_AUTH_MODE", "aws_secret");
  const googleAccountKey = normalizeText(settings?.get("vertex_google_account_key")) || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work");
  const serviceAccountJson = normalizeText(settings?.get("vertex_service_account_json"));

  const system = buildSystem(purpose);
  const messages = [{ role: "user", content }];

  try {
    const result = await runVertexChat({
      system,
      messages,
      model,
      authMode,
      googleAccountKey,
      googleAccounts: authMode === "google_oauth" ? googleAccounts : undefined,
      serviceAccountJson: serviceAccountJson || undefined,
    });
    return { ok: true, summary: normalizeText(result?.content || "") };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

module.exports = { summarizeText };

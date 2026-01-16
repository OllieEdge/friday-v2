const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { summarizeText } = require("../lib/summarizer");

function registerSummarize(router, { settings, googleAccounts }) {
  router.add("POST", "/api/summarize", async (req, res) => {
    const body = (await readJson(req)) || {};
    const text = String(body?.text || "");
    const purpose = String(body?.purpose || "");
    const result = await summarizeText({ text, purpose, settings, googleAccounts });
    if (!result.ok) return sendJson(res, 400, { ok: false, error: result.error || "summarize_failed" });
    return sendJson(res, 200, { ok: true, summary: result.summary });
  });
}

module.exports = { registerSummarize };

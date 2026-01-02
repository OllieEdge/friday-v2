const { sendJson } = require("../http/respond");

function computeMetrics(context) {
  const items = context?.items || [];
  let chars = 0;
  let bytes = 0;
  for (const it of items) {
    const c = String(it?.content || "");
    chars += c.length;
    bytes += Buffer.byteLength(c, "utf8");
  }
  const approxTokens = Math.ceil(chars / 4);
  return { files: (context?.files || []).length, chars, bytes, approxTokens };
}

function registerContext(router, { loadContext }) {
  router.add("GET", "/api/context", (_req, res) => {
    const context = loadContext();
    return sendJson(res, 200, { ok: true, context });
  });

  router.add("GET", "/api/context/metrics", (_req, res) => {
    const context = loadContext();
    return sendJson(res, 200, { ok: true, metrics: computeMetrics(context) });
  });
}

module.exports = { registerContext };

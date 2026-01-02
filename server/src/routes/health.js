const { sendJson } = require("../http/respond");

function registerHealth(router) {
  router.add("GET", "/api/health", (_req, res) => sendJson(res, 200, { ok: true }));
}

module.exports = { registerHealth };


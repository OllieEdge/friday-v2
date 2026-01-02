const { sendJson } = require("../http/respond");

function registerContext(router, { loadContext }) {
  router.add("GET", "/api/context", (_req, res) => {
    const context = loadContext();
    return sendJson(res, 200, { ok: true, context });
  });
}

module.exports = { registerContext };


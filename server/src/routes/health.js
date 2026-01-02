const { sendHead, sendJson } = require("../http/respond");

function registerHealth(router) {
  router.add("GET", "/api/health", (_req, res) => sendJson(res, 200, { ok: true }));
  router.add("HEAD", "/api/health", (_req, res) =>
    sendHead(res, 200, {
      "content-type": "application/json; charset=utf-8",
      "content-length": "0",
    }),
  );
}

module.exports = { registerHealth };

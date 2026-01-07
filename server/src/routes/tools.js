const { readBody } = require("../http/body");
const { sendJson } = require("../http/respond");
const { execCommand, verifyToolRequest } = require("../lib/tool-exec");

function registerTools(router) {
  router.add("POST", "/api/tools/exec", async (req, res) => {
    const bodyBuf = await readBody(req, 1024 * 1024);
    const bodyText = bodyBuf.toString("utf8");
    const auth = verifyToolRequest({ req, bodyText });
    if (!auth.ok) return sendJson(res, 401, { ok: false, error: auth.error });

    let payload = null;
    try {
      payload = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      payload = null;
    }
    if (!payload) return sendJson(res, 400, { ok: false, error: "invalid_json" });

    const result = await execCommand({
      command: payload.command,
      args: payload.args,
      cwd: payload.cwd,
      timeoutMs: payload.timeoutMs,
      confirm: payload.confirm,
    });
    return sendJson(res, 200, { ok: true, result });
  });
}

module.exports = { registerTools };

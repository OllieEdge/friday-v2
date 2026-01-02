const { readJson } = require("../http/body");
const { sendJson, sendNoContent } = require("../http/respond");
const { nowIso } = require("../utils/time");
const {
  resolveCodexPath,
  runCodexLoginStatus,
  runCodexLogout,
  startDeviceLogin,
  parseDeviceInfo,
} = require("../lib/codex");

const ACTIVE_KEY = "active_codex_profile_id";

function registerCodexAccounts(router, { db, codexProfiles, settings, tasks }) {
  router.add("GET", "/api/accounts/codex", async (_req, res) => {
    const codexPath = resolveCodexPath();
    const activeProfileId = settings.get(ACTIVE_KEY);
    const profiles = codexProfiles.list();

    const enriched = [];
    for (const p of profiles) {
      let statusText = "";
      let loggedIn = false;
      try {
        const status = await runCodexLoginStatus({ codexPath, codexHomePath: p.codexHomePath });
        statusText = status.text;
        loggedIn = status.loggedIn;
        codexProfiles.touchStatus({ id: p.id, lastVerifiedAt: nowIso(), lastStatusText: statusText });
      } catch (e) {
        statusText = `status_error: ${String(e?.message || e)}`;
      }
      enriched.push({ ...p, loggedIn, statusText });
    }

    return sendJson(res, 200, { ok: true, activeProfileId: activeProfileId || null, profiles: enriched });
  });

  router.add("POST", "/api/accounts/codex", async (req, res) => {
    const body = await readJson(req);
    const label = String(body?.label || "").trim();
    if (!label) return sendJson(res, 400, { ok: false, error: "missing_label" });
    const profileId = codexProfiles.create({ label });
    return sendJson(res, 201, { ok: true, profileId });
  });

  router.add("POST", "/api/accounts/codex/:profileId/activate", async (_req, res, _url, params) => {
    const p = codexProfiles.get(params.profileId);
    if (!p) return sendJson(res, 404, { ok: false, error: "not_found" });
    settings.set(ACTIVE_KEY, params.profileId);
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/accounts/codex/:profileId/logout", async (_req, res, _url, params) => {
    const p = codexProfiles.get(params.profileId);
    if (!p) return sendJson(res, 404, { ok: false, error: "not_found" });
    const codexPath = resolveCodexPath();
    const result = await runCodexLogout({ codexPath, codexHomePath: p.codexHomePath });
    codexProfiles.touchStatus({ id: p.id, lastVerifiedAt: nowIso(), lastStatusText: result.text });
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/accounts/codex/:profileId/login/start", async (_req, res, _url, params) => {
    const p = codexProfiles.get(params.profileId);
    if (!p) return sendJson(res, 404, { ok: false, error: "not_found" });

    const codexPath = resolveCodexPath();
    const task = tasks.create({ kind: "codex_device_login" });

    const recent = [];
    const child = startDeviceLogin({
      codexPath,
      codexHomePath: p.codexHomePath,
      onLine: ({ stream, line }) => {
        tasks.emit(task, { type: "log", stream, line });
        recent.push(line);
        if (recent.length > 50) recent.splice(0, recent.length - 50);
        const info = parseDeviceInfo(recent);
        if (info) tasks.emit(task, { type: "device", url: info.url, code: info.code });
      },
    });

    child.on("close", async (code) => {
      const ok = code === 0;
      try {
        const status = await runCodexLoginStatus({ codexPath, codexHomePath: p.codexHomePath });
        codexProfiles.touchStatus({ id: p.id, lastVerifiedAt: nowIso(), lastStatusText: status.text });
      } catch {
        // ignore
      }
      tasks.finish(task, ok, code ?? null);
    });

    return sendJson(res, 200, { ok: true, taskId: task.id });
  });

  router.add("DELETE", "/api/accounts/codex/:profileId", async (_req, res, _url, params) => {
    const p = codexProfiles.get(params.profileId);
    if (!p) return sendJson(res, 404, { ok: false, error: "not_found" });

    db.prepare("BEGIN;").run();
    try {
      const active = settings.get(ACTIVE_KEY);
      if (active === params.profileId) settings.set(ACTIVE_KEY, "");
      codexProfiles.remove(params.profileId);
      db.prepare("COMMIT;").run();
    } catch (e) {
      db.prepare("ROLLBACK;").run();
      throw e;
    }

    return sendNoContent(res);
  });
}

module.exports = { registerCodexAccounts };


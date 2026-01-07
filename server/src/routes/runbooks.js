const fs = require("node:fs");

const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { loadRunbooksFromDir } = require("../lib/runbooks");

function registerRunbooks(router, deps) {
  const {
    runbooksDir,
    runbooksDb,
    chats,
    triage,
    tasks,
    codexProfiles,
    loadContext,
    runAssistant,
    getActiveCodexProfile,
    getCodexRunnerPrefs,
    listRunbooks,
    runRunbookOnce,
    updateRunbookFile,
  } = deps;

  function findRunbook(id) {
    const list = loadRunbooksFromDir(runbooksDir);
    return list.find((r) => r.id === id) || null;
  }

  router.add("GET", "/api/runbooks", (_req, res) => {
    const runbooks = listRunbooks({ dir: runbooksDir, runbooksDb });
    return sendJson(res, 200, { ok: true, runbooks });
  });

  router.add("GET", "/api/runbooks/:runbookId", (_req, res, _url, params) => {
    const rb = findRunbook(params.runbookId);
    if (!rb) return sendJson(res, 404, { ok: false, error: "not_found" });
    const st = runbooksDb.getState(rb.id);
    const runs = runbooksDb.listRuns({ runbookId: rb.id, limit: 20 });
    return sendJson(res, 200, {
      ok: true,
      runbook: {
        id: rb.id,
        path: rb.path,
        meta: rb.meta,
        body: rb.body,
        state: st || null,
        runs,
      },
    });
  });

  router.add("POST", "/api/runbooks/:runbookId", async (req, res, _url, params) => {
    const rb = findRunbook(params.runbookId);
    if (!rb) return sendJson(res, 404, { ok: false, error: "not_found" });
    const body = await readJson(req);
    const patch = {};
    if (body?.enabled != null) patch.enabled = Boolean(body.enabled);
    if (body?.everyMinutes != null) patch.every_minutes = Number(body.everyMinutes) || null;
    if (body?.title != null) patch.title = String(body.title || "").trim();
    if (body?.accounts != null) patch.accounts = body.accounts;
    updateRunbookFile({ runbook: rb, patch });
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/runbooks/:runbookId/run-now", async (_req, res, _url, params) => {
    const rb = findRunbook(params.runbookId);
    if (!rb) return sendJson(res, 404, { ok: false, error: "not_found" });
    const started = [];
    for (const accountKey of rb.meta.accounts || []) {
      const task = tasks.create({ kind: "runbook_run_now", status: "running" });
      started.push({ accountKey, taskId: task.id });
      setImmediate(async () => {
        try {
          await runRunbookOnce({
            runbook: rb,
            accountKey,
            chats,
            triage,
            runbooksDb,
            loadContext,
            runAssistant,
            tasks,
            task,
            codexProfiles,
            getActiveCodexProfile,
            getCodexRunnerPrefs,
          });
        } catch (e) {
          tasks.finish(task, false, null);
        }
      });
    }
    return sendJson(res, 202, { ok: true, started });
  });

  router.add("GET", "/api/runbooks/:runbookId/runs", (_req, res, url, params) => {
    const limit = url.searchParams.get("limit") || "50";
    const runs = runbooksDb.listRuns({ runbookId: params.runbookId, limit });
    return sendJson(res, 200, { ok: true, runs });
  });

  router.add("POST", "/api/runbooks/reload", (_req, res) => {
    // No-op for now: scheduler reads from disk every tick.
    return sendJson(res, 200, { ok: true });
  });

  router.add("POST", "/api/runbooks/bootstrap", (_req, res) => {
    // Create dir if missing.
    try {
      fs.mkdirSync(runbooksDir, { recursive: true });
    } catch {
      // ignore
    }
    return sendJson(res, 200, { ok: true });
  });
}

module.exports = { registerRunbooks };

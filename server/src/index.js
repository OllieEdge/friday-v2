const http = require("node:http");
const { URL } = require("node:url");

const { loadRootEnv, envNumber, envString } = require("./config/env");
const { CONTEXT_DIR, RUNBOOKS_DIR, WEB_DIST_DIR } = require("./config/paths");
const { openDb } = require("./db/db");
const { migrate } = require("./db/migrate");
const { importLegacyChatsIfEmpty } = require("./db/import-legacy");
const { createRouter } = require("./http/router");
const { sendJson, sendText } = require("./http/respond");
const { serveStatic, serveSpaFallback } = require("./lib/static");
const { loadContextBundle } = require("./lib/context");
const { createTaskStore } = require("./lib/tasks");

const { createChatsQueries } = require("./db/queries/chats");
const { createSettingsQueries } = require("./db/queries/settings");
const { createCodexProfilesQueries } = require("./db/queries/codex-profiles");
const { createGoogleAccountsQueries } = require("./db/queries/google-accounts");
const { createMicrosoftAccountsQueries } = require("./db/queries/microsoft-accounts");
const { createTriageQueries } = require("./db/queries/triage");
const { createRunbookQueries } = require("./db/queries/runbooks");
const { createAuthQueries } = require("./db/queries/auth");
const { createTasksQueries } = require("./db/queries/tasks");

const { registerHealth } = require("./routes/health");
const { registerContext } = require("./routes/context");
const { registerChats } = require("./routes/chats");
const { registerTasks } = require("./routes/tasks");
const { registerCodexAccounts } = require("./routes/accounts-codex");
const { registerGoogleAccounts } = require("./routes/accounts-google");
const { registerMicrosoftAccounts } = require("./routes/accounts-microsoft");
const { registerRunnerSettings } = require("./routes/runner-settings");
const { registerModels } = require("./routes/models");
const { registerTools } = require("./routes/tools");
const { registerTriage } = require("./routes/triage");
const { registerRunbooks } = require("./routes/runbooks");
const { registerAuth, requireUser } = require("./routes/auth");
const { runAssistant } = require("./lib/runner");
const { listRunbooks, runRunbookOnce, updateRunbookFile } = require("./lib/runbook-runner");
const { startScheduler } = require("./lib/scheduler");

loadRootEnv();

const { db } = openDb();
migrate(db);
importLegacyChatsIfEmpty(db);

const chats = createChatsQueries(db);
const settings = createSettingsQueries(db);
const codexProfiles = createCodexProfilesQueries(db);
  const googleAccounts = createGoogleAccountsQueries(db);
  const microsoftAccounts = createMicrosoftAccountsQueries(db);
const triage = createTriageQueries(db);
const runbooksDb = createRunbookQueries(db);
const auth = createAuthQueries(db);
const tasksDb = createTasksQueries(db);
const tasks = createTaskStore({ tasksDb });

function loadContext() {
  return loadContextBundle({ contextDir: CONTEXT_DIR });
}

function getActiveCodexProfile() {
  const id = settings.get("active_codex_profile_id");
  if (!id) return null;
  return codexProfiles.get(id);
}

function getCodexRunnerPrefs() {
  return {
    sandboxMode: settings.get("codex_sandbox_mode") || "read-only",
    reasoningEffort: settings.get("codex_reasoning_effort") || "",
  };
}

function getAssistantRunnerPrefs() {
  return {
    runner: settings.get("assistant_runner") || "codex",
    openai: {
      model: settings.get("openai_model") || "",
      baseUrl: settings.get("openai_base_url") || "",
    },
    vertex: {
      model: settings.get("vertex_model") || "",
      projectId: envString("VERTEX_PROJECT_ID", "tmg-product-innovation-prod"),
      location: envString("VERTEX_LOCATION", "europe-west2"),
      authMode: settings.get("vertex_auth_mode") || envString("VERTEX_AUTH_MODE", "") || "aws_secret",
      googleAccountKey: settings.get("vertex_google_account_key") || envString("VERTEX_GOOGLE_ACCOUNT_KEY", "work") || "work",
    },
  };
}

const router = createRouter();

registerHealth(router);
registerAuth(router, { auth });
registerContext(router, { loadContext });
registerChats(router, {
  chats,
  loadContext,
  runAssistant: ({ context, chat, onEvent }) =>
    runAssistant({ context, chat, onEvent, getActiveCodexProfile, getCodexRunnerPrefs, getAssistantRunnerPrefs, googleAccounts }),
  tasks,
  codexProfiles,
});
registerTasks(router, { tasks });
  registerCodexAccounts(router, { db, codexProfiles, settings, tasks });
  registerGoogleAccounts(router, { googleAccounts });
  registerMicrosoftAccounts(router, { microsoftAccounts });
registerRunnerSettings(router, { settings });
registerModels(router, { settings, googleAccounts });
registerTools(router);
registerTriage(router, { triage });
registerRunbooks(router, {
  runbooksDir: RUNBOOKS_DIR,
  runbooksDb,
  chats,
  triage,
  tasks,
  codexProfiles,
  loadContext,
  runAssistant,
  getActiveCodexProfile,
  getCodexRunnerPrefs,
  getAssistantRunnerPrefs,
  listRunbooks,
  runRunbookOnce,
  updateRunbookFile,
});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth/")) {
      const isPublic =
        url.pathname === "/api/health" ||
        url.pathname === "/api/tools/exec" ||
        url.pathname.startsWith("/api/auth/") ||
        // allow OAuth callbacks to read the session cookie if present; otherwise they'll be rejected by handler.
        url.pathname.startsWith("/oauth/");

      if (!isPublic) {
        const ctx = await requireUser({ req, auth });
        if (!ctx) return sendJson(res, 401, { ok: false, error: "unauthorized" });
        req.user = ctx.user;
      }

      const handled = await router.handle(req, res, url);
      if (handled !== false) return;
      return sendJson(res, 404, { ok: false, error: "not_found" });
    }

    if (serveStatic({ baseDir: WEB_DIST_DIR, urlPath: url.pathname, res })) return;
    if (serveSpaFallback({ baseDir: WEB_DIST_DIR, res })) return;

    return sendText(res, 404, "Web UI not built yet. Run: npm run build");
  } catch (e) {
    return sendJson(res, 500, { ok: false, error: "server_error", message: String(e?.message || e) });
  }
});

const PORT = envNumber("PORT", 3333);
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Friday v2 listening on http://127.0.0.1:${PORT}`);
});

startScheduler({
  tickMs: envNumber("RUNBOOK_TICK_MS", 15000),
  getRunbooks: () => listRunbooks({ dir: RUNBOOKS_DIR, runbooksDb }),
  runRunbook: async (rbSummary) => {
    const runbooks = require("./lib/runbooks").loadRunbooksFromDir(RUNBOOKS_DIR);
    const rb = runbooks.find((r) => r.id === rbSummary.id);
    if (!rb) return;
    for (const accountKey of rb.meta.accounts || []) {
      await runRunbookOnce({
        runbook: rb,
        accountKey,
        chats,
        triage,
        runbooksDb,
        loadContext,
        runAssistant,
        tasks,
        codexProfiles,
        getActiveCodexProfile,
        getCodexRunnerPrefs,
        getAssistantRunnerPrefs,
      });
    }
  },
});

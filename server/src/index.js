const http = require("node:http");
const { URL } = require("node:url");

const { loadRootEnv, envNumber } = require("./config/env");
const { CONTEXT_DIR, WEB_DIST_DIR } = require("./config/paths");
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

const { registerHealth } = require("./routes/health");
const { registerContext } = require("./routes/context");
const { registerChats } = require("./routes/chats");
const { registerTasks } = require("./routes/tasks");
const { registerCodexAccounts } = require("./routes/accounts-codex");
const { registerGoogleAccounts } = require("./routes/accounts-google");
const { runAssistant } = require("./lib/runner");

loadRootEnv();

const { db } = openDb();
migrate(db);
importLegacyChatsIfEmpty(db);

const chats = createChatsQueries(db);
const settings = createSettingsQueries(db);
const codexProfiles = createCodexProfilesQueries(db);
const googleAccounts = createGoogleAccountsQueries(db);
const tasks = createTaskStore();

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

const router = createRouter();

registerHealth(router);
registerContext(router, { loadContext });
registerChats(router, {
  chats,
  loadContext,
  runAssistant: ({ context, chat, onEvent }) =>
    runAssistant({ context, chat, onEvent, getActiveCodexProfile, getCodexRunnerPrefs }),
  tasks,
  codexProfiles,
});
registerTasks(router, { tasks });
registerCodexAccounts(router, { db, codexProfiles, settings, tasks });
registerGoogleAccounts(router, { googleAccounts });

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  try {
    if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/oauth/")) {
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

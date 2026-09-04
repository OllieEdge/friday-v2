const { readJson } = require("../http/body");
const { sendJson } = require("../http/respond");
const { envString } = require("../config/env");
const { ROOT_DIR } = require("../config/paths");
const { readAssistantRunnerPrefs } = require("./runner-settings");
const { execCommand } = require("../lib/tool-exec");
const { runVertexChat } = require("../lib/vertex");
const { resolveCodexPath, runCodexLoginStatus, runCodexExec } = require("../lib/codex");
const {
  MODEL_REGISTRY_JSON,
  loadModelRegistry,
  saveModelRegistry,
  upsertModel,
  deleteModel,
  updateRouting,
  getModelById,
} = require("../lib/model-registry");

function toBool(value) {
  if (typeof value === "boolean") return value;
  const v = String(value || "").trim().toLowerCase();
  if (!v) return false;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function pushCheck(checks, id, ok, detail) {
  checks.push({ id: String(id || ""), ok: Boolean(ok), detail: String(detail || "") });
}

function summarizeChecks(checks) {
  const failed = checks.filter((c) => !c.ok);
  if (!failed.length) return "All certification checks passed.";
  return `${failed.length} check(s) failed: ${failed.map((c) => c.id).join(", ")}`;
}

async function certifyVertexModel({ model, deps, checks }) {
  const toolExecEnabled = toBool(envString("VERTEX_TOOL_EXEC", ""));
  const allowAll = toBool(envString("FRIDAY_TOOL_ALLOW_ALL", ""));
  const requireConfirm = envString("FRIDAY_TOOL_REQUIRE_CONFIRM", "");
  const hmacSet = Boolean(String(envString("FRIDAY_TOOL_HMAC_SECRET", "")).trim());

  pushCheck(checks, "vertex_tool_exec_enabled", toolExecEnabled, toolExecEnabled ? "VERTEX_TOOL_EXEC enabled." : "Set VERTEX_TOOL_EXEC=1.");
  pushCheck(checks, "tool_allow_all", allowAll, allowAll ? "FRIDAY_TOOL_ALLOW_ALL enabled." : "Set FRIDAY_TOOL_ALLOW_ALL=1.");
  pushCheck(
    checks,
    "tool_require_confirm_disabled",
    requireConfirm === "" || !toBool(requireConfirm),
    requireConfirm === "" || !toBool(requireConfirm)
      ? "Tool confirmation prompts are disabled for automation."
      : "Set FRIDAY_TOOL_REQUIRE_CONFIRM=0 for autonomous tool usage.",
  );
  pushCheck(checks, "tool_hmac_secret_set", hmacSet, hmacSet ? "FRIDAY_TOOL_HMAC_SECRET is configured." : "Set FRIDAY_TOOL_HMAC_SECRET.");

  if (!toolExecEnabled || !allowAll) {
    pushCheck(checks, "vertex_tool_call_probe", false, "Skipped because tool execution is not fully enabled.");
    return false;
  }

  const prefs = readAssistantRunnerPrefs({ settings: deps.settings });
  const probeModel = String(model.model || prefs?.vertex?.model || "").trim();
  if (!probeModel) {
    pushCheck(checks, "vertex_model_configured", false, "No vertex model configured in registry or runner settings.");
    return false;
  }
  pushCheck(checks, "vertex_model_configured", true, `Using ${probeModel}.`);

  let called = 0;
  try {
    const result = await runVertexChat({
      system:
        "You are a certification harness. You must use tools before replying.",
      messages: [
        {
          role: "user",
          content:
            "Call exec_command exactly once with command '/bin/echo', args ['VERTEX_TOOL_CERT_OK'], confirm true. " +
            "After the tool response, reply exactly: CERTIFIED VERTEX_TOOL_CERT_OK",
        },
      ],
      model: probeModel,
      authMode: prefs?.vertex?.authMode || "",
      googleAccountKey: prefs?.vertex?.googleAccountKey || "",
      googleAccounts: deps.googleAccounts,
      toolHandler: async (call) => {
        called += 1;
        if (!call || call.name !== "exec_command") {
          return { ok: false, error: "unexpected_tool", got: call?.name || "" };
        }
        const args = call.args || {};
        const cmd = String(args.command || "").trim();
        const cmdOk = cmd === "/bin/echo" || cmd === "echo";
        if (!cmdOk) return { ok: false, error: "unexpected_command", command: cmd };
        return execCommand({
          command: "/bin/echo",
          args: ["VERTEX_TOOL_CERT_OK"],
          confirm: true,
          timeoutMs: 5000,
        });
      },
    });
    const content = String(result?.content || "").trim();
    const pass = called > 0 && /CERTIFIED\s+VERTEX_TOOL_CERT_OK/i.test(content);
    pushCheck(
      checks,
      "vertex_tool_call_probe",
      pass,
      pass
        ? "Model called exec_command and returned certification token."
        : `Probe failed. toolCalls=${called} output=${content.slice(0, 180) || "(empty)"}`,
    );
    return pass;
  } catch (err) {
    pushCheck(checks, "vertex_tool_call_probe", false, String(err?.message || err));
    return false;
  }
}

async function certifyCodexModel({ model, deps, checks }) {
  const profile = typeof deps.getActiveCodexProfile === "function" ? deps.getActiveCodexProfile() : null;
  if (!profile) {
    pushCheck(checks, "codex_profile_active", false, "No active Codex account in Settings → Accounts.");
    return false;
  }
  pushCheck(checks, "codex_profile_active", true, `Active profile: ${profile.label || profile.id}`);

  const codexPath = resolveCodexPath();
  const status = await runCodexLoginStatus({ codexPath, codexHomePath: profile.codexHomePath });
  pushCheck(checks, "codex_logged_in", Boolean(status.loggedIn), status.loggedIn ? "Codex login status OK." : "Codex profile is not logged in.");
  if (!status.loggedIn) return false;

  const prefs = (typeof deps.getCodexRunnerPrefs === "function" ? deps.getCodexRunnerPrefs() : null) || {};
  const configOverrides = ['approval_policy="never"', 'network_access="enabled"'];
  if (prefs.reasoningEffort) configOverrides.push(`model_reasoning_effort="${String(prefs.reasoningEffort).trim()}"`);

  try {
    const result = await runCodexExec({
      codexPath,
      codexHomePath: profile.codexHomePath,
      repoRoot: ROOT_DIR,
      promptText:
        "Run the shell command `/bin/echo CODEX_TOOL_CERT_OK` and then respond exactly with:\n" +
        "CERTIFIED CODEX_TOOL_CERT_OK",
      model: String(model.model || envString("CODEX_MODEL", "")).trim(),
      sandboxMode: prefs.sandboxMode || "read-only",
      configOverrides,
    });
    const text = String(result?.content || "").trim();
    const pass = /CERTIFIED\s+CODEX_TOOL_CERT_OK/i.test(text);
    pushCheck(
      checks,
      "codex_tool_call_probe",
      pass,
      pass ? "Codex responded with certification token." : `Unexpected output: ${text.slice(0, 180) || "(empty)"}`,
    );
    return pass;
  } catch (err) {
    pushCheck(checks, "codex_tool_call_probe", false, String(err?.message || err));
    return false;
  }
}

async function certifyModel({ model, deps }) {
  const checks = [];
  pushCheck(checks, "model_enabled", Boolean(model.enabled), model.enabled ? "Model is enabled." : "Model is disabled.");
  pushCheck(
    checks,
    "tool_capability_declared",
    Boolean(model?.capabilities?.toolCalling),
    model?.capabilities?.toolCalling ? "Model marked as tool-capable." : "Set capabilities.toolCalling=true before certification.",
  );

  if (!model.enabled || !model?.capabilities?.toolCalling) {
    return {
      ok: false,
      summary: summarizeChecks(checks),
      checks,
    };
  }

  const provider = String(model.provider || "").trim().toLowerCase();
  let providerPass = false;
  if (provider === "vertex") providerPass = await certifyVertexModel({ model, deps, checks });
  else if (provider === "codex") providerPass = await certifyCodexModel({ model, deps, checks });
  else {
    pushCheck(
      checks,
      "provider_tool_support",
      false,
      `Provider '${provider || "unknown"}' does not have tool certification implemented yet in Friday.`,
    );
    providerPass = false;
  }

  return {
    ok: providerPass && checks.every((c) => c.ok),
    summary: summarizeChecks(checks),
    checks,
  };
}

function registerModelRegistry(router, deps = {}) {
  router.add("GET", "/api/model-registry", (_req, res) => {
    const store = loadModelRegistry();
    return sendJson(res, 200, { ok: true, store, file: MODEL_REGISTRY_JSON });
  });

  router.add("POST", "/api/model-registry", async (req, res) => {
    let body = null;
    try {
      body = await readJson(req);
    } catch {
      body = null;
    }

    if (body?.store && typeof body.store === "object") {
      const saved = saveModelRegistry(body.store);
      return sendJson(res, 200, { ok: true, store: saved, file: MODEL_REGISTRY_JSON });
    }
    if (body?.model && typeof body.model === "object") {
      const out = upsertModel(body.model);
      return sendJson(res, 200, { ok: true, model: out.model, store: out.store, file: MODEL_REGISTRY_JSON });
    }
    if (body?.routing && typeof body.routing === "object") {
      const out = updateRouting(body.routing);
      return sendJson(res, 200, { ok: true, routing: out.routing, store: out.store, file: MODEL_REGISTRY_JSON });
    }
    return sendJson(res, 400, { ok: false, error: "missing_store_or_model_or_routing" });
  });

  router.add("DELETE", "/api/model-registry/:modelId", (_req, res, _url, params) => {
    const out = deleteModel(String(params.modelId || ""));
    if (!out.ok) return sendJson(res, 404, { ok: false, error: out.error || "not_found", store: out.store });
    return sendJson(res, 200, { ok: true, store: out.store, file: MODEL_REGISTRY_JSON });
  });

  router.add("POST", "/api/model-registry/:modelId/certify", async (_req, res, _url, params) => {
    const modelId = String(params.modelId || "");
    const { store, model } = getModelById(modelId);
    if (!model) return sendJson(res, 404, { ok: false, error: "not_found", store, file: MODEL_REGISTRY_JSON });

    const cert = await certifyModel({ model, deps });
    const idx = store.models.findIndex((m) => m.id === model.id);
    if (idx >= 0) {
      store.models[idx] = {
        ...store.models[idx],
        certification: {
          status: cert.ok ? "ok" : "failed",
          lastRunAt: new Date().toISOString(),
          lastOk: cert.ok,
          checks: cert.checks,
        },
        updatedAt: new Date().toISOString(),
      };
    }
    const saved = saveModelRegistry(store);
    const nextModel = saved.models.find((m) => m.id === model.id) || model;
    return sendJson(res, 200, {
      ok: true,
      model: nextModel,
      certification: {
        ok: cert.ok,
        summary: cert.summary,
        checks: cert.checks,
      },
      store: saved,
      file: MODEL_REGISTRY_JSON,
    });
  });
}

module.exports = { registerModelRegistry };

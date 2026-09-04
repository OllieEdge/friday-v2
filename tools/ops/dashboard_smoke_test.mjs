#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import process from "node:process";

const ROOT = "/Users/ollie/workspace/friday-v2";
const NODE_BIN = "/opt/homebrew/bin/node";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return true;
    } catch {
      // keep trying
    }
    await sleep(300);
  }
  return false;
}

async function callJson({ baseUrl, method, path, token, body }) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "x-friday-test-bypass": token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return {
    method,
    path,
    status: res.status,
    okHttp: res.ok,
    okJson: json?.ok === true,
    error: json?.error || null,
    json,
  };
}

function summariseJson(json) {
  if (!json || typeof json !== "object") return null;
  const out = {};
  if (json.ok != null) out.ok = json.ok;
  if (Array.isArray(json.items)) out.items = json.items.length;
  if (Array.isArray(json.actions)) out.actions = json.actions.length;
  if (Array.isArray(json.runbooks)) out.runbooks = json.runbooks.length;
  if (Array.isArray(json.timeline)) out.timeline = json.timeline.length;
  if (Array.isArray(json.started)) out.started = json.started.length;
  if (json.overview?.health?.level) out.health = json.overview.health.level;
  if (json.overview?.queue?.triage?.open != null) out.triageOpen = json.overview.queue.triage.open;
  if (json.overview?.queue?.actions?.pending != null) out.actionsPending = json.overview.queue.actions.pending;
  if (json.overview?.queue?.runbooks?.error != null) out.runbookErrors = json.overview.queue.runbooks.error;
  return out;
}

function proposeSmokeAction(tag) {
  const cmd = [
    "tools/message-automation/actions.mjs",
    "propose",
    "--channel",
    "imessage",
    "--contact",
    "+447700000000",
    "--intent",
    "todo",
    "--summary",
    `smoke-${tag}`,
    "--source-text",
    `smoke-${tag}`,
  ];

  const r = spawnSync(NODE_BIN, cmd, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 1024 * 1024,
  });

  if (r.status !== 0) {
    return { ok: false, error: `action_propose_failed: ${String(r.stderr || r.stdout || "unknown")}` };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(String(r.stdout || "{}"));
  } catch {
    return { ok: false, error: "action_propose_not_json" };
  }

  if (!parsed?.ok || !parsed?.action?.id) {
    return { ok: false, error: "action_propose_no_id" };
  }

  return { ok: true, actionId: String(parsed.action.id) };
}

async function main() {
  const port = Number(process.env.SMOKE_PORT || 3399);
  const token = process.env.SMOKE_BYPASS_TOKEN || `smoke-${crypto.randomBytes(6).toString("hex")}`;
  const baseUrl = `http://127.0.0.1:${port}`;

  const server = spawn(NODE_BIN, ["server/src/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port),
      FRIDAY_TEST_BYPASS_ENABLED: "1",
      FRIDAY_TEST_BYPASS_TOKEN: token,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const logs = [];
  server.stdout.on("data", (d) => logs.push(String(d)));
  server.stderr.on("data", (d) => logs.push(String(d)));

  try {
    const ready = await waitForHealth(baseUrl, 20000);
    if (!ready) {
      console.error(JSON.stringify({ ok: false, error: "server_not_ready", logs: logs.slice(-20) }, null, 2));
      process.exit(2);
    }

    const checks = [
      ["GET", "/api/auth/status"],
      ["GET", "/api/ops/overview"],
      ["GET", "/api/ops/actions?status=all&limit=20"],
      ["GET", "/api/ops/timeline?limit=20"],
      ["POST", "/api/ops/refresh", {}],
      ["GET", "/api/triage/items?status=open&kind=quick_read&limit=20"],
      ["GET", "/api/triage/items?status=open&kind=next_action&limit=20"],
      ["GET", "/api/chats"],
      ["GET", "/api/people"],
      ["GET", "/api/runbooks"],
      ["GET", "/api/accounts/codex"],
      ["GET", "/api/accounts/google"],
      ["GET", "/api/accounts/microsoft"],
      ["GET", "/api/settings/runner"],
      ["GET", "/api/auth/passkeys"],
      ["GET", "/api/models/vertex"],
    ];

    const results = [];

    for (const [method, path, body] of checks) {
      const result = await callJson({ baseUrl, method, path, token, body });
      results.push(result);
    }

    const actionSeed = proposeSmokeAction(Date.now());
    if (!actionSeed.ok) {
      results.push({ method: "LOCAL", path: "action_seed", status: 0, okHttp: false, okJson: false, error: actionSeed.error });
    } else {
      const a1 = await callJson({
        baseUrl,
        method: "POST",
        path: `/api/ops/actions/${encodeURIComponent(actionSeed.actionId)}/status`,
        token,
        body: { status: "confirmed" },
      });
      const a2 = await callJson({
        baseUrl,
        method: "POST",
        path: `/api/ops/actions/${encodeURIComponent(actionSeed.actionId)}/status`,
        token,
        body: { status: "completed" },
      });
      results.push(a1, a2);
    }

    const runbooksRes = await callJson({ baseUrl, method: "GET", path: "/api/runbooks", token });
    results.push(runbooksRes);

    const runbooks = Array.isArray(runbooksRes.json?.runbooks) ? runbooksRes.json.runbooks : [];
    const targetRunbook = runbooks.find((r) => r.id === "ops-control-tower-hourly") || runbooks[0] || null;
    if (targetRunbook?.id) {
      const runNow = await callJson({
        baseUrl,
        method: "POST",
        path: `/api/runbooks/${encodeURIComponent(targetRunbook.id)}/run-now`,
        token,
        body: {},
      });
      results.push(runNow);
    }

    const failures = results.filter((r) => {
      if (r.path === "/api/models/vertex") {
        return !(r.status === 200 || r.status === 400 || r.status === 500);
      }
      return !(r.okHttp && (r.okJson || r.status === 202));
    });

    const output = {
      ok: failures.length === 0,
      ts: new Date().toISOString(),
      checks: results.map((r) => ({
        method: r.method,
        path: r.path,
        status: r.status,
        okHttp: r.okHttp,
        okJson: r.okJson,
        error: r.error,
        summary: summariseJson(r.json),
      })),
      failures: failures.map((r) => ({
        method: r.method,
        path: r.path,
        status: r.status,
        okHttp: r.okHttp,
        okJson: r.okJson,
        error: r.error,
      })),
    };

    console.log(JSON.stringify(output, null, 2));

    if (failures.length > 0) {
      process.exitCode = 2;
    }
  } finally {
    server.kill("SIGTERM");
    await sleep(300);
    if (!server.killed) server.kill("SIGKILL");
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 2));
  process.exit(2);
});

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
    staleHours: Number(argValue(argv, "--stale-hours") || 24),
    pendingLimit: Number(argValue(argv, "--pending-limit") || 30),
  };
}

function argValue(argv, key) {
  const idx = argv.indexOf(key);
  if (idx === -1) return null;
  return argv[idx + 1] ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function safeJsonParse(raw, fallback) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return fallback;
  }
}

function loadActions(actionsPath) {
  if (!fs.existsSync(actionsPath)) return [];
  const raw = fs.readFileSync(actionsPath, "utf8");
  const arr = safeJsonParse(raw, []);
  return Array.isArray(arr) ? arr : [];
}

function hasTable(db, name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;").get(String(name));
  return Boolean(row?.name);
}

function pickFindings({ db, staleHours, pendingLimit, actions }) {
  const findings = [];
  const staleSince = hoursAgoIso(staleHours);

  if (hasTable(db, "runbook_state")) {
    const runbookErrors = db
      .prepare(
        "SELECT runbook_id AS runbookId, last_status AS lastStatus, last_error AS lastError, last_run_at AS lastRunAt FROM runbook_state WHERE last_status = 'error' ORDER BY last_run_at DESC LIMIT 20;",
      )
      .all();
    for (const row of runbookErrors) {
      findings.push({
        kind: "next_action",
        priority: 2,
        confidence_pct: 92,
        source_key: `ops:runbook:error:${row.runbookId}`,
        title: `Runbook failing: ${row.runbookId}`,
        summary_md:
          `Runbook **${row.runbookId}** is in error state.\n\n` +
          `- Last status: \`${row.lastStatus}\`\n` +
          `- Last run: ${row.lastRunAt || "unknown"}\n` +
          `- Error: ${row.lastError || "unknown"}\n\n` +
          `Action: inspect runbook output and fix connector/auth issues.`,
        source: { ops: { type: "runbook_state", runbookId: row.runbookId } },
      });
    }

    const staleRunbooks = db
      .prepare(
        "SELECT runbook_id AS runbookId, last_run_at AS lastRunAt, last_status AS lastStatus FROM runbook_state WHERE last_run_at IS NULL OR last_run_at < ? ORDER BY COALESCE(last_run_at, '') ASC LIMIT 20;",
      )
      .all(staleSince);
    for (const row of staleRunbooks) {
      findings.push({
        kind: "quick_read",
        priority: 1,
        confidence_pct: 80,
        source_key: `ops:runbook:stale:${row.runbookId}`,
        title: `Runbook stale: ${row.runbookId}`,
        summary_md:
          `Runbook **${row.runbookId}** has not run recently.\n\n` +
          `- Last run: ${row.lastRunAt || "never"}\n` +
          `- Last status: ${row.lastStatus || "unknown"}\n\n` +
          `Action: confirm scheduler health or temporarily run manually.`,
        source: { ops: { type: "runbook_state", runbookId: row.runbookId } },
      });
    }
  }

  if (hasTable(db, "triage_items")) {
    const staleOpen = db
      .prepare(
        "SELECT id, runbook_id AS runbookId, kind, title, priority, updated_at AS updatedAt FROM triage_items WHERE status='open' AND updated_at < ? ORDER BY priority DESC, updated_at ASC LIMIT ?;",
      )
      .all(staleSince, Math.max(1, pendingLimit));

    if (staleOpen.length > 0) {
      const byRunbook = new Map();
      for (const row of staleOpen) {
        const k = row.runbookId || "unscoped";
        byRunbook.set(k, (byRunbook.get(k) || 0) + 1);
      }
      const lines = Array.from(byRunbook.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n");

      findings.push({
        kind: "next_action",
        priority: 2,
        confidence_pct: 89,
        source_key: `ops:triage:stale-open:${staleOpen.length}:${staleSince.slice(0, 13)}`,
        title: `Stale triage backlog: ${staleOpen.length} open items`,
        summary_md:
          `There are **${staleOpen.length}** open triage items older than ${staleHours}h.\n\n` +
          `${lines || "- no breakdown available"}\n\n` +
          `Action: review top stale actions and close, dismiss, or reprioritize.`,
        source: { ops: { type: "triage_stale", count: staleOpen.length, staleHours } },
      });
    }
  }

  const pendingActions = actions.filter((a) => String(a?.status || "") === "pending");
  if (pendingActions.length > 0) {
    const lines = pendingActions
      .slice(0, 10)
      .map((a) => `- ${a.id}: ${a.intent || "action"} — ${a.summary || "(no summary)"}`)
      .join("\n");

    findings.push({
      kind: "next_action",
      priority: 2,
      confidence_pct: 93,
      source_key: `ops:message-actions:pending:${pendingActions.length}`,
      title: `Pending message actions: ${pendingActions.length}`,
      summary_md:
        `There are **${pendingActions.length}** pending actions captured from messaging channels.\n\n` +
        `${lines}\n\n` +
        `Action: confirm or dismiss pending actions to keep automations trustworthy.`,
      source: { ops: { type: "message_actions_pending", count: pendingActions.length } },
    });
  }

  const confirmedActions = actions.filter((a) => String(a?.status || "") === "confirmed");
  if (confirmedActions.length > 0) {
    const lines = confirmedActions
      .slice(0, 10)
      .map((a) => `- ${a.id}: ${a.intent || "action"} — ${a.summary || "(no summary)"}`)
      .join("\n");

    findings.push({
      kind: "next_action",
      priority: 1,
      confidence_pct: 88,
      source_key: `ops:message-actions:confirmed:${confirmedActions.length}`,
      title: `Confirmed message actions awaiting completion: ${confirmedActions.length}`,
      summary_md:
        `There are **${confirmedActions.length}** confirmed actions that still need execution.\n\n` +
        `${lines}\n\n` +
        `Action: complete or cancel these confirmed actions so they don't silently age out.`,
      source: { ops: { type: "message_actions_confirmed", count: confirmedActions.length } },
    });
  }

  return findings;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
  const dbPath = path.join(rootDir, "data", "friday.sqlite");
  const actionsPath = path.join(rootDir, "data", "message-automation", "actions.json");

  if (!fs.existsSync(dbPath)) {
    const out = { ok: false, error: `DB not found: ${dbPath}` };
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
    process.exit(2);
  }

  const db = new DatabaseSync(dbPath, { readonly: true });
  const actions = loadActions(actionsPath);

  const summary = {
    ts: nowIso(),
    staleHours: args.staleHours,
    triage: { open: 0, completed: 0, dismissed: 0 },
    runbooks: { total: 0, error: 0 },
    messageActions: {
      total: actions.length,
      pending: actions.filter((a) => String(a?.status || "") === "pending").length,
      confirmed: actions.filter((a) => String(a?.status || "") === "confirmed").length,
    },
  };

  if (hasTable(db, "triage_items")) {
    const rows = db
      .prepare("SELECT status, COUNT(*) AS c FROM triage_items GROUP BY status;")
      .all();
    for (const row of rows) {
      const k = String(row.status || "");
      if (k === "open") summary.triage.open = Number(row.c || 0);
      if (k === "completed") summary.triage.completed = Number(row.c || 0);
      if (k === "dismissed") summary.triage.dismissed = Number(row.c || 0);
    }
  }

  if (hasTable(db, "runbook_state")) {
    const rows = db
      .prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN last_status='error' THEN 1 ELSE 0 END) AS errors FROM runbook_state;")
      .get();
    summary.runbooks.total = Number(rows?.total || 0);
    summary.runbooks.error = Number(rows?.errors || 0);
  }

  const findings = pickFindings({
    db,
    staleHours: args.staleHours,
    pendingLimit: args.pendingLimit,
    actions,
  });

  const out = {
    ok: true,
    summary,
    findings,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + "\n");
  } else {
    process.stdout.write(`ts: ${summary.ts}\n`);
    process.stdout.write(`triage_open: ${summary.triage.open}\n`);
    process.stdout.write(`runbook_errors: ${summary.runbooks.error}\n`);
    process.stdout.write(`message_actions_pending: ${summary.messageActions.pending}\n`);
    process.stdout.write(`findings: ${findings.length}\n`);
  }
}

main();

#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function usage(code = 0) {
  // eslint-disable-next-line no-console
  console.log(`Usage:
  node tools/triage/triage.mjs list --status open|completed|dismissed [--kind quick_read|next_action]
  node tools/triage/triage.mjs set-status --id <triageItemId> --status open|completed|dismissed
  node tools/triage/triage.mjs set-priority --id <triageItemId> --priority <0..3>
  node tools/triage/triage.mjs add-feedback --id <triageItemId> --kind <dismissed|completed|reopened|priority_set|note> [--reason <...>] [--outcome <...>] [--notes <...>]
  node tools/triage/triage.mjs list-feedback [--runbook <runbookId>] [--limit <n>]

Notes:
  - Uses Friday v2 SQLite at data/friday.sqlite
  - This tool is intentionally tiny and deterministic (safe for Codex to call).
`);
  process.exit(code);
}

function argValue(args, key) {
  const idx = args.indexOf(key);
  if (idx === -1) return null;
  return args[idx + 1] ?? null;
}

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return crypto.randomUUID();
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help") || args.length === 0) usage(0);

const rootDir = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const dbPath = path.join(rootDir, "data", "friday.sqlite");
if (!fs.existsSync(dbPath)) {
  // eslint-disable-next-line no-console
  console.error(`DB not found: ${dbPath}`);
  process.exit(2);
}

const db = new DatabaseSync(dbPath);
const cmd = args[0];

function hasTable(name) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=? LIMIT 1;").get(String(name));
  return Boolean(row?.name);
}

function requireTables(names) {
  const missing = (names || []).filter((n) => !hasTable(n));
  if (!missing.length) return;
  // eslint-disable-next-line no-console
  console.error(`Missing required tables: ${missing.join(", ")}. Is Friday v2 server running and migrated?`);
  process.exit(2);
}

if (cmd === "list") {
  requireTables(["triage_items"]);
  const status = String(argValue(args, "--status") || "open").trim();
  const kind = argValue(args, "--kind");
  const lim = 200;
  const rows = kind
    ? db
        .prepare(
          "SELECT id, kind, status, title, priority, confidence_pct AS confidencePct, updated_at AS updatedAt FROM triage_items WHERE status = ? AND kind = ? ORDER BY updated_at DESC LIMIT ?;",
        )
        .all(status, String(kind), lim)
    : db
        .prepare("SELECT id, kind, status, title, priority, updated_at AS updatedAt FROM triage_items WHERE status = ? ORDER BY updated_at DESC LIMIT ?;")
        .all(status, lim);
  process.stdout.write(JSON.stringify({ ok: true, items: rows }, null, 2));
  process.stdout.write("\n");
  process.exit(0);
}

if (cmd === "set-status") {
  requireTables(["triage_items"]);
  const id = String(argValue(args, "--id") || "").trim();
  const status = String(argValue(args, "--status") || "").trim();
  if (!id || !status) usage(2);
  const completedAt = status === "completed" ? nowIso() : null;
  db.prepare("UPDATE triage_items SET status = ?, updated_at = ?, completed_at = ? WHERE id = ?;").run(status, nowIso(), completedAt, id);
  try {
    requireTables(["triage_feedback"]);
    const kind = status === "dismissed" ? "dismissed" : status === "completed" ? "completed" : status === "open" ? "reopened" : "status_set";
    db.prepare(
      "INSERT INTO triage_feedback (id, item_id, kind, actor, reason, outcome, notes, meta_json, created_at) VALUES (?, ?, ?, 'assistant', NULL, NULL, NULL, NULL, ?);",
    ).run(newId(), id, kind, nowIso());
  } catch {
    // ignore
  }
  process.stdout.write(JSON.stringify({ ok: true }, null, 2));
  process.stdout.write("\n");
  process.exit(0);
}

if (cmd === "set-priority") {
  requireTables(["triage_items", "triage_feedback"]);
  const id = String(argValue(args, "--id") || "").trim();
  const priorityRaw = argValue(args, "--priority");
  if (!id || priorityRaw == null) usage(2);
  const priority = Math.max(0, Math.min(10, Math.round(Number(priorityRaw) || 0)));
  db.prepare("UPDATE triage_items SET priority = ?, updated_at = ? WHERE id = ?;").run(priority, nowIso(), id);
  try {
    db.prepare(
      "INSERT INTO triage_feedback (id, item_id, kind, actor, reason, outcome, notes, meta_json, created_at) VALUES (?, ?, 'priority_set', 'assistant', NULL, NULL, NULL, ?, ?);",
    ).run(newId(), id, JSON.stringify({ priority }), nowIso());
  } catch {
    // ignore
  }
  process.stdout.write(JSON.stringify({ ok: true }, null, 2));
  process.stdout.write("\n");
  process.exit(0);
}

if (cmd === "add-feedback") {
  requireTables(["triage_feedback"]);
  const id = String(argValue(args, "--id") || "").trim();
  const kind = String(argValue(args, "--kind") || "").trim();
  const reason = argValue(args, "--reason");
  const outcome = argValue(args, "--outcome");
  const notes = argValue(args, "--notes");
  if (!id || !kind) usage(2);
  db.prepare(
    "INSERT INTO triage_feedback (id, item_id, kind, actor, reason, outcome, notes, meta_json, created_at) VALUES (?, ?, ?, 'assistant', ?, ?, ?, NULL, ?);",
  ).run(newId(), id, kind, reason || null, outcome || null, notes || null, nowIso());
  process.stdout.write(JSON.stringify({ ok: true }, null, 2));
  process.stdout.write("\n");
  process.exit(0);
}

if (cmd === "list-feedback") {
  requireTables(["triage_feedback", "triage_items"]);
  const runbookId = argValue(args, "--runbook");
  const lim = Math.max(1, Math.min(500, Math.round(Number(argValue(args, "--limit") || 50) || 50)));
  const rows = runbookId
    ? db
        .prepare(
          "SELECT f.id, f.item_id AS itemId, f.kind, f.actor, f.reason, f.outcome, f.notes, f.created_at AS createdAt, i.runbook_id AS runbookId, i.title AS itemTitle, i.priority AS itemPriority FROM triage_feedback f JOIN triage_items i ON i.id = f.item_id WHERE i.runbook_id = ? ORDER BY f.created_at DESC LIMIT ?;",
        )
        .all(String(runbookId), lim)
    : db
        .prepare(
          "SELECT f.id, f.item_id AS itemId, f.kind, f.actor, f.reason, f.outcome, f.notes, f.created_at AS createdAt, i.runbook_id AS runbookId, i.title AS itemTitle, i.priority AS itemPriority FROM triage_feedback f JOIN triage_items i ON i.id = f.item_id ORDER BY f.created_at DESC LIMIT ?;",
        )
        .all(lim);
  process.stdout.write(JSON.stringify({ ok: true, feedback: rows }, null, 2));
  process.stdout.write("\n");
  process.exit(0);
}

usage(2);

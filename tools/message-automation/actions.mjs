#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA_DIR = path.join(ROOT, "data", "message-automation");
const ACTIONS_PATH = path.join(DATA_DIR, "actions.json");
const EVENTS_PATH = path.join(DATA_DIR, "events.jsonl");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = next;
    i += 1;
  }
  return out;
}

function nowIso() {
  return new Date().toISOString();
}

function print(obj, code = 0) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
  process.exit(code);
}

async function ensureStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(ACTIONS_PATH);
  } catch {
    await fs.writeFile(ACTIONS_PATH, "[]\n", "utf8");
  }
}

async function readActions() {
  await ensureStore();
  const raw = await fs.readFile(ACTIONS_PATH, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error("invalid_actions_store");
  return data;
}

async function writeActions(actions) {
  await fs.writeFile(ACTIONS_PATH, `${JSON.stringify(actions, null, 2)}\n`, "utf8");
}

async function appendEvent(type, payload) {
  const event = {
    ts: nowIso(),
    type,
    payload,
  };
  await fs.appendFile(EVENTS_PATH, `${JSON.stringify(event)}\n`, "utf8");
}

function nextId(actions) {
  let max = 0;
  for (const a of actions) {
    const n = Number(String(a.id || "").replace(/^A-/, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `A-${String(max + 1).padStart(6, "0")}`;
}

function normalizeStatus(v) {
  if (!v || v === "all") return "all";
  const ok = new Set(["pending", "confirmed", "cancelled", "completed"]);
  if (!ok.has(v)) throw new Error("invalid_status");
  return v;
}

function requireArg(args, key) {
  const value = args[key];
  if (!value || value === true) throw new Error(`missing_${key}`);
  return String(value).trim();
}

async function cmdPropose(args) {
  const actions = await readActions();
  const action = {
    id: nextId(actions),
    createdAt: nowIso(),
    status: "pending",
    channel: requireArg(args, "channel"),
    contact: requireArg(args, "contact"),
    intent: requireArg(args, "intent"),
    summary: requireArg(args, "summary"),
    sourceText: requireArg(args, "source-text"),
    dueAt: args["due-at"] ? String(args["due-at"]).trim() : null,
    meta: args["meta-json"] ? JSON.parse(String(args["meta-json"])) : {},
    confirmedAt: null,
    completedAt: null,
    cancelledAt: null,
  };
  actions.push(action);
  await writeActions(actions);
  await appendEvent("propose", { id: action.id, channel: action.channel, contact: action.contact, intent: action.intent });
  print({ ok: true, action });
}

async function cmdList(args) {
  const status = normalizeStatus(args.status);
  const limit = Math.max(1, Math.min(200, Number(args.limit || 25)));
  const channel = args.channel ? String(args.channel) : null;
  const contact = args.contact ? String(args.contact) : null;
  const actions = await readActions();
  let filtered = actions;
  if (status !== "all") filtered = filtered.filter((a) => a.status === status);
  if (channel) filtered = filtered.filter((a) => a.channel === channel);
  if (contact) filtered = filtered.filter((a) => a.contact === contact);
  filtered = filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit);
  print({ ok: true, count: filtered.length, actions: filtered });
}

async function cmdGet(args) {
  const id = requireArg(args, "id");
  const actions = await readActions();
  const action = actions.find((a) => a.id === id);
  if (!action) return print({ ok: false, error: "not_found", id }, 1);
  print({ ok: true, action });
}

async function updateById(id, updater, eventType) {
  const actions = await readActions();
  const idx = actions.findIndex((a) => a.id === id);
  if (idx < 0) return print({ ok: false, error: "not_found", id }, 1);
  const current = actions[idx];
  const updated = updater({ ...current });
  actions[idx] = updated;
  await writeActions(actions);
  await appendEvent(eventType, { id, status: updated.status, channel: updated.channel, contact: updated.contact });
  print({ ok: true, action: updated });
}

async function cmdConfirm(args) {
  const id = requireArg(args, "id");
  await updateById(
    id,
    (a) => {
      if (a.status !== "pending") throw new Error("not_pending");
      a.status = "confirmed";
      a.confirmedAt = nowIso();
      return a;
    },
    "confirm",
  );
}

async function cmdConfirmLatest(args) {
  const channel = requireArg(args, "channel");
  const contact = requireArg(args, "contact");
  const actions = await readActions();
  const pending = actions
    .filter((a) => a.status === "pending" && a.channel === channel && a.contact === contact)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!pending.length) return print({ ok: false, error: "no_pending_for_contact", channel, contact }, 1);
  const id = pending[0].id;
  await updateById(
    id,
    (a) => {
      a.status = "confirmed";
      a.confirmedAt = nowIso();
      return a;
    },
    "confirm",
  );
}

async function cmdCancel(args) {
  const id = requireArg(args, "id");
  await updateById(
    id,
    (a) => {
      if (a.status === "completed") throw new Error("already_completed");
      a.status = "cancelled";
      a.cancelledAt = nowIso();
      return a;
    },
    "cancel",
  );
}

async function cmdComplete(args) {
  const id = requireArg(args, "id");
  await updateById(
    id,
    (a) => {
      if (a.status !== "confirmed") throw new Error("not_confirmed");
      a.status = "completed";
      a.completedAt = nowIso();
      return a;
    },
    "complete",
  );
}

function help() {
  print(
    {
      ok: true,
      usage: [
        "propose --channel <imessage|whatsapp|slack> --contact <id> --intent <reminder|todo|follow_up|calendar_candidate> --summary <text> --source-text <text> [--due-at <iso>] [--meta-json '{...}']",
        "list [--status <pending|confirmed|cancelled|completed|all>] [--channel <name>] [--contact <id>] [--limit <n>]",
        "get --id <A-000001>",
        "confirm --id <A-000001>",
        "confirm-latest --channel <name> --contact <id>",
        "cancel --id <A-000001>",
        "complete --id <A-000001>",
      ],
      paths: { actions: ACTIONS_PATH, events: EVENTS_PATH },
    },
    0,
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  try {
    if (!cmd || cmd === "help" || cmd === "--help") return help();
    if (cmd === "propose") return cmdPropose(args);
    if (cmd === "list") return cmdList(args);
    if (cmd === "get") return cmdGet(args);
    if (cmd === "confirm") return cmdConfirm(args);
    if (cmd === "confirm-latest") return cmdConfirmLatest(args);
    if (cmd === "cancel") return cmdCancel(args);
    if (cmd === "complete") return cmdComplete(args);
    throw new Error("unknown_command");
  } catch (err) {
    print({ ok: false, error: String(err?.message || err) }, 1);
  }
}

main();

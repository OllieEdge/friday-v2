#!/usr/bin/env node
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const DATA_DIR = path.join(ROOT, "data", "message-automation");
const STATE_PATH = path.join(DATA_DIR, "bridge-imessage-state.json");
const LOG_PATH = path.join(DATA_DIR, "bridge-imessage.log");

const IMSG = "/Users/ollie/.local/bin/imsg";
const IMSG_DB = "/Users/ollie/Library/Messages/chat.db";
const NODE = "/opt/homebrew/bin/node";
const ACTIONS = "/Users/ollie/workspace/friday-v2/tools/message-automation/actions.mjs";
const OPENCLAW_NODE = "/Users/ollie/.nvm/versions/node/v22.22.0/bin/node";
const OPENCLAW_MAIN = "/Users/ollie/.nvm/versions/node/v22.22.0/lib/node_modules/openclaw/openclaw.mjs";
const ENGLISH_REPLY_PREFIX =
  "Reply in English only. Do not use any non-English language. Keep the response concise and plain text.";

function now() {
  return new Date().toISOString();
}

async function log(level, msg, meta = undefined) {
  const line = JSON.stringify({ ts: now(), level, msg, meta }) + "\n";
  await appendFile(LOG_PATH, line, "utf8");
  if (process.stdout.isTTY) process.stdout.write(line);
}

function run(cmd, args, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ ok: false, code: -1, stdout: out, stderr: `${err}\nTIMEOUT` });
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += String(d)));
    child.stderr.on("data", (d) => (err += String(d)));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout: out, stderr: err });
    });
  });
}

async function ensureData() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await readFile(STATE_PATH, "utf8");
  } catch {
    await writeFile(STATE_PATH, JSON.stringify({ lastSeenId: 0 }, null, 2) + "\n", "utf8");
  }
}

async function loadState() {
  await ensureData();
  const raw = await readFile(STATE_PATH, "utf8");
  return JSON.parse(raw);
}

async function saveState(state) {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

async function maxMessageId() {
  const r = await run("/usr/bin/sqlite3", [IMSG_DB, "select ifnull(max(rowid),0) from message;"]);
  if (!r.ok) return 0;
  const n = Number((r.stdout || "0").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseTextIntent(text) {
  const t = text.trim();
  const low = t.toLowerCase();
  if (!t) return { type: "empty" };
  if (/^yes[.!\s]*$/i.test(t)) return { type: "confirm" };
  if (/^(hi|hey|hello|yo)[!.,\s]*$/i.test(t)) return { type: "greeting" };
  if (/\b(digest|daily digest|message digest|summari[sz]e messages?)\b/i.test(low)) return { type: "digest" };
  if (/\bremind me\b|\bdon't let me forget\b|\bdont let me forget\b/i.test(low)) return { type: "action", intent: "reminder" };
  if (/^todo\b|\bneed to\b|\bi need to\b/i.test(low)) return { type: "action", intent: "todo" };
  if (/\bfollow up\b|\bchase\b/i.test(low)) return { type: "action", intent: "follow_up" };
  return { type: "fallback" };
}

function toIsoMaybe(text) {
  const low = text.toLowerCase();
  const m = low.match(/tomorrow(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  let h = Number(m[1]);
  const min = Number(m[2] || "0");
  const ap = (m[3] || "").toLowerCase();
  if (ap === "pm" && h < 12) h += 12;
  if (ap === "am" && h === 12) h = 0;
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(h, min, 0, 0);
  return d.toISOString();
}

async function actionsCmd(args) {
  const r = await run(NODE, [ACTIONS, ...args], 15000);
  if (!r.ok) throw new Error(`actions_cmd_failed: ${r.stderr || r.stdout}`);
  return JSON.parse((r.stdout || "").trim() || "{}");
}

async function sendIMessage(to, text) {
  const r = await run(IMSG, ["send", "--to", to, "--text", text], 20000);
  if (!r.ok) throw new Error(`imsg_send_failed: ${r.stderr || r.stdout}`);
}

async function runFridayFallback(to, text) {
  const strictMessage = `${ENGLISH_REPLY_PREFIX}\n\nUser message:\n${text}`;
  const r = await run(
    OPENCLAW_NODE,
    [OPENCLAW_MAIN, "agent", "--agent", "friday", "--channel", "imessage", "--to", to, "--message", strictMessage, "--json"],
    60000,
  );
  if (!r.ok) throw new Error(`agent_failed: ${r.stderr || r.stdout}`);
  const payload = JSON.parse(r.stdout || "{}");
  const reply = payload?.result?.payloads?.[0]?.text || "I can help with that. What outcome do you want?";
  return sanitizeEnglishReply(reply);
}

function sanitizeEnglishReply(input) {
  let text = String(input || "");
  text = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  text = text.replace(/\uFFFD/g, "");
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  if (!text) return "I can help with that. Please send the request again.";

  // Reject visible non-Latin scripts in outbound messages for this bridge.
  const nonEnglishScript = /[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0900-\u0DFF\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/;
  if (nonEnglishScript.test(text)) {
    return "I can help with that. Please send your request again and I will reply in English.";
  }

  return text;
}

async function buildReply(msg) {
  const text = String(msg.text || "").trim();
  const sender = String(msg.sender || "").trim();
  const channel = "imessage";
  const parsed = parseTextIntent(text);

  if (parsed.type === "empty") return null;

  if (parsed.type === "confirm") {
    const res = await actionsCmd(["confirm-latest", "--channel", channel, "--contact", sender]);
    const id = res?.action?.id;
    return id ? `Confirmed ${id}.` : "No pending actions to confirm.";
  }

  if (parsed.type === "greeting") {
    return "Hi. I can capture reminders, todos, follow-ups, or a digest.";
  }

  if (parsed.type === "digest") {
    const list = await actionsCmd(["list", "--status", "pending", "--channel", channel, "--contact", sender, "--limit", "5"]);
    const items = list.actions || [];
    if (!items.length) return "No pending actions for this chat.";
    const lines = items.slice(0, 3).map((a) => `- ${a.id}: ${a.summary}`);
    return `Pending actions:\n${lines.join("\n")}`;
  }

  if (parsed.type === "action") {
    const intent = parsed.intent;
    const dueAt = toIsoMaybe(text);
    const summary = text.length > 140 ? `${text.slice(0, 137)}...` : text;
    const args = [
      "propose",
      "--channel",
      channel,
      "--contact",
      sender,
      "--intent",
      intent,
      "--summary",
      summary,
      "--source-text",
      text,
    ];
    if (dueAt) args.push("--due-at", dueAt);
    const res = await actionsCmd(args);
    const id = res?.action?.id;
    return `Proposed action ${id}: ${summary}\nReply YES to confirm.`;
  }

  return runFridayFallback(sender, text);
}

async function processMessage(msg, state) {
  const id = Number(msg.id || 0);
  if (!Number.isFinite(id) || id <= 0) return state;
  if (id <= Number(state.lastSeenId || 0)) return state;
  if (msg.is_from_me) {
    state.lastSeenId = id;
    await saveState(state);
    return state;
  }

  try {
    await log("info", "message_inbound", { id, sender: msg.sender, text: msg.text });
    const reply = await buildReply(msg);
    if (reply && String(reply).trim()) {
      await sendIMessage(String(msg.sender), reply);
      await log("info", "message_reply_sent", { id, sender: msg.sender, reply });
    }
  } catch (err) {
    await log("error", "message_process_failed", { id, err: String(err?.message || err) });
  }

  state.lastSeenId = id;
  await saveState(state);
  return state;
}

async function main() {
  await ensureData();
  let state = await loadState();
  const currentMax = await maxMessageId();
  const lastSeen = Number(state.lastSeenId || 0);
  if (!Number.isFinite(lastSeen) || lastSeen <= 0 || lastSeen > currentMax) {
    state.lastSeenId = currentMax;
    await saveState(state);
    await log("info", "bridge_state_repaired", { previousLastSeenId: lastSeen, repairedLastSeenId: state.lastSeenId });
  }

  await log("info", "bridge_start", { lastSeenId: state.lastSeenId });

  const watcher = spawn(IMSG, ["watch", "--db", IMSG_DB, "--json", "--since-rowid", String(state.lastSeenId)], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  watcher.stderr.on("data", async (d) => {
    await log("warn", "imsg_watch_stderr", { text: String(d).trim() });
  });

  let buffer = "";
  watcher.stdout.on("data", async (d) => {
    buffer += String(d);
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        state = await processMessage(msg, state);
      } catch (err) {
        await log("error", "watch_parse_failed", { line: trimmed.slice(0, 300), err: String(err?.message || err) });
      }
    }
  });

  watcher.on("close", async (code) => {
    await log("error", "bridge_exit", { code });
    process.exit(code || 1);
  });
}

main().catch(async (err) => {
  await log("error", "bridge_fatal", { err: String(err?.message || err) });
  process.exit(1);
});

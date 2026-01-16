const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { envString } = require("../config/env");

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parseEnvFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const vars = {};
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      vars[key] = value;
    }
    return vars;
  } catch {
    return {};
  }
}

function resolveTrelloCredentials() {
  let key = normalizeText(envString("TRELLO_KEY", ""));
  let token = normalizeText(envString("TRELLO_TOKEN", ""));
  let source = "env";

  if (!key || !token) {
    const envPath = normalizeText(envString("FRIDAY_TRELLO_ENV_PATH", "/Users/ollie/workspace/ai/.env"));
    if (envPath) {
      const vars = parseEnvFile(envPath);
      if (!key) key = normalizeText(vars.TRELLO_KEY);
      if (!token) token = normalizeText(vars.TRELLO_TOKEN);
      if (key && token) source = envPath;
    }
  }

  return { key, token, source };
}

function resolveTrelloCliPath() {
  const cliPath = normalizeText(envString("FRIDAY_TRELLO_CLI_PATH", "/Users/ollie/workspace/ai/tools/trello-ai/trello-ai.mjs"));
  return cliPath || "";
}

function extractCardUrl(output) {
  const match = String(output || "").match(/https:\/\/trello\.com\/c\/\S+/);
  return match ? match[0].replace(/\s+$/, "") : "";
}

async function trelloFetch({ path, params, method = "GET", body }) {
  const creds = resolveTrelloCredentials();
  if (!creds.key || !creds.token) {
    return { ok: false, error: "trello_credentials_missing" };
  }

  const url = new URL(`https://api.trello.com/1/${path.replace(/^\/+/, "")}`);
  url.searchParams.set("key", creds.key);
  url.searchParams.set("token", creds.token);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const res = await fetch(url, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    return { ok: false, error: json?.message || text || `HTTP ${res.status}` };
  }
  return { ok: true, data: json };
}

function createTrelloCard({ title, desc, board, list }) {
  const creds = resolveTrelloCredentials();
  if (!creds.key || !creds.token) {
    return Promise.resolve({ ok: false, error: "trello_credentials_missing" });
  }

  const cliPath = resolveTrelloCliPath();
  if (!cliPath || !fs.existsSync(cliPath)) {
    return Promise.resolve({ ok: false, error: "trello_cli_missing", detail: cliPath });
  }

  const args = [
    cliPath,
    "create-card",
    String(title || ""),
    "--board",
    String(board || ""),
    "--list",
    String(list || ""),
    "--template",
    "capture",
    "--desc",
    String(desc || ""),
    "--yes",
  ];

  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      env: { ...process.env, TRELLO_KEY: creds.key, TRELLO_TOKEN: creds.token },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
    });

    child.on("error", (err) => {
      resolve({ ok: false, error: "spawn_failed", message: String(err?.message || err) });
    });

    child.on("close", (code) => {
      const url = extractCardUrl(stdout);
      resolve({ ok: code === 0, exitCode: code, stdout, stderr, url });
    });
  });
}

async function listBoards() {
  return trelloFetch({ path: "members/me/boards", params: { fields: "name,url,shortLink", filter: "open" } });
}

async function listLists(boardId) {
  const id = normalizeText(boardId);
  if (!id) return { ok: false, error: "board_required" };
  return trelloFetch({ path: `boards/${id}/lists`, params: { fields: "name" } });
}

async function searchCards({ boardId, query, limit = 25 }) {
  const q = normalizeText(query);
  if (!q) return { ok: false, error: "query_required" };
  const params = {
    query: q,
    modelTypes: "cards",
    card_fields: "name,url,idList,idBoard",
    cards_limit: Math.max(1, Math.min(50, Number(limit) || 25)),
  };
  if (boardId) params.idBoards = normalizeText(boardId);
  return trelloFetch({ path: "search", params });
}

async function getCard(cardId) {
  const id = normalizeText(cardId);
  if (!id) return { ok: false, error: "card_required" };
  return trelloFetch({ path: `cards/${id}`, params: { fields: "name,url,idBoard,idList,desc" } });
}

async function updateCardDesc(cardId, desc) {
  const id = normalizeText(cardId);
  if (!id) return { ok: false, error: "card_required" };
  return trelloFetch({ path: `cards/${id}`, params: { desc: desc || "" }, method: "PUT" });
}

async function addLabelToCard({ cardId, boardId, name }) {
  const id = normalizeText(cardId);
  if (!id) return { ok: false, error: "card_required" };
  const labelRes = await ensureLabel({ boardId, name });
  if (!labelRes.ok) return labelRes;
  const labelId = labelRes.data?.id;
  if (!labelId) return { ok: false, error: "label_missing" };
  return trelloFetch({ path: `cards/${id}/idLabels`, params: { value: labelId }, method: "POST" });
}

async function ensureLabel({ boardId, name, color = "blue" }) {
  const b = normalizeText(boardId);
  const labelName = normalizeText(name);
  if (!b || !labelName) return { ok: false, error: "label_invalid" };

  const existing = await trelloFetch({ path: `boards/${b}/labels`, params: { fields: "name,color", limit: 1000 } });
  if (!existing.ok) return existing;
  const found = (existing.data || []).find((l) => normalizeText(l?.name).toLowerCase() === labelName.toLowerCase());
  if (found?.id) return { ok: true, data: found };

  return trelloFetch({ path: "labels", params: { name: labelName, color, idBoard: b }, method: "POST" });
}

async function commentOnCard({ cardId, text }) {
  const id = normalizeText(cardId);
  const message = normalizeText(text);
  if (!id) return { ok: false, error: "card_required" };
  if (!message) return { ok: false, error: "comment_required" };
  return trelloFetch({ path: `cards/${id}/actions/comments`, params: { text: message }, method: "POST" });
}

async function listChecklists(cardId) {
  const id = normalizeText(cardId);
  if (!id) return { ok: false, error: "card_required" };
  return trelloFetch({ path: `cards/${id}/checklists` });
}

async function createChecklist(cardId, name) {
  const id = normalizeText(cardId);
  const label = normalizeText(name);
  if (!id || !label) return { ok: false, error: "checklist_invalid" };
  return trelloFetch({ path: `cards/${id}/checklists`, params: { name: label }, method: "POST" });
}

async function addChecklistItem(checklistId, name) {
  const id = normalizeText(checklistId);
  const label = normalizeText(name);
  if (!id || !label) return { ok: false, error: "checkitem_invalid" };
  return trelloFetch({ path: `checklists/${id}/checkItems`, params: { name: label }, method: "POST" });
}

async function setChecklistItemState({ cardId, checkItemId, state }) {
  const cId = normalizeText(cardId);
  const itemId = normalizeText(checkItemId);
  const st = normalizeText(state) || "incomplete";
  if (!cId || !itemId) return { ok: false, error: "checkitem_invalid" };
  return trelloFetch({ path: `cards/${cId}/checkItem/${itemId}`, params: { state: st }, method: "PUT" });
}

async function ensureChecklist({ cardId, name }) {
  const listRes = await listChecklists(cardId);
  if (!listRes.ok) return listRes;
  const existing = (listRes.data || []).find((c) => normalizeText(c?.name).toLowerCase() === normalizeText(name).toLowerCase());
  if (existing?.id) return { ok: true, data: existing };
  return createChecklist(cardId, name);
}

async function ensureChecklistItem({ cardId, checklistId, name }) {
  const listRes = await listChecklists(cardId);
  if (!listRes.ok) return listRes;
  const checklist = (listRes.data || []).find((c) => c?.id === checklistId);
  if (!checklist) return { ok: false, error: "checklist_not_found" };
  const items = checklist.checkItems || [];
  const existing = items.find((i) => normalizeText(i?.name).toLowerCase() === normalizeText(name).toLowerCase());
  if (existing?.id) return { ok: true, data: existing };
  return addChecklistItem(checklistId, name);
}

module.exports = {
  createTrelloCard,
  listBoards,
  listLists,
  searchCards,
  getCard,
  updateCardDesc,
  addLabelToCard,
  commentOnCard,
  listChecklists,
  createChecklist,
  addChecklistItem,
  setChecklistItemState,
  ensureChecklist,
  ensureChecklistItem,
  resolveTrelloCredentials,
};

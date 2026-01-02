const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  const dir = path.dirname(filePath);
  ensureDir(dir);
  const tmp = path.join(dir, `.tmp.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString("hex")}.json`);
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, filePath);
}

function nowIso() {
  return new Date().toISOString();
}

function createStore({ dataDir }) {
  const baseDir = path.resolve(dataDir);
  ensureDir(baseDir);
  const chatsPath = path.join(baseDir, "chats.json");

  function listChats() {
    return readJson(chatsPath, []);
  }

  function getChat(chatId) {
    const chats = listChats();
    return chats.find((c) => c.id === chatId) || null;
  }

  function saveChats(chats) {
    writeJsonAtomic(chatsPath, chats);
  }

  function createChat({ title }) {
    const chats = listChats();
    const id = crypto.randomUUID();
    const chat = {
      id,
      title: title?.trim() || "New chat",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: [],
    };
    chats.unshift(chat);
    saveChats(chats);
    return chat;
  }

  function appendMessage({ chatId, role, content }) {
    const chats = listChats();
    const idx = chats.findIndex((c) => c.id === chatId);
    if (idx === -1) return null;

    const msg = {
      id: crypto.randomUUID(),
      role,
      content: String(content ?? ""),
      createdAt: nowIso(),
    };
    chats[idx].messages.push(msg);
    chats[idx].updatedAt = nowIso();
    saveChats(chats);
    return msg;
  }

  return { listChats, getChat, createChat, appendMessage };
}

module.exports = { createStore };


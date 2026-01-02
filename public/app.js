let state = {
  chats: [],
  activeChatId: null,
  contextVisible: false,
  context: null,
};

const els = {
  chatList: document.getElementById("chatList"),
  chatTitle: document.getElementById("chatTitle"),
  messages: document.getElementById("messages"),
  composer: document.getElementById("composer"),
  composerInput: document.getElementById("composerInput"),
  newChatBtn: document.getElementById("newChatBtn"),
  toggleContextBtn: document.getElementById("toggleContextBtn"),
  contextPanel: document.getElementById("contextPanel"),
  contextBody: document.getElementById("contextBody"),
};

async function api(path, opts) {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...opts,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json;
}

function renderChatList() {
  els.chatList.innerHTML = "";
  for (const chat of state.chats) {
    const div = document.createElement("div");
    div.className = "chatItem" + (chat.id === state.activeChatId ? " active" : "");
    div.addEventListener("click", () => selectChat(chat.id));

    const title = document.createElement("div");
    title.className = "chatItemTitle";
    title.textContent = chat.title || "New chat";

    const meta = document.createElement("div");
    meta.className = "chatItemMeta";
    meta.textContent = new Date(chat.updatedAt || chat.createdAt).toLocaleString();

    div.appendChild(title);
    div.appendChild(meta);
    els.chatList.appendChild(div);
  }
}

function renderMessages(chat) {
  els.messages.innerHTML = "";
  if (!chat) return;
  for (const msg of chat.messages || []) {
    const wrap = document.createElement("div");
    wrap.className = `msg ${msg.role}`;

    const role = document.createElement("div");
    role.className = "msgRole";
    role.textContent = msg.role;

    const content = document.createElement("div");
    content.className = "msgContent";
    content.textContent = msg.content;

    wrap.appendChild(role);
    wrap.appendChild(content);
    els.messages.appendChild(wrap);
  }
  els.messages.scrollTop = els.messages.scrollHeight;
}

function setContextVisible(visible) {
  state.contextVisible = visible;
  els.contextPanel.classList.toggle("hidden", !visible);
}

async function loadContext() {
  const { context } = await api("/api/context");
  state.context = context;
  const text = context.items.map((i) => `# ${i.filename}\n\n${i.content.trim()}\n`).join("\n\n---\n\n");
  els.contextBody.textContent = text;
}

async function refreshChats() {
  const { chats } = await api("/api/chats");
  state.chats = chats;
  renderChatList();
}

async function selectChat(chatId) {
  state.activeChatId = chatId;
  renderChatList();
  const { chat } = await api(`/api/chats/${chatId}`);
  els.chatTitle.textContent = chat.title || "Chat";
  renderMessages(chat);
}

async function createChat() {
  const { chat } = await api("/api/chats", { method: "POST", body: JSON.stringify({}) });
  await refreshChats();
  await selectChat(chat.id);
}

async function sendMessage(content) {
  const chatId = state.activeChatId;
  if (!chatId) return;
  const { messages } = await api(`/api/chats/${chatId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content }),
  });
  const { chat } = await api(`/api/chats/${chatId}`);
  renderMessages(chat);
  await refreshChats();
  return messages;
}

els.newChatBtn.addEventListener("click", () => createChat());

els.toggleContextBtn.addEventListener("click", async () => {
  if (!state.context) await loadContext();
  setContextVisible(!state.contextVisible);
});

els.composer.addEventListener("submit", async (e) => {
  e.preventDefault();
  const content = els.composerInput.value.trim();
  if (!content) return;
  els.composerInput.value = "";
  await sendMessage(content);
});

(async function boot() {
  await refreshChats();
  if (state.chats.length === 0) {
    await createChat();
  } else {
    await selectChat(state.chats[0].id);
  }
})();


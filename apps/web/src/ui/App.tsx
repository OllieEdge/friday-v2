import { Plus, Settings2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Chat, ChatSummary, CodexAccountsResponse, ContextBundle } from "../api/types";
import { AccountsModal } from "./AccountsModal";

type ChatsListResponse = { ok: true; chats: ChatSummary[] };
type ChatResponse = { ok: true; chat: Chat };
type CreateChatResponse = { ok: true; chat: Chat };
type ContextResponse = { ok: true; context: ContextBundle };
type AppendMessagesResponse = { ok: true; messages: Array<{ id: string; role: string; content: string }> };

export function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);

  const [contextVisible, setContextVisible] = useState(false);
  const [context, setContext] = useState<ContextBundle | null>(null);

  const [composer, setComposer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [accounts, setAccounts] = useState<CodexAccountsResponse | null>(null);

  const activeAccountLabel = useMemo(() => {
    if (!accounts?.activeProfileId) return "No active account";
    const profile = accounts.profiles.find((p) => p.id === accounts.activeProfileId);
    return profile ? `Active: ${profile.label}` : "Active: (unknown)";
  }, [accounts]);

  async function refreshChats() {
    const res = await api<ChatsListResponse>("/api/chats");
    setChats(res.chats);
  }

  async function loadChat(chatId: string) {
    setActiveChatId(chatId);
    const res = await api<ChatResponse>(`/api/chats/${chatId}`);
    setActiveChat(res.chat);
  }

  async function createChat() {
    const res = await api<CreateChatResponse>("/api/chats", { method: "POST", body: JSON.stringify({}) });
    await refreshChats();
    await loadChat(res.chat.id);
  }

  async function ensureContext() {
    if (context) return context;
    const res = await api<ContextResponse>("/api/context");
    setContext(res.context);
    return res.context;
  }

  async function refreshAccounts() {
    const res = await api<CodexAccountsResponse>("/api/accounts/codex");
    setAccounts(res);
  }

  async function sendMessage() {
    const chatId = activeChatId;
    const content = composer.trim();
    if (!chatId || !content) return;

    setComposer("");
    await api<AppendMessagesResponse>(`/api/chats/${chatId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });

    await loadChat(chatId);
    await refreshChats();
  }

  useEffect(() => {
    (async () => {
      await refreshChats();
      await refreshAccounts();
    })();
  }, []);

  useEffect(() => {
    if (chats.length === 0) return;
    if (!activeChatId) {
      void loadChat(chats[0].id);
    }
  }, [chats, activeChatId]);

  const contextText = useMemo(() => {
    if (!context) return "";
    return context.items.map((i) => `# ${i.filename}\n\n${i.content.trim()}\n`).join("\n\n---\n\n");
  }, [context]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebarHeader">
          <div className="brand">Friday v2</div>
          <button className="btn" onClick={() => createChat()} title="New chat">
            <Plus size={16} />
            New
          </button>
        </div>
        <div className="chatList">
          {chats.map((c) => (
            <div
              key={c.id}
              className={`chatItem${c.id === activeChatId ? " active" : ""}`}
              onClick={() => loadChat(c.id)}
              role="button"
              tabIndex={0}
            >
              <div className="chatItemTitle">{c.title || "New chat"}</div>
              <div className="chatItemMeta">{new Date(c.updatedAt || c.createdAt).toLocaleString()}</div>
            </div>
          ))}
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbarLeft">
            <div className="chatTitle">{activeChat?.title || "Select a chat"}</div>
            <div className="activeAccount">{activeAccountLabel}</div>
          </div>
          <div className="topbarRight">
            <button
              className="btn secondary"
              onClick={async () => {
                await ensureContext();
                setContextVisible((v) => !v);
              }}
            >
              Context
            </button>
            <button className="btn iconBtn" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        <section className={`contextPanel${contextVisible ? "" : " hidden"}`}>
          <div className="contextHeader">Loaded context</div>
          <pre className="contextBody">{contextText}</pre>
        </section>

        <section className="messages">
          {(activeChat?.messages || []).map((m) => (
            <div key={m.id} className={`msg ${m.role}`}>
              <div className="msgRole">{m.role}</div>
              <div className="msgContent">{m.content}</div>
            </div>
          ))}
        </section>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            void sendMessage();
          }}
        >
          <textarea
            className="textarea"
            rows={3}
            placeholder="Message Friday…"
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
          />
          <button className="btn primary" type="submit">
            Send
          </button>
        </form>
      </main>

      {settingsOpen ? (
        <AccountsModal
          onClose={() => setSettingsOpen(false)}
          accounts={accounts}
          refreshAccounts={refreshAccounts}
        />
      ) : null}
    </div>
  );
}


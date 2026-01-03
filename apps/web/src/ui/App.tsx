import { Menu, Plus, Settings2, X } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Chat, ChatSummary, CodexAccountsResponse, ContextBundle, ContextMetrics, Message } from "../api/types";
import { SettingsPage } from "./SettingsPage";

type ChatsListResponse = { ok: true; chats: ChatSummary[] };
type ChatResponse = { ok: true; chat: Chat };
type CreateChatResponse = { ok: true; chat: Chat };
type ContextResponse = { ok: true; context: ContextBundle };
type ContextMetricsResponse = { ok: true; metrics: ContextMetrics };
type AppendMessagesResponse = { ok: true; messages: Array<{ id: string; role: string; content: string }> };
type StartStreamResponse = { ok: true; taskId: string; userMessage: Message };

export function App() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [contextVisible, setContextVisible] = useState(false);
  const [context, setContext] = useState<ContextBundle | null>(null);
  const [contextMetrics, setContextMetrics] = useState<ContextMetrics | null>(null);

  const [composer, setComposer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [accounts, setAccounts] = useState<CodexAccountsResponse | null>(null);
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [runLogs, setRunLogs] = useState<any[]>([]);
  const [sending, setSending] = useState(false);

  const activeAccountLabel = useMemo(() => {
    if (!accounts?.activeProfileId) return "No active account";
    const profile = accounts.profiles.find((p) => p.id === accounts.activeProfileId);
    return profile ? `Active: ${profile.label}` : "Active: (unknown)";
  }, [accounts]);

  const activeUsageLabel = useMemo(() => {
    if (!accounts?.activeProfileId) return "";
    const p = accounts.profiles.find((x) => x.id === accounts.activeProfileId);
    if (!p) return "";
    if (p.authMode !== "api_key") return "";
    const cost = Number(p.totalCostUsd || 0);
    const tokens = (Number(p.totalInputTokens) || 0) + (Number(p.totalCachedInputTokens) || 0) + (Number(p.totalOutputTokens) || 0);
    const costPart = cost > 0 ? ` · $${cost.toFixed(2)}` : "";
    return `Metered: ${tokens.toLocaleString()} tokens${costPart}`;
  }, [accounts]);

  async function refreshChats() {
    const res = await api<ChatsListResponse>("/api/chats");
    setChats(res.chats);
  }

  async function loadChat(chatId: string) {
    setActiveChatId(chatId);
    const res = await api<ChatResponse>(`/api/chats/${chatId}`);
    setActiveChat(res.chat);
    setSidebarOpen(false);
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

  async function refreshContextMetrics() {
    const res = await api<ContextMetricsResponse>("/api/context/metrics");
    setContextMetrics(res.metrics);
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
    setSending(true);
    setRunStatus("Starting…");
    setRunLogs([]);

    const optimisticUser: Message = { id: `tmp-user-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    const optimisticAssistant: Message = {
      id: `tmp-assistant-${Date.now()}`,
      role: "assistant",
      content: "Thinking…",
      createdAt: new Date().toISOString(),
    };
    setActiveChat((prev) => (prev ? { ...prev, messages: [...prev.messages, optimisticUser, optimisticAssistant] } : prev));

    try {
      const started = await api<StartStreamResponse>(`/api/chats/${chatId}/messages/stream`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });

      // Replace optimistic user message with the persisted one (keep "thinking" placeholder).
      setActiveChat((prev) => {
        if (!prev) return prev;
        const msgs = [...prev.messages];
        const idx = msgs.findIndex((m) => m.id === optimisticUser.id);
        if (idx !== -1) msgs[idx] = started.userMessage;
        return { ...prev, messages: msgs };
      });

      const es = new EventSource(`/api/tasks/${started.taskId}/events`);
      es.addEventListener("message", (e) => {
        const ev = JSON.parse((e as MessageEvent).data);
        if (ev?.type === "status") setRunStatus(String(ev.stage || ""));
        else if (ev?.type === "codex") setRunLogs((prev) => [...prev, ev.event]);
        else if (ev?.type === "usage") void refreshAccounts();
        else if (ev?.type === "assistant_message") {
          setActiveChat((prev) => {
            if (!prev) return prev;
            const msgs = [...prev.messages];
            const idx = msgs.findIndex((m) => m.id === optimisticAssistant.id);
            if (idx !== -1) msgs[idx] = ev.message;
            else msgs.push(ev.message);
            return { ...prev, messages: msgs };
          });
        } else if (ev?.type === "done" || ev?.type === "canceled") {
          es.close();
          setSending(false);
          setRunStatus(null);
          setRunLogs([]);
          void refreshChats();
        }
      });
      es.addEventListener("error", () => {
        // server will close it on completion; keep UI as-is
      });
    } catch (e: any) {
      setSending(false);
      setRunStatus(null);
      setActiveChat((prev) => {
        if (!prev) return prev;
        const msgs = [...prev.messages];
        const idx = msgs.findIndex((m) => m.id === optimisticAssistant.id);
        const errMsg = { ...optimisticAssistant, content: `Error: ${String(e?.message || e)}` };
        if (idx !== -1) msgs[idx] = errMsg;
        else msgs.push(errMsg);
        return { ...prev, messages: msgs };
      });
    }
  }

  useEffect(() => {
    (async () => {
      await refreshChats();
      await refreshAccounts();
      await refreshContextMetrics();
    })();
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const settings = url.searchParams.get("settings");
    if (settings === "accounts" || settings === "settings") {
      setSettingsOpen(true);
      url.searchParams.delete("settings");
      url.searchParams.delete("google");
      url.searchParams.delete("key");
      window.history.replaceState({}, "", url.toString());
    }
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
    <div className={`app${sidebarOpen ? " sidebarOpen" : ""}`}>
      {sidebarOpen ? <button className="sidebarBackdrop" onClick={() => setSidebarOpen(false)} /> : null}
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
            <div className="topbarTitleRow">
              <button className="btn iconBtn mobileOnly" onClick={() => setSidebarOpen((v) => !v)} title="Chats">
                {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <div className="chatTitle">{activeChat?.title || "Select a chat"}</div>
            </div>
            <div className="activeAccount">
              {activeAccountLabel}
              {contextMetrics ? ` · Context ~${contextMetrics.approxTokens.toLocaleString()} tokens` : ""}
              {activeUsageLabel ? ` · ${activeUsageLabel}` : ""}
            </div>
          </div>
          <div className="topbarRight">
            <button
              className="btn secondary"
              onClick={async () => {
                await ensureContext();
                await refreshContextMetrics();
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

        {sending || runStatus || runLogs.length ? (
          <section className="runPanel">
            <div className="runHeader">
              <div style={{ fontWeight: 700 }}>Run</div>
              <div className="muted">{runStatus || (sending ? "Running…" : "")}</div>
            </div>
            {runLogs.length ? (
              <details>
                <summary className="muted">Details</summary>
                <pre className="pre">{runLogs.slice(-200).map((l) => JSON.stringify(l)).join("\n")}</pre>
              </details>
            ) : null}
          </section>
        ) : null}

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
            disabled={sending}
          />
          <button className="btn primary" type="submit">
            Send
          </button>
        </form>
      </main>

      {settingsOpen ? (
        <SettingsPage
          onClose={() => setSettingsOpen(false)}
          accounts={accounts}
          refreshAccounts={refreshAccounts}
          contextMetrics={contextMetrics}
        />
      ) : null}
    </div>
  );
}

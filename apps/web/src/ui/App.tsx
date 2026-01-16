import { LayoutList, ListTodo, Menu, MessageSquare, Plus, Settings2, X } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type {
  AuthStatusResponse,
  Chat,
  ChatSummary,
  CodexAccountsResponse,
  ContextBundle,
  ContextMetrics,
  Message,
  RunnerSettingsResponse,
} from "../api/types";
import { AuthOverlay } from "./AuthOverlay";
import { MessageBubble } from "./MessageBubble";
import { SettingsPage } from "./SettingsPage";
import { TriagePage } from "./TriagePage";
import { PmWorkspace } from "./pm/PmWorkspace";

type ChatsListResponse = { ok: true; chats: ChatSummary[] };
type ChatResponse = { ok: true; chat: Chat };
type CreateChatResponse = { ok: true; chat: Chat };
type ContextResponse = { ok: true; context: ContextBundle };
type ContextMetricsResponse = { ok: true; metrics: ContextMetrics };
type AppendMessagesResponse = { ok: true; messages: Array<{ id: string; role: string; content: string }> };
type StartStreamResponse = { ok: true; taskId: string; userMessage: Message; assistantMessage: Message };

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [view, setView] = useState<"chat" | "triage" | "pm">("chat");

  const [contextVisible, setContextVisible] = useState(false);
  const [context, setContext] = useState<ContextBundle | null>(null);
  const [contextMetrics, setContextMetrics] = useState<ContextMetrics | null>(null);

  const [composer, setComposer] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [accounts, setAccounts] = useState<CodexAccountsResponse | null>(null);
  const [runnerSettings, setRunnerSettings] = useState<RunnerSettingsResponse | null>(null);
  const [sending, setSending] = useState(false);
  const taskStreamsRef = useRef<Map<string, EventSource>>(new Map());
  const seenEventsRef = useRef<Map<string, Set<string>>>(new Map());
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastChatIdRef = useRef<string | null>(null);

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
    const estimatedCost = Number(p.estimatedTotalCostUsd || 0);
    const tokens = (Number(p.totalInputTokens) || 0) + (Number(p.totalCachedInputTokens) || 0) + (Number(p.totalOutputTokens) || 0);
    const costPart = cost > 0 ? ` · $${cost.toFixed(2)}` : estimatedCost > 0 ? ` · ~$${estimatedCost.toFixed(2)}` : "";
    return `Metered: ${tokens.toLocaleString()} tokens${costPart}`;
  }, [accounts]);

  const chatHasRunningTask = useMemo(() => {
    return Boolean(activeChat?.messages?.some((m) => m.role === "assistant" && m.meta?.run?.status === "running" && m.meta?.run?.taskId));
  }, [activeChat]);

  const busy = sending || chatHasRunningTask;

  async function refreshAuthStatus() {
    const res = await api<AuthStatusResponse>("/api/auth/status");
    setAuthStatus(res);
    return res;
  }

  function handleUnauthorized() {
    setAuthStatus((prev) => (prev ? { ...prev, authenticated: false, user: null } : { ok: true, authenticated: false, hasAnyUsers: true, user: null }));
    setActiveChat(null);
    setActiveChatId(null);
    setChats([]);
    setSettingsOpen(false);
  }

  async function refreshChats() {
    try {
      const res = await api<ChatsListResponse>("/api/chats");
      setChats(res.chats);
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
    }
  }

  async function loadChat(chatId: string) {
    setView("chat");
    setActiveChatId(chatId);
    try {
      const res = await api<ChatResponse>(`/api/chats/${chatId}`);
      setActiveChat(res.chat);
      setSidebarOpen(false);
      await refreshChats();
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
    }
  }

  async function createChat() {
    try {
      const res = await api<CreateChatResponse>("/api/chats", { method: "POST", body: JSON.stringify({}) });
      await refreshChats();
      await loadChat(res.chat.id);
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
    }
  }

  async function ensureContext() {
    if (context) return context;
    try {
      const res = await api<ContextResponse>("/api/context");
      setContext(res.context);
      return res.context;
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
      throw e;
    }
  }

  async function refreshContextMetrics() {
    try {
      const res = await api<ContextMetricsResponse>("/api/context/metrics");
      setContextMetrics(res.metrics);
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
    }
  }

  async function refreshAccounts() {
    try {
      const res = await api<CodexAccountsResponse>("/api/accounts/codex");
      setAccounts(res);
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
    }
  }

  async function refreshRunnerSettings() {
    try {
      const res = await api<RunnerSettingsResponse>("/api/settings/runner");
      setRunnerSettings(res);
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) handleUnauthorized();
    }
  }

  function closeTaskStream(taskId: string) {
    const es = taskStreamsRef.current.get(taskId);
    if (es) es.close();
    taskStreamsRef.current.delete(taskId);
    seenEventsRef.current.delete(taskId);
  }

  function scrollMessagesToBottom(force = false) {
    const el = messagesRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (!force && distance > 120) return;
    el.scrollTop = el.scrollHeight;
  }

  function appendTaskEvent({ taskId, messageId, event }: { taskId: string; messageId: string; event: any }) {
    const t = String(event?.type || "");
    if (t === "user_message" || t === "assistant_placeholder" || t === "assistant_message") return;

    const key = JSON.stringify(event ?? {});
    const seen = seenEventsRef.current.get(taskId) || new Set<string>();
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > 900) {
      // prevent unbounded growth; replay duplication is acceptable if it ever happens again.
      seen.clear();
    }
    seenEventsRef.current.set(taskId, seen);

    setActiveChat((prev) => {
      if (!prev) return prev;
      const msgs = [...prev.messages];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx === -1) return prev;
      const existing = msgs[idx];
      const nextEvents = [...(existing.events ?? []), event];
      msgs[idx] = { ...existing, events: nextEvents };
      return { ...prev, messages: msgs };
    });
  }

  function upsertMessage({ messageId, next }: { messageId: string; next: Message }) {
    setActiveChat((prev) => {
      if (!prev) return prev;
      const msgs = [...prev.messages];
      const idx = msgs.findIndex((m) => m.id === messageId);
      if (idx !== -1) {
        const existing = msgs[idx];
        msgs[idx] = { ...existing, ...next, events: existing.events ?? next.events ?? [] };
        return { ...prev, messages: msgs };
      }
      msgs.push(next);
      return { ...prev, messages: msgs };
    });
  }

  async function attachTaskStream({ taskId, messageId }: { taskId: string; messageId: string }) {
    if (!taskId || !messageId) return;
    if (taskStreamsRef.current.has(taskId)) return;

    // Seed de-duplication with any existing persisted events.
    const seeded = new Set<string>();
    const existing = activeChat?.messages?.find((m) => m.id === messageId);
    for (const ev of existing?.events || []) seeded.add(JSON.stringify(ev ?? {}));
    seenEventsRef.current.set(taskId, seeded);

    try {
      await api<{ ok: true; task: { id: string; status: string } }>(`/api/tasks/${taskId}`);
    } catch {
      appendTaskEvent({ taskId, messageId, event: { type: "status", stage: "disconnected" } });
      return;
    }

    const es = new EventSource(`/api/tasks/${taskId}/events`);
    taskStreamsRef.current.set(taskId, es);

    es.addEventListener("message", (e) => {
      const ev = JSON.parse((e as MessageEvent).data);
      if (ev?.type === "assistant_message") {
        upsertMessage({ messageId, next: ev.message });
        return;
      }
      if (ev?.type === "usage") void refreshAccounts();
      appendTaskEvent({ taskId, messageId, event: ev });
      if (ev?.type === "done" || ev?.type === "canceled") {
        closeTaskStream(taskId);
        setSending(false);
        void refreshChats();
      }
    });

    es.addEventListener("error", () => {
      // server closes it on completion; UI will recover on next chat refresh if needed.
    });
  }

  async function sendMessage() {
    const chatId = activeChatId;
    const content = composer.trim();
    if (!chatId || !content) return;
    if (busy) return;

    setComposer("");
    setSending(true);

    const optimisticUser: Message = { id: `tmp-user-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    const optimisticAssistant: Message = {
      id: `tmp-assistant-${Date.now()}`,
      role: "assistant",
      content: "Thinking…",
      createdAt: new Date().toISOString(),
      events: [],
    };
    setActiveChat((prev) => (prev ? { ...prev, messages: [...prev.messages, optimisticUser, optimisticAssistant] } : prev));

    try {
      const started = await api<StartStreamResponse>(`/api/chats/${chatId}/messages/stream`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });

      // Replace optimistic messages with persisted ones.
      const assistantId = started.assistantMessage?.id;
      setActiveChat((prev) => {
        if (!prev) return prev;
        const msgs = [...prev.messages];
        const idx = msgs.findIndex((m) => m.id === optimisticUser.id);
        if (idx !== -1) msgs[idx] = started.userMessage;
        const aIdx = msgs.findIndex((m) => m.id === optimisticAssistant.id);
        if (aIdx !== -1) msgs[aIdx] = { ...started.assistantMessage, events: started.assistantMessage.events ?? [] };
        return { ...prev, messages: msgs };
      });

      if (assistantId) await attachTaskStream({ taskId: started.taskId, messageId: assistantId });
    } catch (e: any) {
      if (String(e?.message || "").includes("unauthorized")) {
        handleUnauthorized();
        return;
      }
      setSending(false);
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
      const st = await refreshAuthStatus();
      if (!st.authenticated && st.hasAnyUsers) return;
      if (!st.authenticated && !st.hasAnyUsers) return;
      await refreshChats();
      await refreshAccounts();
      await refreshRunnerSettings();
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

  useEffect(() => {
    // Close any in-flight streams when switching chats.
    for (const taskId of taskStreamsRef.current.keys()) {
      closeTaskStream(taskId);
    }
  }, [activeChatId]);

  useEffect(() => {
    const running = (activeChat?.messages || [])
      .filter((m) => m.role === "assistant" && m.meta?.run?.status === "running" && m.meta?.run?.taskId)
      .map((m) => ({ taskId: m.meta!.run!.taskId, messageId: m.id }));

    if (!running.length) return;
    for (const r of running) void attachTaskStream(r);
  }, [activeChat]);

  useEffect(() => {
    if (!activeChatId) return;
    if (lastChatIdRef.current !== activeChatId) {
      lastChatIdRef.current = activeChatId;
      requestAnimationFrame(() => scrollMessagesToBottom(true));
    }
  }, [activeChatId]);

  useEffect(() => {
    if (!activeChatId) return;
    requestAnimationFrame(() => scrollMessagesToBottom(false));
  }, [activeChatId, activeChat?.messages?.length]);

  const contextText = useMemo(() => {
    if (!context) return "";
    return context.items.map((i) => `# ${i.filename}\n\n${i.content.trim()}\n`).join("\n\n---\n\n");
  }, [context]);

  const runnerMeta = useMemo(() => {
    if (!runnerSettings) return "";
    const runner = runnerSettings.effective?.runner || runnerSettings.prefs.runner || "unknown";
    const parts: string[] = [`Runner: ${runner}`];
    if (runner === "vertex") {
      const model = runnerSettings.prefs.vertex.model || "default";
      const location = runnerSettings.prefs.vertex.location || "";
      parts.push(`Model: ${model}`);
      if (location) parts.push(`Location: ${location}`);
      const contextWindow = model === "gemini-2.5-pro" ? 1048576 : 0;
      if (contextWindow) parts.push(`Context window: ${contextWindow.toLocaleString()}`);
      const hasToolExec = Boolean(runnerSettings.caps?.vertexToolExec);
      const hasCodeExec = Boolean(runnerSettings.caps?.vertexCodeExecution);
      if (hasToolExec && hasCodeExec) parts.push("Tools: exec + code-exec");
      else if (hasToolExec) parts.push("Tools: exec");
      else if (hasCodeExec) parts.push("Tools: code-exec");
      else parts.push("Tools: text-only");
    } else if (runner === "openai" || runner === "api" || runner === "metered") {
      const model = runnerSettings.prefs.openai.model || "";
      if (model) parts.push(`Model: ${model}`);
      parts.push("Tools: text-only");
    } else if (runner === "codex") {
      parts.push("Tools: enabled");
    }
    return parts.join(" · ");
  }, [runnerSettings]);

  const lastUsage = useMemo(() => {
    const msgs = activeChat?.messages || [];
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const msg = msgs[i];
      if (msg?.role !== "assistant") continue;
      const events = Array.isArray(msg.events) ? msg.events : [];
      for (let j = events.length - 1; j >= 0; j -= 1) {
        const ev = events[j];
        if (ev?.type === "usage" && ev?.usage) return ev.usage;
      }
    }
    return null;
  }, [activeChat]);

  const usageMeta = useMemo(() => {
    if (!lastUsage) return "";
    const inTok = Number(lastUsage.inputTokens) || 0;
    const cachedTok = Number(lastUsage.cachedInputTokens) || 0;
    const outTok = Number(lastUsage.outputTokens) || 0;
    if (!inTok && !cachedTok && !outTok) return "";
    const parts = [`Last run: in ${inTok.toLocaleString()}`];
    if (cachedTok) parts.push(`cached ${cachedTok.toLocaleString()}`);
    parts.push(`out ${outTok.toLocaleString()}`);
    return parts.join(" · ");
  }, [lastUsage]);

  return (
    <div className={`app${sidebarOpen ? " sidebarOpen" : ""}${view === "triage" || view === "pm" ? " triageMode" : ""}`}>
      {authStatus && !authStatus.authenticated ? (
        <AuthOverlay
          status={authStatus}
          onAuthed={async () => {
            const st = await refreshAuthStatus();
            if (st.authenticated) {
              await refreshChats();
              await refreshAccounts();
              await refreshContextMetrics();
            }
          }}
        />
      ) : null}
      {sidebarOpen ? <button className="sidebarBackdrop" onClick={() => setSidebarOpen(false)} /> : null}
      {view === "chat" ? (
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
      ) : null}

      <main className="main">
        <header className="topbar">
          <div className="topbarLeft">
            <div className="topbarTitleRow">
              {view === "chat" ? (
                <button className="btn iconBtn mobileOnly" onClick={() => setSidebarOpen((v) => !v)} title="Chats">
                  {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
                </button>
              ) : null}
              <div className="chatTitle">{view === "triage" ? "Triage" : view === "pm" ? "PM" : activeChat?.title || "Select a chat"}</div>
            </div>
            <div className="activeAccount">
              {activeAccountLabel}
              {contextMetrics ? ` · Context ~${contextMetrics.approxTokens.toLocaleString()} tokens` : ""}
              {activeUsageLabel ? ` · ${activeUsageLabel}` : ""}
            </div>
            {view === "chat" && (runnerMeta || usageMeta) ? (
              <div className="chatMeta">
                {runnerMeta}
                {usageMeta ? ` · ${usageMeta}` : ""}
              </div>
            ) : null}
          </div>
          <div className="topbarRight">
            {view === "triage" || view === "pm" ? (
              <button className="btn secondary" onClick={() => setView("chat")} title="Chats">
                <MessageSquare size={16} />
                Chats
              </button>
            ) : null}
            <button
              className={`btn${view === "triage" ? " secondary" : ""}`}
              onClick={() => {
                setSidebarOpen(false);
                setView("triage");
              }}
              title="Triage"
            >
              <LayoutList size={16} />
              Triage
            </button>
            <button
              className={`btn${view === "pm" ? " secondary" : ""}`}
              onClick={() => {
                setSidebarOpen(false);
                setView("pm");
              }}
              title="PM"
            >
              <ListTodo size={16} />
              PM
            </button>
            {view === "chat" ? (
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
            ) : null}
            <button className="btn iconBtn" onClick={() => setSettingsOpen(true)} title="Settings">
              <Settings2 size={18} />
            </button>
          </div>
        </header>

        {view === "chat" ? (
          <>
            <section className={`contextPanel${contextVisible ? "" : " hidden"}`}>
              <div className="contextHeader">Loaded context</div>
              <pre className="contextBody">{contextText}</pre>
            </section>

            <section className="messages" ref={messagesRef}>
              {(activeChat?.messages || []).map((m) => (
                <MessageBubble key={m.id} message={m} />
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
                disabled={busy}
              />
              <button className="btn primary" type="submit" disabled={busy}>
                Send
              </button>
            </form>
          </>
        ) : view === "triage" ? (
          <section className="triageMain">
            <TriagePage onOpenChat={(chatId) => loadChat(chatId)} />
          </section>
        ) : (
          <section className="triageMain">
            <PmWorkspace />
          </section>
        )}
      </main>

      {settingsOpen ? (
        <SettingsPage
          onClose={() => setSettingsOpen(false)}
          onLoggedOut={async () => {
            await refreshAuthStatus();
            handleUnauthorized();
          }}
          accounts={accounts}
          refreshAccounts={refreshAccounts}
          contextMetrics={contextMetrics}
        />
      ) : null}
    </div>
  );
}

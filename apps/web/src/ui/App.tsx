import { ActivitySquare, LayoutList, Menu, MessageSquare, Plus, Settings2, Workflow, X } from "lucide-react";
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
  MicrosoftAccountsResponse,
} from "../api/types";
import { AuthOverlay } from "./AuthOverlay";
import { MessageBubble } from "./MessageBubble";
import { SettingsPage } from "./SettingsPage";
import { TriagePage } from "./TriagePage";
import { OpsPage } from "./OpsPage";
import { FlowBuilderPage } from "./FlowBuilderPage";

type ChatsListResponse = { ok: true; chats: ChatSummary[] };
type ChatResponse = { ok: true; chat: Chat };
type CreateChatResponse = { ok: true; chat: Chat };
type ContextResponse = { ok: true; context: ContextBundle };
type ContextMetricsResponse = { ok: true; metrics: ContextMetrics };
type AppendMessagesResponse = { ok: true; messages: Array<{ id: string; role: string; content: string }> };
type StartStreamResponse = { ok: true; taskId: string; userMessage: Message; assistantMessage: Message };
type MicrosoftPreflightResponse = {
  ok: true;
  preflight: {
    generatedAt: string;
    node: { ok: boolean; version: string; stderr: string; path: string };
    tool: { exists: boolean; path: string };
    accounts: Array<{ accountKey: string; label: string; kind: string; email: string; scopes: string; updatedAt: string }>;
    probes: Array<{ accountKey: string; ok: boolean; code: number | null; stderr: string; profile: { id: string; displayName: string; mail: string } | null }>;
  };
};

export function App() {
  const [authStatus, setAuthStatus] = useState<AuthStatusResponse | null>(null);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<Chat | null>(null);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [view, setView] = useState<"chat" | "triage" | "ops" | "flows" | "settings">("ops");

  const [contextVisible, setContextVisible] = useState(false);
  const [context, setContext] = useState<ContextBundle | null>(null);
  const [contextMetrics, setContextMetrics] = useState<ContextMetrics | null>(null);

  const [composer, setComposer] = useState("");

  const [accounts, setAccounts] = useState<CodexAccountsResponse | null>(null);
  const [sending, setSending] = useState(false);
  const taskStreamsRef = useRef<Map<string, EventSource>>(new Map());
  const seenEventsRef = useRef<Map<string, Set<string>>>(new Map());
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const lastChatIdRef = useRef<string | null>(null);

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
    setSidebarOpen(false);
    setMobileMenuOpen(false);
    setViewAndRoute("ops");
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
    setViewAndRoute("chat");
    setActiveChatId(chatId);
    try {
      const res = await api<ChatResponse>(`/api/chats/${chatId}`);
      setActiveChat(res.chat);
      setSidebarOpen(false);
      setMobileMenuOpen(false);
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
    const lane = /microsoft\s+ops/i.test(String(activeChat?.title || "")) ? "ops" : "";

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
        body: JSON.stringify(lane ? { content, lane } : { content }),
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

  function buildMicrosoftOpsPrompt(accountKey: string, preflight?: MicrosoftPreflightResponse["preflight"] | null) {
    const lines = [];
    if (preflight) {
      lines.push("Preflight (authoritative):");
      lines.push(`- node: ${preflight.node.ok ? "ok" : "fail"} ${preflight.node.version || ""}`.trim());
      lines.push(`- nodePath: ${preflight.node.path}`);
      lines.push(`- toolExists: ${preflight.tool.exists ? "yes" : "no"} (${preflight.tool.path})`);
      const probe = (preflight.probes || []).find((p) => String(p.accountKey || "") === accountKey);
      if (probe) {
        lines.push(`- graphMeProbe(${accountKey}): ${probe.ok ? "ok" : "fail"}${probe.profile?.mail ? ` (${probe.profile.mail})` : ""}`);
        if (!probe.ok && probe.stderr) lines.push(`- graphMeProbeErr: ${probe.stderr}`);
      }
      lines.push("If command execution is unavailable, cite the exact failed preflight line above.");
      lines.push("");
    }

    return [
      ...lines,
      `Use Microsoft account \`${accountKey}\`.`,
      "",
      "Task mode: Microsoft Ops (ad-hoc, discover-first).",
      "1. Discover API/tool options first using available tools/http requests.",
      "2. Run read-only checks before proposing any write action.",
      "3. If write is possible, show exact request and wait for explicit approval.",
      "4. If no API exists, provide exact manual click path and a draft message.",
      "5. Keep output concise and action-focused.",
      "6. Do not claim shell/path failures unless you have concrete command output from this run or preflight evidence.",
      "",
      "Current task: investigate how to adjust Microsoft Family settings for app/site controls and report the safest executable path.",
    ].join("\n");
  }

  async function startMicrosoftOpsChat() {
    let preflight: MicrosoftPreflightResponse["preflight"] | null = null;
    try {
      const pf = await api<MicrosoftPreflightResponse>("/api/ops/microsoft/preflight");
      preflight = pf.preflight || null;
    } catch {
      preflight = null;
    }

    const ms = await api<MicrosoftAccountsResponse>("/api/accounts/microsoft");
    const connected = (ms.accounts || []).filter((a) => a.connected);
    if (!connected.length) {
      setViewAndRoute("settings");
      throw new Error("No connected Microsoft account. Connect one in Settings -> Accounts -> Microsoft.");
    }
    const chosen = connected.find((a) => String(a.accountKey || "") === "esbokid") || connected[0];
    const accountKey = String(chosen.accountKey || "").trim();
    if (!accountKey) throw new Error("Connected Microsoft account key is missing.");

    const created = await api<CreateChatResponse>("/api/chats", {
      method: "POST",
      body: JSON.stringify({ title: `Microsoft Ops (${accountKey})` }),
    });
    const chatId = created.chat.id;
    const prompt = buildMicrosoftOpsPrompt(accountKey, preflight);
    const started = await api<StartStreamResponse>(`/api/chats/${chatId}/messages/stream`, {
      method: "POST",
      body: JSON.stringify({ content: prompt, lane: "ops" }),
    });
    await loadChat(chatId);
    if (started.assistantMessage?.id) {
      await attachTaskStream({ taskId: started.taskId, messageId: started.assistantMessage.id });
    }
  }

  useEffect(() => {
    (async () => {
      const st = await refreshAuthStatus();
      if (!st.authenticated && st.hasAnyUsers) return;
      if (!st.authenticated && !st.hasAnyUsers) return;
      await refreshChats();
      await refreshAccounts();
      await refreshContextMetrics();
    })();
  }, []);

  function viewFromPath(path: string) {
    if (!path || path === "/") return "ops";
    if (path.startsWith("/triage")) return "triage";
    if (path.startsWith("/ops")) return "ops";
    if (path.startsWith("/flows")) return "flows";
    if (path.startsWith("/pm")) return "settings";
    if (path.startsWith("/contacts")) return "settings";
    if (path.startsWith("/settings")) return "settings";
    if (path.startsWith("/chats")) return "chat";
    return "ops";
  }

  function pathForView(nextView: typeof view) {
    if (nextView === "triage") return "/triage";
    if (nextView === "ops") return "/ops";
    if (nextView === "flows") return "/flows";
    if (nextView === "settings") return "/settings";
    return "/chats";
  }

  function setViewAndRoute(nextView: typeof view) {
    setView(nextView);
    const path = pathForView(nextView);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
  }

  function goToView(nextView: typeof view) {
    setSidebarOpen(false);
    setMobileMenuOpen(false);
    setViewAndRoute(nextView);
  }

  useEffect(() => {
    const sync = () => {
      const path = window.location.pathname || "/";
      if (path === "/") {
        window.history.replaceState({}, "", "/ops");
        setView("ops");
        return;
      }
      setView(viewFromPath(path));
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    if (view !== "chat") return;
    if (chats.length === 0) return;
    if (!activeChatId) {
      void loadChat(chats[0].id);
    }
  }, [chats, activeChatId, view]);

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

  const viewTitle =
    view === "triage"
      ? "Triage"
      : view === "ops"
        ? "Ops"
        : view === "flows"
          ? "Flows"
        : view === "settings"
          ? "Settings"
          : activeChat?.title || "Select a chat";

  return (
    <div
      className={`app${sidebarOpen ? " sidebarOpen" : ""}${view === "triage" || view === "ops" || view === "flows" || view === "settings" ? " triageMode" : ""}`}
    >
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
              <button className="btn iconBtn mobileOnly" onClick={() => setMobileMenuOpen((v) => !v)} title="Menu">
                {mobileMenuOpen ? <X size={18} /> : <Menu size={18} />}
              </button>
              <div className="chatTitle">{viewTitle}</div>
            </div>
          </div>
          <div className="topbarRight">
            <button
              className={`btn${view === "ops" ? " secondary" : ""}`}
              onClick={() => {
                goToView("ops");
              }}
              title="Ops"
            >
              <ActivitySquare size={16} />
              Ops
            </button>
            <button
              className={`btn${view === "triage" ? " secondary" : ""}`}
              onClick={() => {
                goToView("triage");
              }}
              title="Triage"
            >
              <LayoutList size={16} />
              Triage
            </button>
            <button
              className={`btn${view === "flows" ? " secondary" : ""}`}
              onClick={() => {
                goToView("flows");
              }}
              title="Flows"
            >
              <Workflow size={16} />
              Flows
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
            <button className={`btn${view === "chat" ? " secondary" : ""}`} onClick={() => goToView("chat")} title="Chats">
              <MessageSquare size={16} />
              Chats
            </button>
            <button className={`btn${view === "settings" ? " secondary" : ""}`} onClick={() => goToView("settings")} title="Settings">
              <Settings2 size={16} />
              Settings
            </button>
          </div>
        </header>

        {mobileMenuOpen ? (
          <>
            <button className="mobileMenuBackdrop" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu" />
            <nav className="mobileMenuPanel" aria-label="Main">
              <button className={`btn${view === "ops" ? " secondary" : ""}`} onClick={() => goToView("ops")}>
                <ActivitySquare size={16} />
                Ops
              </button>
              <button className={`btn${view === "triage" ? " secondary" : ""}`} onClick={() => goToView("triage")}>
                <LayoutList size={16} />
                Triage
              </button>
              <button className={`btn${view === "flows" ? " secondary" : ""}`} onClick={() => goToView("flows")}>
                <Workflow size={16} />
                Flows
              </button>
              <button className={`btn${view === "chat" ? " secondary" : ""}`} onClick={() => goToView("chat")}>
                <MessageSquare size={16} />
                Chats
              </button>
              <button className={`btn${view === "settings" ? " secondary" : ""}`} onClick={() => goToView("settings")}>
                <Settings2 size={16} />
                Settings
              </button>
              {view === "chat" ? (
                <button
                  className="btn"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setSidebarOpen(true);
                  }}
                >
                  <MessageSquare size={16} />
                  Conversations
                </button>
              ) : null}
              {view === "chat" ? (
                <button
                  className="btn"
                  onClick={async () => {
                    setMobileMenuOpen(false);
                    await ensureContext();
                    await refreshContextMetrics();
                    setContextVisible((v) => !v);
                  }}
                >
                  Context
                </button>
              ) : null}
            </nav>
          </>
        ) : null}

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
        ) : view === "ops" ? (
          <section className="triageMain opsMainShell">
            <OpsPage onLaunchMicrosoftOps={startMicrosoftOpsChat} />
          </section>
        ) : view === "flows" ? (
          <section className="triageMain flowMainShell">
            <FlowBuilderPage />
          </section>
        ) : (
          <section className="triageMain">
            <SettingsPage
              embedded
              onClose={() => setViewAndRoute("chat")}
              onLoggedOut={async () => {
                await refreshAuthStatus();
                handleUnauthorized();
              }}
              accounts={accounts}
              refreshAccounts={refreshAccounts}
              contextMetrics={contextMetrics}
            />
          </section>
        )}
      </main>
    </div>
  );
}

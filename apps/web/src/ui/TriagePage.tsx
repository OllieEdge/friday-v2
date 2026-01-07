import { Ban, CheckCircle2, Circle, Inbox, ListTodo, RotateCcw } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { Chat, Message, TriageItem, TriageItemsResponse } from "../api/types";
import { MessageBubble } from "./MessageBubble";
import { Markdown } from "./Markdown";

type ChatResponse = { ok: true; chat: Chat };
type UpdatePriorityResponse = { ok: true; item: TriageItem };

function sortByPriorityThenUpdated(a: TriageItem, b: TriageItem) {
  const pa = Number(a.priority) || 0;
  const pb = Number(b.priority) || 0;
  if (pb !== pa) return pb - pa;
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""), "en");
}

function sortByUpdated(a: TriageItem, b: TriageItem) {
  return String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""), "en");
}

function norm(s: any) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function matchesQuery(item: TriageItem, query: string) {
  const q = norm(query);
  if (!q) return true;
  const hay = norm(`${item.title}\n${item.summaryMd}\n${item.runbookId || ""}\n${item.sourceKey || ""}`);
  return hay.includes(q);
}

function confidenceLabel(item: TriageItem) {
  const c = item.confidencePct;
  if (c == null) return null;
  const n = Math.max(0, Math.min(100, Number(c) || 0));
  return `${Math.round(n)}%`;
}

function confidenceClass(item: TriageItem) {
  const c = item.confidencePct;
  if (c == null) return "";
  const n = Number(c) || 0;
  if (n >= 80) return "pillConfidenceHigh";
  if (n >= 55) return "pillConfidenceMed";
  return "pillConfidenceLow";
}

type SortMode = "priority" | "latest";

function applySort(items: TriageItem[], mode: SortMode) {
  const list = [...items];
  if (mode === "latest") list.sort(sortByUpdated);
  else list.sort(sortByPriorityThenUpdated);
  return list;
}

export function TriagePage({
  onOpenChat,
}: {
  onOpenChat: (chatId: string) => void;
}) {
  const [rawQuickReads, setRawQuickReads] = useState<TriageItem[]>([]);
  const [rawNextActions, setRawNextActions] = useState<TriageItem[]>([]);
  const [rawCompleted, setRawCompleted] = useState<TriageItem[]>([]);
  const [selected, setSelected] = useState<TriageItem | null>(null);
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null);

  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

  const [qrSort, setQrSort] = useState<SortMode>("priority");
  const [naSort, setNaSort] = useState<SortMode>("priority");
  const [doneSort, setDoneSort] = useState<SortMode>("latest");
  const [qrQuery, setQrQuery] = useState("");
  const [naQuery, setNaQuery] = useState("");
  const [doneQuery, setDoneQuery] = useState("");

  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackMode, setFeedbackMode] = useState<"dismiss" | "complete" | null>(null);
  const [feedbackReason, setFeedbackReason] = useState("");
  const [feedbackOutcome, setFeedbackOutcome] = useState("");
  const [feedbackNotes, setFeedbackNotes] = useState("");

  async function refreshLists() {
    const [qr, na, done] = await Promise.all([
      api<TriageItemsResponse>("/api/triage/items?status=open&kind=quick_read&limit=300"),
      api<TriageItemsResponse>("/api/triage/items?status=open&kind=next_action&limit=300"),
      api<TriageItemsResponse>("/api/triage/items?status=completed&limit=300"),
    ]);
    setRawQuickReads(qr.items);
    setRawNextActions(na.items);
    setRawCompleted(done.items);
  }

  const quickReads = useMemo(
    () => applySort(rawQuickReads.filter((it) => matchesQuery(it, qrQuery)), qrSort),
    [rawQuickReads, qrQuery, qrSort],
  );
  const nextActions = useMemo(
    () => applySort(rawNextActions.filter((it) => matchesQuery(it, naQuery)), naSort),
    [rawNextActions, naQuery, naSort],
  );
  const completed = useMemo(
    () => applySort(rawCompleted.filter((it) => matchesQuery(it, doneQuery)), doneSort),
    [rawCompleted, doneQuery, doneSort],
  );

  async function loadChat(chatId: string) {
    const res = await api<ChatResponse>(`/api/chats/${chatId}`);
    setSelectedChat(res.chat);
  }

  function openFeedback(mode: "dismiss" | "complete") {
    setFeedbackMode(mode);
    setFeedbackReason("");
    setFeedbackOutcome("");
    setFeedbackNotes("");
    setFeedbackOpen(true);
  }

  function closeFeedback() {
    setFeedbackOpen(false);
    setFeedbackMode(null);
    setFeedbackReason("");
    setFeedbackOutcome("");
    setFeedbackNotes("");
  }

  async function setItemStatus(item: TriageItem, status: "open" | "completed" | "dismissed") {
    await api<{ ok: true; item: TriageItem }>(`/api/triage/items/${item.id}/status`, {
      method: "POST",
      body: JSON.stringify({
        status,
        feedback: {
          kind: status === "dismissed" ? "dismissed" : status === "completed" ? "completed" : "reopened",
          reason: feedbackReason || null,
          outcome: feedbackOutcome || null,
          notes: feedbackNotes || null,
        },
      }),
    });
    closeFeedback();
    await refreshLists();
  }

  async function setPriority(item: TriageItem, priority: number) {
    const res = await api<UpdatePriorityResponse>(`/api/triage/items/${item.id}/priority`, {
      method: "POST",
      body: JSON.stringify({ priority }),
    });
    // Update selected + local lists optimistically.
    setSelected((prev) => (prev && prev.id === item.id ? res.item : prev));
    setRawQuickReads((prev) => prev.map((p) => (p.id === item.id ? res.item : p)));
    setRawNextActions((prev) => prev.map((p) => (p.id === item.id ? res.item : p)));
    setRawCompleted((prev) => prev.map((p) => (p.id === item.id ? res.item : p)));
  }

  async function promoteChat(chatId: string) {
    await api<{ ok: true }>(`/api/chats/${chatId}/visibility`, { method: "POST", body: JSON.stringify({ hidden: false }) });
    onOpenChat(chatId);
  }

  async function selectItem(item: TriageItem) {
    setSelected(item);
    setSelectedChat(null);
    await loadChat(item.chatId);
  }

  async function sendReply() {
    if (!selected || !selectedChat) return;
    const content = reply.trim();
    if (!content) return;
    setReply("");
    setSending(true);

    const optimisticUser: Message = { id: `tmp-user-${Date.now()}`, role: "user", content, createdAt: new Date().toISOString() };
    const optimisticAssistant: Message = {
      id: `tmp-assistant-${Date.now()}`,
      role: "assistant",
      content: "Thinking…",
      createdAt: new Date().toISOString(),
      events: [],
    };
    setSelectedChat((prev) => (prev ? { ...prev, messages: [...prev.messages, optimisticUser, optimisticAssistant] } : prev));

    try {
      const started = await api<{ ok: true; taskId: string; userMessage: Message; assistantMessage: Message }>(
        `/api/chats/${selected.chatId}/messages/stream`,
        { method: "POST", body: JSON.stringify({ content }) },
      );

      const assistantId = started.assistantMessage.id;
      setSelectedChat((prev) => {
        if (!prev) return prev;
        const msgs = [...prev.messages];
        const uIdx = msgs.findIndex((m) => m.id === optimisticUser.id);
        if (uIdx !== -1) msgs[uIdx] = started.userMessage;
        const aIdx = msgs.findIndex((m) => m.id === optimisticAssistant.id);
        if (aIdx !== -1) msgs[aIdx] = { ...started.assistantMessage, events: started.assistantMessage.events ?? [] };
        return { ...prev, messages: msgs };
      });

      const es = new EventSource(`/api/tasks/${started.taskId}/events`);
      es.addEventListener("message", (e) => {
        const ev = JSON.parse((e as MessageEvent).data);
        if (ev?.type === "assistant_message") {
          setSelectedChat((prev) => {
            if (!prev) return prev;
            const msgs = [...prev.messages];
            const idx = msgs.findIndex((m) => m.id === assistantId);
            if (idx !== -1) {
              const existing = msgs[idx];
              msgs[idx] = { ...existing, ...ev.message, events: existing.events ?? [] };
            }
            return { ...prev, messages: msgs };
          });
          return;
        }
        setSelectedChat((prev) => {
          if (!prev) return prev;
          const msgs = [...prev.messages];
          const idx = msgs.findIndex((m) => m.id === assistantId);
          if (idx === -1) return prev;
          const existing = msgs[idx];
          msgs[idx] = { ...existing, events: [...(existing.events ?? []), ev] };
          return { ...prev, messages: msgs };
        });
        if (ev?.type === "done" || ev?.type === "canceled") {
          es.close();
          setSending(false);
          void refreshLists();
        }
      });
      es.addEventListener("error", () => {});
    } catch (e) {
      setSending(false);
      setSelectedChat((prev) => {
        if (!prev) return prev;
        const msgs = [...prev.messages];
        const idx = msgs.findIndex((m) => m.id === optimisticAssistant.id);
        const errMsg = { ...optimisticAssistant, content: `Error: ${String((e as any)?.message || e)}` };
        if (idx !== -1) msgs[idx] = errMsg;
        return { ...prev, messages: msgs };
      });
    }
  }

  useEffect(() => {
    void refreshLists();
    const t = setInterval(() => refreshLists().catch(() => {}), 15000);
    return () => clearInterval(t);
  }, []);

  const selectedHeader = useMemo(() => {
    if (!selected) return null;
    const badge =
      selected.kind === "quick_read" ? (
        <span className="pill">quick read</span>
      ) : (
        <span className="pill pillActive">next action</span>
      );
    const conf = confidenceLabel(selected);
    const confClass = confidenceClass(selected);
    return (
      <div style={{ display: "grid", gap: 8 }}>
        <div className="row wrap">
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800 }}>{selected.title}</div>
              {badge}
              {typeof selected.priority === "number" ? <span className="pill">p{selected.priority}</span> : null}
              {conf ? <span className={`pill pillConfidence ${confClass}`}>{conf}</span> : null}
            </div>
            <div className="muted">
              Updated {new Date(selected.updatedAt).toLocaleString()} {selected.runbookId ? ` · ${selected.runbookId}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <label style={{ display: "grid", gap: 6, minWidth: 160 }}>
              <div className="muted">Priority</div>
              <select className="input" value={String(selected.priority || 0)} onChange={(e) => void setPriority(selected, Number(e.target.value))}>
                <option value="0">0 · low</option>
                <option value="1">1 · normal</option>
                <option value="2">2 · high</option>
                <option value="3">3 · urgent</option>
              </select>
            </label>
            {selected.status !== "completed" ? (
              <button className="btn secondary" onClick={() => openFeedback("complete")} title="Mark complete">
                <CheckCircle2 size={16} /> Complete
              </button>
            ) : (
              <button className="btn" onClick={() => setItemStatus(selected, "open")} title="Move back to open">
                <RotateCcw size={16} /> Reopen
              </button>
            )}
            <button className="btn" onClick={() => openFeedback("dismiss")} title="Dismiss (and learn)">
              <Ban size={16} />
              Dismiss
            </button>
            <button className="btn" onClick={() => promoteChat(selected.chatId)} title="Promote chat to sidebar">
              Promote chat
            </button>
          </div>
        </div>
        <div className="settingsDivider" />
        <Markdown className="md" content={selected.summaryMd} />
      </div>
    );
  }, [selected]);

  return (
    <div className="triageShell">
      <div className="triageLists">
        <div className="settingsCard">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 800, display: "flex", gap: 8, alignItems: "center" }}>
              <Inbox size={16} /> Quick reads
            </div>
            <span className="pill">{quickReads.length}</span>
          </div>
          <div className="muted">FYI items; clarify if action is needed.</div>
          <div className="row wrap">
            <input className="input" placeholder="Search quick reads…" value={qrQuery} onChange={(e) => setQrQuery(e.target.value)} />
            <select className="input" value={qrSort} onChange={(e) => setQrSort(e.target.value as SortMode)} style={{ width: "auto" }}>
              <option value="priority">Sort: priority</option>
              <option value="latest">Sort: latest</option>
            </select>
          </div>
          <div className="settingsDivider" />
          <div className="triageList">
            {quickReads.length ? (
              quickReads.map((it) => (
                <button key={it.id} className={`triageItem${selected?.id === it.id ? " active" : ""}`} onClick={() => selectItem(it)}>
                  <div className="triageItemTitleRow">
                    <div className="triageItemTitle">{it.title}</div>
                    <div className="triageItemBadges">
                      {typeof it.priority === "number" ? <span className="pill">p{it.priority}</span> : null}
                      {confidenceLabel(it) ? (
                        <span className={`pill pillConfidence ${confidenceClass(it)}`}>{confidenceLabel(it)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="muted">{new Date(it.updatedAt).toLocaleString()}</div>
                </button>
              ))
            ) : (
              <div className="muted">Nothing new.</div>
            )}
          </div>
        </div>

        <div className="settingsCard">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 800, display: "flex", gap: 8, alignItems: "center" }}>
              <ListTodo size={16} /> Next actions
            </div>
            <span className="pill pillActive">{nextActions.length}</span>
          </div>
          <div className="muted">Prioritised items to act on next.</div>
          <div className="row wrap">
            <input className="input" placeholder="Search next actions…" value={naQuery} onChange={(e) => setNaQuery(e.target.value)} />
            <select className="input" value={naSort} onChange={(e) => setNaSort(e.target.value as SortMode)} style={{ width: "auto" }}>
              <option value="priority">Sort: priority</option>
              <option value="latest">Sort: latest</option>
            </select>
          </div>
          <div className="settingsDivider" />
          <div className="triageList">
            {nextActions.length ? (
              nextActions.map((it) => (
                <button key={it.id} className={`triageItem${selected?.id === it.id ? " active" : ""}`} onClick={() => selectItem(it)}>
                  <div className="triageItemTitleRow">
                    <div className="triageItemTitle">{it.title}</div>
                    <div className="triageItemBadges">
                      {typeof it.priority === "number" ? <span className="pill">p{it.priority}</span> : null}
                      {confidenceLabel(it) ? (
                        <span className={`pill pillConfidence ${confidenceClass(it)}`}>{confidenceLabel(it)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="muted">{new Date(it.updatedAt).toLocaleString()}</div>
                </button>
              ))
            ) : (
              <div className="muted">No next actions.</div>
            )}
          </div>
        </div>

        <div className="settingsCard">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 800, display: "flex", gap: 8, alignItems: "center" }}>
              <CheckCircle2 size={16} /> Completed
            </div>
            <span className="pill">{completed.length}</span>
          </div>
          <div className="muted">Recently completed items.</div>
          <div className="row wrap">
            <input className="input" placeholder="Search completed…" value={doneQuery} onChange={(e) => setDoneQuery(e.target.value)} />
            <select className="input" value={doneSort} onChange={(e) => setDoneSort(e.target.value as SortMode)} style={{ width: "auto" }}>
              <option value="latest">Sort: latest</option>
              <option value="priority">Sort: priority</option>
            </select>
          </div>
          <div className="settingsDivider" />
          <div className="triageList">
            {completed.length ? (
              completed.map((it) => (
                <button key={it.id} className={`triageItem${selected?.id === it.id ? " active" : ""}`} onClick={() => selectItem(it)}>
                  <div className="triageItemTitleRow">
                    <div className="triageItemTitle">{it.title}</div>
                    <div className="triageItemBadges">
                      <span className="pill">{it.kind === "next_action" ? "action" : "read"}</span>
                      {typeof it.priority === "number" ? <span className="pill">p{it.priority}</span> : null}
                      {confidenceLabel(it) ? (
                        <span className={`pill pillConfidence ${confidenceClass(it)}`}>{confidenceLabel(it)}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="muted">{new Date(it.updatedAt).toLocaleString()}</div>
                </button>
              ))
            ) : (
              <div className="muted">Nothing completed yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="triageDetail">
        <div className="settingsCard">
          {feedbackOpen && selected ? (
            <div className="triageFeedbackOverlay" role="dialog" aria-modal="true">
              <div className="triageFeedbackModal">
                <div style={{ fontWeight: 800, marginBottom: 10 }}>
                  {feedbackMode === "dismiss" ? "Dismiss item (helps Friday learn)" : "Mark complete (optional feedback)"}
                </div>

                {feedbackMode === "dismiss" ? (
                  <label style={{ display: "grid", gap: 6 }}>
                    <div className="muted">Reason</div>
                    <select className="input" value={feedbackReason} onChange={(e) => setFeedbackReason(e.target.value)}>
                      <option value="">(optional)</option>
                      <option value="not_important">Not important</option>
                      <option value="wrong">Wrong / irrelevant</option>
                      <option value="duplicate">Duplicate</option>
                      <option value="already_handled">Already handled</option>
                      <option value="later">Later</option>
                    </select>
                  </label>
                ) : (
                  <label style={{ display: "grid", gap: 6 }}>
                    <div className="muted">Outcome</div>
                    <select className="input" value={feedbackOutcome} onChange={(e) => setFeedbackOutcome(e.target.value)}>
                      <option value="">(optional)</option>
                      <option value="done_by_me">Done by me</option>
                      <option value="done_by_friday">Done by Friday</option>
                      <option value="not_needed">Not actually needed</option>
                      <option value="wrong_action">Suggested action was wrong</option>
                    </select>
                  </label>
                )}

                <label style={{ display: "grid", gap: 6 }}>
                  <div className="muted">Notes</div>
                  <textarea className="textarea" rows={3} value={feedbackNotes} onChange={(e) => setFeedbackNotes(e.target.value)} />
                </label>

                <div className="row wrap" style={{ justifyContent: "flex-end" }}>
                  <button className="btn" onClick={() => closeFeedback()}>
                    Cancel
                  </button>
                  {feedbackMode === "dismiss" ? (
                    <button className="btn secondary" onClick={() => void setItemStatus(selected, "dismissed")}>
                      Dismiss
                    </button>
                  ) : (
                    <button className="btn secondary" onClick={() => void setItemStatus(selected, "completed")}>
                      Complete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}
          {selected ? (
            <>
              {selectedHeader}
              <div className="settingsDivider" />
              <div style={{ fontWeight: 800, display: "flex", gap: 8, alignItems: "center" }}>
                <Circle size={14} /> Thread
              </div>
              <div className="muted">Reply below to tell Friday what to do for this item.</div>
              <div className="settingsDivider" />
              <div className="triageChat">
                {(selectedChat?.messages || []).map((m) => (
                  <MessageBubble key={m.id} message={m} />
                ))}
              </div>
              <form
                className="triageComposer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void sendReply();
                }}
              >
                <textarea
                  className="textarea"
                  rows={3}
                  placeholder="Reply to Friday…"
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  disabled={sending}
                />
                <button className="btn primary" type="submit" disabled={sending}>
                  Send
                </button>
              </form>
            </>
          ) : (
            <div className="muted">Select a triage item.</div>
          )}
        </div>
      </div>
    </div>
  );
}

import React from "react";
import { api } from "../../api/client";
import type {
  Message,
  PmProject,
  PmProjectWorker,
  PmProjectCreateResponse,
  PmProjectDeleteResponse,
  PmProjectMessageResponse,
  PmProjectResponse,
  PmProjectsResponse,
  PmSizingResponse,
  PmTrelloBoardsResponse,
  PmTrelloListsResponse,
  PmTrelloSearchResponse,
  TaskEvent,
} from "../../api/types";
import { MessageBubble } from "../MessageBubble";

function formatTime(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function useTaskStream(taskId: string | null, onEvent: (ev: any) => void) {
  React.useEffect(() => {
    if (!taskId) return;
    const es = new EventSource(`/api/tasks/${taskId}/events`);
    es.addEventListener("message", (e) => {
      const ev = JSON.parse((e as MessageEvent).data);
      onEvent(ev);
    });
    es.addEventListener("error", () => {});
    return () => es.close();
  }, [taskId, onEvent]);
}

export function PmWorkspace() {
  const [projects, setProjects] = React.useState<PmProject[]>([]);
  const [activeProjectId, setActiveProjectId] = React.useState<string | null>(null);
  const [activeProject, setActiveProject] = React.useState<PmProject | null>(null);
  const [activeChat, setActiveChat] = React.useState<{ messages: Message[] } | null>(null);
  const [activeWorkers, setActiveWorkers] = React.useState<PmProjectWorker[]>([]);

  const [composer, setComposer] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [currentStage, setCurrentStage] = React.useState<string | null>(null);
  const [currentTaskId, setCurrentTaskId] = React.useState<string | null>(null);

  const [assignOpen, setAssignOpen] = React.useState(false);
  const [boards, setBoards] = React.useState<{ id: string; name: string }[]>([]);
  const [lists, setLists] = React.useState<{ id: string; name: string }[]>([]);
  const [cards, setCards] = React.useState<{ id: string; name: string; url: string }[]>([]);
  const [boardId, setBoardId] = React.useState("");
  const [listId, setListId] = React.useState("");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [cardUrl, setCardUrl] = React.useState("");

  const activityLines = React.useMemo(() => {
    const summary = activeProject?.summary || "";
    return summary
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }, [activeProject?.summary]);

  const usageSummary = React.useMemo(() => {
    let totalTokens = 0;
    let totalCost = 0;
    let hasCost = false;
    for (const message of activeChat?.messages || []) {
      for (const ev of message.events || []) {
        if (ev?.type === "usage" && ev?.usage) {
          const usage = ev.usage;
          const inTok = Number(usage.inputTokens) || 0;
          const cachedTok = Number(usage.cachedInputTokens) || 0;
          const outTok = Number(usage.outputTokens) || 0;
          totalTokens += inTok + cachedTok + outTok;
          if (typeof ev.costUsd === "number") {
            totalCost += ev.costUsd;
            hasCost = true;
          }
        }
      }
    }
    return { totalTokens, totalCost, hasCost };
  }, [activeChat?.messages]);

  async function refreshProjects() {
    const res = await api<PmProjectsResponse>("/api/pm/projects");
    setProjects(res.projects || []);
  }

  async function loadProject(projectId: string) {
    const res = await api<PmProjectResponse>(`/api/pm/projects/${projectId}`);
    setActiveProject(res.project);
    setActiveProjectId(res.project.id);
    setActiveChat(res.chat ? { messages: res.chat.messages || [] } : { messages: [] });
    setActiveWorkers(res.workers || []);
  }

  async function createProject() {
    const res = await api<PmProjectCreateResponse>("/api/pm/projects", { method: "POST", body: JSON.stringify({}) });
    await refreshProjects();
    await loadProject(res.project.id);
  }

  React.useEffect(() => {
    void refreshProjects();
  }, []);

  React.useEffect(() => {
    if (!activeProjectId && projects.length) {
      void loadProject(projects[0].id);
    }
  }, [activeProjectId, projects]);

  useTaskStream(currentTaskId, (ev) => {
    const t = String(ev?.type || "");
    if (t === "status") setCurrentStage(ev.stage || null);
    if (t === "done") {
      if (activeProjectId) void loadProject(activeProjectId);
    }
    if (t === "assistant_message") {
      setActiveChat((prev) => {
        const messages = prev?.messages ? [...prev.messages] : [];
        const msg = ev.message as Message;
        const idx = messages.findIndex((m) => m.id === msg.id);
        if (idx >= 0) messages[idx] = msg; else messages.push(msg);
        return { messages };
      });
    }
  });

  async function sendMessage() {
    if (!activeProject) return;
    const content = composer.trim();
    if (!content) return;
    setSending(true);
    try {
      const res = await api<PmProjectMessageResponse>(`/api/pm/projects/${activeProject.id}/messages/stream`, {
        method: "POST",
        body: JSON.stringify({ content, source: "human" }),
      });
      setComposer("");
      setCurrentTaskId(res.taskId);
      setActiveChat((prev) => {
        const messages = prev?.messages ? [...prev.messages] : [];
        if (res.userMessage) messages.push(res.userMessage);
        if (res.assistantMessage) messages.push(res.assistantMessage);
        return { messages };
      });
      await refreshProjects();
    } finally {
      setSending(false);
    }
  }

  async function openAssignModal() {
    setAssignOpen(true);
    const res = await api<PmTrelloBoardsResponse>("/api/pm/trello/boards");
    setBoards(res.boards || []);
  }

  async function loadLists(nextBoardId: string) {
    setListId("");
    setLists([]);
    if (!nextBoardId) return;
    const res = await api<PmTrelloListsResponse>(`/api/pm/trello/boards/${nextBoardId}/lists`);
    setLists(res.lists || []);
  }

  async function searchCards() {
    if (!searchQuery.trim()) return;
    const params = new URLSearchParams();
    params.set("query", searchQuery.trim());
    if (boardId) params.set("boardId", boardId);
    const res = await api<PmTrelloSearchResponse>(`/api/pm/trello/cards/search?${params.toString()}`);
    setCards(res.cards || []);
  }

  async function assignCard() {
    if (!activeProject) return;
    const url = cardUrl.trim();
    if (!url) return;
    await api(`/api/pm/projects/${activeProject.id}/trello/assign`, {
      method: "POST",
      body: JSON.stringify({ cardUrl: url }),
    });
    setAssignOpen(false);
    setCardUrl("");
    setCards([]);
    await loadProject(activeProject.id);
  }


  async function deleteProject() {
    if (!activeProject) return;
    const ok = window.confirm(`Delete PM chat "${activeProject.title}"? This will remove the PM project and chat only.`);
    if (!ok) return;
    await api<PmProjectDeleteResponse>(`/api/pm/projects/${activeProject.id}`, { method: "DELETE" });
    const res = await api<PmProjectsResponse>("/api/pm/projects");
    setProjects(res.projects || []);
    if (res.projects && res.projects.length) {
      await loadProject(res.projects[0].id);
    } else {
      setActiveProjectId(null);
      setActiveProject(null);
      setActiveChat({ messages: [] });
      setActiveWorkers([]);
    }
  }

  async function runSizing() {
    if (!activeProject) return;
    await api<PmSizingResponse>(`/api/pm/projects/${activeProject.id}/size`, { method: "POST", body: "{}" });
    await loadProject(activeProject.id);
  }

  return (
    <div className="pmShell">
      <aside className="pmSidebar">
        <div className="pmSidebarHeader">
          <div style={{ fontWeight: 700 }}>PM Chats</div>
          <button className="btn" onClick={() => void createProject()}>
            New PM
          </button>
        </div>
        <div className="pmList">
          {(projects || []).map((p) => (
            <button
              key={p.id}
              className={`pmItem${p.id === activeProjectId ? " active" : ""}`}
              onClick={() => void loadProject(p.id)}
            >
              <div className="pmItemTitle">{p.title}</div>
              <div className="pmItemMeta">Updated: {formatTime(p.lastActivityAt || p.updatedAt)}</div>
              {p.sizeLabel ? <div className="pill">{p.sizeLabel}</div> : null}
            </button>
          ))}
        </div>
      </aside>

      <section className="pmMain">
        {activeProject ? (
          <>
            <div className="pmHeader">
              <div className="pmHeaderMain">
                <div className="pmHeaderTitle">{activeProject.title}</div>
                <div className="pmHeaderMeta">
                  <span>Current task: {activeProject.title}</span>
                  {currentStage ? <span>Stage: {currentStage}</span> : null}
                  {activeWorkers.length ? <span>Workers: {activeWorkers.length}</span> : null}
                  {activeProject.sizeLabel ? <span>Size: {activeProject.sizeLabel}</span> : null}
                  {usageSummary.totalTokens ? <span>Tokens: {usageSummary.totalTokens.toLocaleString()}</span> : null}
                  {usageSummary.hasCost ? <span>Cost: ${usageSummary.totalCost.toFixed(4)}</span> : null}
                </div>
                <details className="pmMetaInline">
                  <summary className="muted">Metadata</summary>
                  <div className="pmMetaGrid">
                    <div>
                      <div className="muted">Status</div>
                      <div>{activeProject.status}</div>
                    </div>
                    <div>
                      <div className="muted">Last update</div>
                      <div>{formatTime(activeProject.lastActivityAt || activeProject.updatedAt)}</div>
                    </div>
                    {activeProject.sizeEstimate ? (
                      <div>
                        <div className="muted">Estimate</div>
                        <div>{activeProject.sizeEstimate}</div>
                      </div>
                    ) : null}
                    {activeProject.sizeRisks ? (
                      <div>
                        <div className="muted">Risks</div>
                        <div>{activeProject.sizeRisks}</div>
                      </div>
                    ) : null}
                  </div>
                  {activeWorkers.length ? (
                    <div className="pmWorkerList">
                      <div className="muted">Active workers</div>
                      <div className="pmWorkerRows">
                        {activeWorkers.map((w) => (
                          <div key={w.workerId} className="pmWorkerRow">
                            <div>{w.workerId}</div>
                            <div className="muted">{w.lane || "General"}</div>
                            <div className="muted">{formatTime(w.lastActivityAt)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </details>
              </div>
              <div className="pmHeaderActions">
                {activeProject.trelloCardUrl ? (
                  <a className="btn" href={activeProject.trelloCardUrl} target="_blank" rel="noreferrer">
                    Trello Card
                  </a>
                ) : null}
                <button className="btn" onClick={() => void openAssignModal()}>
                  Assign Trello
                </button>
                <button className="btn secondary" onClick={() => void runSizing()}>
                  Run sizing
                </button>
                <button className="btn danger" onClick={() => void deleteProject()}>
                  Delete PM
                </button>
              </div>
            </div>

            {activityLines.length ? (
              <div className="pmActivity">
                <div className="pmSectionTitle">Activity</div>
                <div className="pmActivityList">
                  {activityLines.map((line, idx) => (
                    <div key={`${idx}-${line}`} className="pmActivityItem">{line}</div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="pmMessages">
              {(activeChat?.messages || []).map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>

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
                placeholder="Message PM…"
                value={composer}
                onChange={(e) => setComposer(e.target.value)}
                disabled={sending}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (e.shiftKey) return;
                  e.preventDefault();
                  void sendMessage();
                }}
              />
              <button className="btn primary" type="submit" disabled={sending}>
                Send
              </button>
            </form>
          </>
        ) : (
          <div className="muted">No PM project selected.</div>
        )}
      </section>

      {assignOpen ? (
        <div className="modalOverlay" role="dialog" aria-modal="true">
          <div className="modal">
            <div className="modalHeader">
              <div style={{ fontWeight: 700 }}>Assign Trello Card</div>
              <button className="btn iconBtn" onClick={() => setAssignOpen(false)}>
                ×
              </button>
            </div>
            <div className="modalBody" style={{ display: "grid", gap: 10 }}>
              <div className="field">
                <label>Card URL</label>
                <input value={cardUrl} onChange={(e) => setCardUrl(e.target.value)} placeholder="https://trello.com/c/..." />
              </div>
              <div className="row wrap gap">
                <div className="field">
                  <label>Board</label>
                  <select
                    value={boardId}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBoardId(next);
                      void loadLists(next);
                    }}
                  >
                    <option value="">Select board…</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>List</label>
                  <select value={listId} onChange={(e) => setListId(e.target.value)}>
                    <option value="">All lists</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="row wrap gap">
                <input
                  className="input"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search card name…"
                  style={{ flex: 1, minWidth: 220 }}
                />
                <button className="btn" onClick={() => void searchCards()}>
                  Search
                </button>
              </div>
              {cards.length ? (
                <div className="pmSearchResults">
                  {cards.map((c) => (
                    <button
                      key={c.id}
                      className="pmSearchItem"
                      onClick={() => setCardUrl(c.url)}
                    >
                      <div style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{c.url}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="modalFooter">
              <button className="btn" onClick={() => setAssignOpen(false)}>
                Cancel
              </button>
              <button className="btn primary" onClick={() => void assignCard()}>
                Assign
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

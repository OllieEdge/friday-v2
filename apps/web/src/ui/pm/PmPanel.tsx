import React from "react";
import { api } from "../../api/client";
import type {
  PmCommandRequest,
  PmCommandsResponse,
  PmRequestResponse,
  PmRequestsResponse,
  PmSettingsResponse,
  PmTaskSummary,
  TaskEvent,
} from "../../api/types";

function useTaskStream(taskId: string | null) {
  const [events, setEvents] = React.useState<TaskEvent[]>([]);

  React.useEffect(() => {
    if (!taskId) return;

    const es = new EventSource(`/api/tasks/${taskId}/events`);
    es.addEventListener("message", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as TaskEvent;
      setEvents((prev) => [...prev, ev]);
    });
    es.addEventListener("error", () => {
      // Let the server close it.
    });
    return () => es.close();
  }, [taskId]);

  return { events };
}

function formatTime(value?: string | null) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function getTitle(item: PmTaskSummary) {
  const title = String(item?.input?.title || "").trim();
  return title || `PM request ${item.id.slice(0, 8)}`;
}

function getCommandText(item: PmTaskSummary) {
  const command = String(item?.input?.command || "").trim();
  return command || `Command ${item.id.slice(0, 8)}`;
}

function getCommandResult(item: PmTaskSummary) {
  const result = item?.input?.result;
  if (!result) return null;
  const status = result.ok ? "ok" : "error";
  const message = result.error || result.output || "";
  return { status, message };
}

export function PmPanel() {
  const [settings, setSettings] = React.useState<{ trelloBoard: string; trelloList: string } | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [trelloBoard, setTrelloBoard] = React.useState("");
  const [trelloList, setTrelloList] = React.useState("");
  const [taskId, setTaskId] = React.useState<string | null>(null);
  const { events } = useTaskStream(taskId);

  const [requests, setRequests] = React.useState<PmTaskSummary[]>([]);
  const [commands, setCommands] = React.useState<PmTaskSummary[]>([]);
  const [commandText, setCommandText] = React.useState("");
  const [requestsLoading, setRequestsLoading] = React.useState(false);
  const [commandsLoading, setCommandsLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [commandSubmitting, setCommandSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function loadSettings() {
    const res = await api<PmSettingsResponse>("/api/pm/settings");
    setSettings(res.settings);
    setTrelloBoard(res.settings.trelloBoard || "");
    setTrelloList(res.settings.trelloList || "");
  }

  async function loadRequests() {
    setRequestsLoading(true);
    try {
      const res = await api<PmRequestsResponse>("/api/pm/requests?limit=25");
      setRequests(res.items || []);
    } finally {
      setRequestsLoading(false);
    }
  }

  async function loadCommands() {
    setCommandsLoading(true);
    try {
      const res = await api<PmCommandsResponse>("/api/pm/commands?limit=25");
      setCommands(res.items || []);
    } finally {
      setCommandsLoading(false);
    }
  }

  React.useEffect(() => {
    void loadSettings();
    void loadRequests();
    void loadCommands();
  }, []);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.hidden) return;
      void loadRequests();
      void loadCommands();
    }, 10000);

    return () => window.clearInterval(interval);
  }, []);

  const cardEvent = [...events].reverse().find((e) => e.type === "trello_card") as
    | { type: "trello_card"; url: string; board?: string; list?: string }
    | undefined;
  const latestStatus = [...events].reverse().find((e) => e.type === "status") as
    | { type: "status"; stage: string }
    | undefined;
  const latestError = [...events].reverse().find((e) => e.type === "error") as
    | { type: "error"; message: string }
    | undefined;

  async function saveDefaults() {
    setError(null);
    setSaving(true);
    try {
      const res = await api<PmSettingsResponse>("/api/pm/settings", {
        method: "POST",
        body: JSON.stringify({ trelloBoard, trelloList }),
      });
      setSettings(res.settings);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function submitRequest() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;

    setError(null);
    setSubmitting(true);
    setTaskId(null);
    try {
      const res = await api<PmRequestResponse>("/api/pm/requests", {
        method: "POST",
        body: JSON.stringify({
          title: trimmedTitle,
          description,
          trelloBoard,
          trelloList,
          source: "friday_ui",
        }),
      });
      setTaskId(res.taskId);
      setTitle("");
      setDescription("");
      await loadRequests();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCommand() {
    const trimmedCommand = commandText.trim();
    if (!trimmedCommand) return;

    setError(null);
    setCommandSubmitting(true);
    try {
      await api<PmCommandRequest>("/api/pm/commands", {
        method: "POST",
        body: JSON.stringify({
          command: trimmedCommand,
          target: "codex_chat",
          source: "friday_ui",
        }),
      });
      setCommandText("");
      await loadCommands();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setCommandSubmitting(false);
    }
  }

  const activeItems = requests.filter((item) => item.status === "queued" || item.status === "running");
  const recentItems = requests.filter((item) => item.status !== "queued" && item.status !== "running");

  const activeCommands = commands.filter((item) => item.status === "queued" || item.status === "running");
  const recentCommands = commands.filter((item) => item.status !== "queued" && item.status !== "running");

  return (
    <div className="settingsSection">
      <div className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 700 }}>PM Defaults</div>
          </div>
          <div className="muted">Set the default Trello board + list used for PM requests.</div>
        </div>

        <div className="row wrap gap">
          <div className="field">
            <label>Board</label>
            <input
              value={trelloBoard}
              onChange={(e) => setTrelloBoard(e.target.value)}
              placeholder="https://trello.com/b/JdzyD1Q7/peronsal-projects"
            />
          </div>
          <div className="field">
            <label>List</label>
            <input value={trelloList} onChange={(e) => setTrelloList(e.target.value)} placeholder="Ideas" />
          </div>
        </div>

        <div className="row gap">
          <button className="btn" onClick={() => void saveDefaults()} disabled={saving}>
            {saving ? "Saving..." : "Save Defaults"}
          </button>
          {settings ? <div className="muted">Active: {settings.trelloBoard} / {settings.trelloList}</div> : null}
        </div>
      </div>

      <div className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 700 }}>New PM Request</div>
          </div>
          <div className="muted">Send a request to the PM agent and create a Trello card.</div>
        </div>

        <div className="field">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Build feature X" />
        </div>

        <div className="field">
          <label>Description</label>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Scope, acceptance criteria, constraints..."
          />
        </div>

        <div className="row gap">
          <button className="btn" onClick={() => void submitRequest()} disabled={submitting || !title.trim()}>
            {submitting ? "Submitting..." : "Send to PM"}
          </button>
          {taskId ? <div className="muted">Task: {taskId}</div> : null}
        </div>

        {latestStatus ? <div className="muted">Status: {latestStatus.stage}</div> : null}
        {cardEvent?.url ? (
          <div className="row gap">
            <a className="link" href={cardEvent.url} target="_blank" rel="noreferrer">
              View Trello Card
            </a>
            {cardEvent.board && cardEvent.list ? (
              <span className="muted">{cardEvent.board} / {cardEvent.list}</span>
            ) : null}
          </div>
        ) : null}
        {latestError ? <div className="errorText">{latestError.message}</div> : null}
        {error ? <div className="errorText">{error}</div> : null}
      </div>

      <div className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 700 }}>PM Activity</div>
            <button className="btn" onClick={() => void loadRequests()} disabled={requestsLoading}>
              {requestsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="muted">Active requests and the most recent completed work.</div>
        </div>

        <div className="settingsSection">
          <div className="muted">Active</div>
          {activeItems.length === 0 ? <div className="muted">No active requests.</div> : null}
          {activeItems.map((item) => (
            <div className="settingsCard" key={item.id}>
              <div className="settingsCardHeader">
                <div className="settingsCardTitleRow">
                  <div style={{ fontWeight: 600 }}>{getTitle(item)}</div>
                  <div className={`pill${item.status === "running" ? " pillActive" : ""}`}>{item.status}</div>
                </div>
                <div className="muted">Updated: {formatTime(item.updatedAt)}</div>
                {item.lastEvent?.type === "status" ? (
                  <div className="muted">Stage: {item.lastEvent.stage}</div>
                ) : item.lastEvent?.type === "error" ? (
                  <div className="errorText">{item.lastEvent.message}</div>
                ) : null}
              </div>
              {item.input?.trello?.cardUrl ? (
                <a className="link" href={item.input.trello.cardUrl} target="_blank" rel="noreferrer">
                  View Trello Card
                </a>
              ) : null}
            </div>
          ))}
        </div>

        <div className="settingsSection">
          <div className="muted">Recent</div>
          {recentItems.length === 0 ? <div className="muted">No completed requests yet.</div> : null}
          {recentItems.map((item) => (
            <div className="settingsCard" key={item.id}>
              <div className="settingsCardHeader">
                <div className="settingsCardTitleRow">
                  <div style={{ fontWeight: 600 }}>{getTitle(item)}</div>
                  <div className="pill">{item.status}</div>
                </div>
                <div className="muted">Updated: {formatTime(item.updatedAt)}</div>
                {item.lastEvent?.type === "error" ? (
                  <div className="errorText">{item.lastEvent.message}</div>
                ) : null}
              </div>
              {item.input?.trello?.cardUrl ? (
                <a className="link" href={item.input.trello.cardUrl} target="_blank" rel="noreferrer">
                  View Trello Card
                </a>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      <div className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 700 }}>PM Commands (Codex Chat)</div>
            <button className="btn" onClick={() => void loadCommands()} disabled={commandsLoading}>
              {commandsLoading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="muted">Queue commands for this chat and track results.</div>
        </div>

        <div className="field">
          <label>Command</label>
          <textarea
            rows={4}
            value={commandText}
            onChange={(e) => setCommandText(e.target.value)}
            placeholder="Describe the task or command you want Codex to run."
          />
        </div>

        <div className="row gap">
          <button className="btn" onClick={() => void submitCommand()} disabled={commandSubmitting || !commandText.trim()}>
            {commandSubmitting ? "Sending..." : "Send Command"}
          </button>
        </div>

        <div className="settingsSection">
          <div className="muted">Queue</div>
          {activeCommands.length === 0 ? <div className="muted">No queued commands.</div> : null}
          {activeCommands.map((item) => (
            <div className="settingsCard" key={item.id}>
              <div className="settingsCardHeader">
                <div className="settingsCardTitleRow">
                  <div style={{ fontWeight: 600 }}>{getCommandText(item)}</div>
                  <div className={`pill${item.status === "running" ? " pillActive" : ""}`}>{item.status}</div>
                </div>
                <div className="muted">Updated: {formatTime(item.updatedAt)}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="settingsSection">
          <div className="muted">Recent Results</div>
          {recentCommands.length === 0 ? <div className="muted">No command results yet.</div> : null}
          {recentCommands.map((item) => {
            const result = getCommandResult(item);
            return (
              <div className="settingsCard" key={item.id}>
                <div className="settingsCardHeader">
                  <div className="settingsCardTitleRow">
                    <div style={{ fontWeight: 600 }}>{getCommandText(item)}</div>
                    <div className="pill">{item.status}</div>
                  </div>
                  <div className="muted">Updated: {formatTime(item.updatedAt)}</div>
                  {result ? (
                    <div className={result.status === "ok" ? "muted" : "errorText"}>{result.message}</div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

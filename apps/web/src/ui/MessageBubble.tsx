import React, { useEffect, useMemo, useState } from "react";
import type { Message, RunMeta } from "../api/types";
import { Markdown } from "./Markdown";

function stageLabel(stage: string) {
  const s = String(stage || "");
  if (!s) return "";
  if (s === "loading_context") return "Loading context…";
  if (s === "running") return "Running…";
  if (s === "disconnected") return "Disconnected (refresh/reload).";
  return s;
}

function shortPath(p: string) {
  const s = String(p || "");
  return s
    .replace(/^\/Users\/[^/]+\/workspace\//, "")
    .replace(/^\/Users\/[^/]+\//, "")
    .replace(/^.*\/workspace\//, "");
}

function prettyCodexEvent(ev: any): string[] {
  const type = String(ev?.type || "");
  const itemType = String(ev?.item?.type || "");

  function toolInfo() {
    const tool = ev?.item?.tool || null;
    const name = String(tool?.name || ev?.item?.name || ev?.item?.tool_name || "");
    const args = tool?.parameters ?? ev?.item?.parameters ?? ev?.item?.args ?? ev?.item?.input ?? null;
    return { name, args };
  }

  function summarizeShellCommand(cmd: string) {
    const trimmed = String(cmd || "").trim().replace(/\s+/g, " ");
    if (!trimmed) return "";
    const noPrefix = trimmed.replace(/^sudo\s+-n\s+/, "").replace(/^sudo\s+/, "");
    const parts = noPrefix.split(" ");
    const bin = parts[0] || "";
    const last = parts[parts.length - 1] || "";
    if (bin === "cat" && last) return `Read: ${shortPath(last)}`;
    if (bin === "sed" && last) return `Read: ${shortPath(last)}`;
    if (bin === "rg") return `Search: ${noPrefix}`;
    if (bin === "ls") return `List: ${noPrefix}`;
    return `Shell: ${noPrefix}`;
  }

  function summarizeToolStart() {
    const { name, args } = toolInfo();
    if (!name) return "";
    if (name.endsWith("shell_command") || name.includes("shell_command")) {
      const cmd = typeof args === "object" && args ? (args as any).command : null;
      if (cmd) return summarizeShellCommand(String(cmd));
      return "Shell: running command…";
    }
    if (name.endsWith("apply_patch") || name.includes("apply_patch")) return "Applying patch…";
    return `Tool: ${name}`;
  }

  if (type === "item.started" && itemType === "file_change") return ["Editing files…"];

  if (type === "item.completed" && itemType === "file_change") {
    const changes = Array.isArray(ev?.item?.changes) ? ev.item.changes : [];
    if (!changes.length) return ["Updated files."];
    const lines = [];
    for (const c of changes) {
      const kind = String(c?.kind || "");
      const path = shortPath(String(c?.path || ""));
      if (!path) continue;
      const verb = kind === "add" ? "Added" : kind === "delete" ? "Deleted" : "Updated";
      lines.push(`${verb}: ${path}`);
    }
    return lines.length ? lines : ["Updated files."];
  }

  if (type === "item.started" && itemType === "tool_call") {
    const line = summarizeToolStart();
    return line ? [line] : [];
  }

  if (type === "item.completed" && itemType === "tool_call") {
    return [];
  }

  if (type === "item.started" && itemType === "todo_list") return ["Planning…"];

  return [];
}

function prettyTaskEvent(ev: any): string[] {
  const type = String(ev?.type || "");
  if (type === "status") {
    const label = stageLabel(String(ev?.stage || ""));
    return label ? [label] : [];
  }
  if (type === "done") return ["Done."];
  if (type === "canceled") return ["Canceled."];
  if (type === "codex") return prettyCodexEvent(ev?.event);
  if (type === "device") return ["Waiting for device login…"];
  if (type === "error") return [String(ev?.message || "Error")];
  return [];
}

function prettyRunLines(events: any[]) {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const e of events || []) {
    for (const l of prettyTaskEvent(e)) {
      if (!l) continue;
      if (seen.has(l)) continue;
      seen.add(l);
      lines.push(l);
    }
  }
  return lines;
}

function runPill(run: RunMeta) {
  if (run.status === "running") return "running";
  if (run.status === "done") return "done";
  if (run.status === "error") return "error";
  return run.status;
}

function latestUsage(events: any[]) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === "usage" && ev?.usage) return ev.usage;
  }
  return null;
}

function formatUsage(usage: any) {
  if (!usage) return "";
  const inTok = Number(usage.inputTokens) || 0;
  const cachedTok = Number(usage.cachedInputTokens) || 0;
  const outTok = Number(usage.outputTokens) || 0;
  const total = inTok + outTok;
  if (!total && !cachedTok) return "";
  const parts = [`${total.toLocaleString()} tok`];
  if (cachedTok) parts.push(`${cachedTok.toLocaleString()} cached`);
  return parts.join(" · ");
}

type MessageBubbleProps = {
  message: Message;
  eventsLimit?: number;
};

export function MessageBubble({ message, eventsLimit = 400 }: MessageBubbleProps) {
  const run = message.meta?.run;
  const events = Array.isArray(message.events) ? message.events : [];
  const isRunning = run?.status === "running";

  const shownEvents = useMemo(() => events.slice(-Math.max(1, eventsLimit)), [events, eventsLimit]);
  const prettyLines = useMemo(() => prettyRunLines(shownEvents), [shownEvents]);
  const activity = useMemo(() => {
    if (!run) return "";
    const last = prettyLines.length ? prettyLines[prettyLines.length - 1] : "";
    if (last) return last;
    return isRunning ? "Thinking…" : "";
  }, [run, isRunning, prettyLines]);
  const usageText = useMemo(() => formatUsage(latestUsage(events)), [events]);

  const displayContent = isRunning ? activity : String(message.content || "");

  const [detailsOpen, setDetailsOpen] = useState(isRunning);
  const [detailsPinned, setDetailsPinned] = useState(false);

  useEffect(() => {
    if (!run) return;
    if (run.status === "running") {
      if (!detailsPinned) setDetailsOpen(true);
      return;
    }
    if (!detailsPinned) setDetailsOpen(false);
  }, [run?.status, detailsPinned]);

  const eventsText = useMemo(() => prettyLines.join("\n"), [prettyLines]);

  return (
    <div className={`msg ${message.role}`}>
      <div className="msgRoleRow">
        <div className="msgRole">{message.role}</div>
        {run ? (
          <div className={`runPill ${run.status}`}>
            {runPill(run)}
            {usageText ? <span className="runPillUsage">{usageText}</span> : null}
          </div>
        ) : null}
      </div>
      <div className="msgContent">
        <Markdown className="md" content={displayContent} />
      </div>
      {run ? (
        <details
          className="msgDetails"
          open={detailsOpen}
          onToggle={(e) => setDetailsOpen((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary
            className="msgDetailsSummary"
            onClick={() => {
              if (!detailsPinned) setDetailsPinned(true);
            }}
          >
            <span>Details</span>
            <span className="muted">{activity}</span>
          </summary>
          <div className="msgDetailsBody">
            <div className="muted">
              Task: <code>{run.taskId}</code>
            </div>
            {eventsText ? <pre className="pre">{eventsText}</pre> : <div className="muted">No details yet.</div>}
          </div>
        </details>
      ) : null}
    </div>
  );
}

import { Link2, Play, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { OpsChannel, OpsOverviewResponse, OpsRunbook, RunnerSettingsResponse } from "../api/types";

type FlowNode = {
  id: string;
  label: string;
  kind: "input" | "process" | "agent" | "storage" | "output" | "tool" | "memory" | "decision";
  x: number;
  y: number;
  detail?: string;
  actionKey?: string;
  config?: Record<string, any>;
  status?: "ok" | "warn" | "missing" | "info";
};

type FlowEdge = {
  id: string;
  from: string;
  to: string;
};

type DragState = {
  nodeId: string;
  dx: number;
  dy: number;
} | null;

type FlowExecutionStep = {
  ts: string;
  nodeId: string;
  label: string;
  kind: string;
  action: string;
  ok: boolean;
  detail: string | null;
  stateKeys?: string[];
};

type FlowExecutionResponse = {
  ok: true;
  execution: {
    ok: boolean;
    startedAt: string;
    completedAt: string;
    stepCount: number;
    steps: FlowExecutionStep[];
    state?: Record<string, any>;
  };
  overview: OpsOverviewResponse["overview"];
};

const NODE_W = 190;
const NODE_H = 104;
const STORAGE_KEY = "friday-flow-layout-v1";

const seedNodes: FlowNode[] = [
  { id: "email_input", label: "Email Inputs", kind: "input", x: 80, y: 140, actionKey: "noop", detail: "Start point for multi-account email automation." },
  {
    id: "gmail_accounts_detect",
    label: "Detect Accounts (X)",
    kind: "decision",
    x: 300,
    y: 140,
    actionKey: "gmail.accounts.detect",
    detail: "Resolve connected Gmail accounts or fallback list",
    config: { autoDetectAccounts: true, fallbackAccounts: ["work", "personal"] },
  },
  {
    id: "gmail_pull",
    label: "Pull Gmail",
    kind: "process",
    x: 520,
    y: 140,
    actionKey: "gmail.pull",
    detail: "Load recent inbox messages",
    config: {
      accounts: ["work", "personal"],
      autoDetectAccounts: true,
      query: "in:inbox newer_than:2d -category:promotions -category:social",
      onlyUnread: false,
      maxResults: 12,
    },
  },
  {
    id: "gmail_triage_runbook",
    label: "Run Gmail Triage",
    kind: "agent",
    x: 760,
    y: 140,
    actionKey: "triage.gmail.runbook",
    detail: "Use Friday runbook to build triage items per account",
    config: { runbookId: "gmail-hourly-triage", accounts: ["work", "personal"], autoDetectAccounts: true },
  },
  {
    id: "triage_select",
    label: "Select Triage",
    kind: "decision",
    x: 1000,
    y: 140,
    actionKey: "triage.select",
    detail: "Filter high-confidence actionable items",
    config: {
      runbookId: "gmail-hourly-triage",
      accounts: ["work", "personal"],
      autoDetectAccounts: true,
      kind: "next_action",
      minPriority: 1,
      minConfidencePct: 65,
      limit: 6,
    },
  },
  {
    id: "draft_generate",
    label: "Generate Drafts",
    kind: "agent",
    x: 1230,
    y: 140,
    actionKey: "draft.generate",
    detail: "Build candidate replies, preserving source account",
    config: { useAssistant: true, personaId: "friday-core", tone: "friendly, concise, and professional", limit: 6 },
  },
  {
    id: "approval_queue",
    label: "Queue Approvals",
    kind: "memory",
    x: 1460,
    y: 140,
    actionKey: "approval.actions.propose",
    detail: "Create account-tagged approval actions",
    config: { channel: "gmail", intent: "draft_reply", accounts: ["work", "personal"], autoDetectAccounts: true },
  },
  {
    id: "approval_gate",
    label: "Approval Gate",
    kind: "decision",
    x: 1690,
    y: 140,
    actionKey: "approval.wait_confirmed",
    detail: "Stop until required confirmations are present",
    config: {
      channel: "gmail",
      intent: "draft_reply",
      accounts: ["work", "personal"],
      autoDetectAccounts: true,
      requiredCount: 1,
      useCreatedActions: true,
    },
  },
  {
    id: "gmail_send",
    label: "Send Confirmed",
    kind: "output",
    x: 1920,
    y: 140,
    actionKey: "gmail.send.confirmed",
    detail: "Send only confirmed approval actions",
    config: { dryRun: false, channel: "gmail", intent: "draft_reply", accounts: ["work", "personal"], autoDetectAccounts: true, limit: 5 },
  },
];

const seedEdges: FlowEdge[] = [
  { id: "e1", from: "email_input", to: "gmail_accounts_detect" },
  { id: "e2", from: "gmail_accounts_detect", to: "gmail_pull" },
  { id: "e3", from: "gmail_pull", to: "gmail_triage_runbook" },
  { id: "e4", from: "gmail_triage_runbook", to: "triage_select" },
  { id: "e5", from: "triage_select", to: "draft_generate" },
  { id: "e6", from: "draft_generate", to: "approval_queue" },
  { id: "e7", from: "approval_queue", to: "approval_gate" },
  { id: "e8", from: "approval_gate", to: "gmail_send" },
];

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function centerRight(n: FlowNode) {
  return { x: n.x + NODE_W, y: n.y + NODE_H / 2 };
}

function centerLeft(n: FlowNode) {
  return { x: n.x, y: n.y + NODE_H / 2 };
}

function nodeClass(kind: FlowNode["kind"]) {
  if (kind === "agent") return "agent";
  if (kind === "tool" || kind === "process") return "tool";
  if (kind === "memory" || kind === "storage") return "memory";
  return "decision";
}

function statusClass(status: FlowNode["status"]) {
  if (status === "ok") return "ok";
  if (status === "warn") return "warn";
  if (status === "missing") return "missing";
  return "info";
}

function nextNodeId(nodes: FlowNode[]) {
  return `node_${nodes.length + 1}_${Date.now().toString(36).slice(-4)}`;
}

function safeId(raw: string) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function runbookStatus(runbook: OpsRunbook): FlowNode["status"] {
  if (runbook.lastStatus === "error") return "missing";
  if (runbook.stale || runbook.lastStatus === "running") return "warn";
  if (runbook.lastStatus === "ok") return "ok";
  return "info";
}

function channelStatus(channel: OpsChannel): FlowNode["status"] {
  if (channel.state === "ok") return "ok";
  if (channel.state === "degraded") return "warn";
  return "missing";
}

function runnerLabel(settings: RunnerSettingsResponse) {
  const effective = settings.effective?.runner || settings.prefs?.runner || "unknown";
  if (effective === "vertex") return `Vertex (${settings.prefs?.vertex?.model || "default"})`;
  if (effective === "openai") return `OpenAI (${settings.prefs?.openai?.model || "default"})`;
  if (effective === "codex") return "Codex";
  if (effective === "hybrid") return "Hybrid Router";
  return effective;
}

function coreActionOptions(runbooks: OpsRunbook[]) {
  const base = [
    { value: "noop", label: "No-op" },
    { value: "gmail.accounts.detect", label: "Gmail: Detect X accounts" },
    { value: "gmail.pull", label: "Gmail: Pull inbox messages" },
    { value: "triage.gmail.runbook", label: "Triage: Run Gmail runbook" },
    { value: "triage.select", label: "Triage: Select candidate items" },
    { value: "draft.generate", label: "Draft: Generate reply candidates" },
    { value: "approval.actions.propose", label: "Approval: Queue actions" },
    { value: "approval.wait_confirmed", label: "Approval: Wait for confirmations" },
    { value: "gmail.send.confirmed", label: "Send: Confirmed Gmail drafts" },
    { value: "ops.refresh", label: "Ops refresh" },
    { value: "digest.generate", label: "Generate digest" },
    { value: "audit.capabilities", label: "Capability audit" },
    { value: "snapshot.control_tower", label: "Control tower snapshot" },
    { value: "snapshot.workstream", label: "Workstream snapshot" },
    { value: "actions.pending", label: "List pending actions" },
    { value: "triage.open", label: "List open triage" },
  ];
  const runbookActions = (runbooks || []).map((rb) => ({
    value: `runbook:${rb.runbookId}`,
    label: `Runbook: ${rb.title || rb.runbookId}`,
  }));
  return [...base, ...runbookActions];
}

function buildLiveTopology({
  overview,
  settings,
  previousNodes,
}: {
  overview: OpsOverviewResponse["overview"];
  settings: RunnerSettingsResponse;
  previousNodes: FlowNode[];
}) {
  const prev = new Map((previousNodes || []).map((n) => [n.id, { x: n.x, y: n.y }]));
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const place = (
    id: string,
    label: string,
    kind: FlowNode["kind"],
    x: number,
    y: number,
    detail = "",
    status: FlowNode["status"] = "info",
    actionKey = "noop",
  ) => {
    const prior = prev.get(id);
    nodes.push({
      id,
      label,
      kind,
      x: prior?.x ?? x,
      y: prior?.y ?? y,
      detail,
      status,
      actionKey,
    });
  };

  const connect = (from: string, to: string) => {
    const id = `${from}__${to}`;
    if (!edges.some((e) => e.id === id)) edges.push({ id, from, to });
  };

  const health = overview.health?.level || "warn";
  const healthStatus: FlowNode["status"] = health === "ok" ? "ok" : health === "critical" ? "missing" : "warn";

  place("core_server", "Friday v2 Server", "agent", 70, 120, "UI + API + worker orchestration", "info", "noop");
  place("core_health", "Ops Health", "decision", 360, 50, overview.health?.summary || "No summary", healthStatus, "ops.refresh");
  connect("core_server", "core_health");

  place(
    "core_runner",
    runnerLabel(settings),
    "agent",
    360,
    180,
    `Effective: ${settings.effective.runner} (${settings.effective.source})`,
    settings.effective.runner === "hybrid" ? "ok" : "info",
    "noop",
  );
  connect("core_server", "core_runner");

  const effectiveRunner = settings.effective.runner;
  if (effectiveRunner === "hybrid") {
    const hybrid = settings.prefs.hybrid;
    place(
      "runner_local",
      `Local LLM: ${hybrid.model}`,
      "tool",
      660,
      140,
      `base ${hybrid.baseUrl} · <=${hybrid.localOnlyMaxChars} chars`,
      "ok",
      "noop",
    );
    place("runner_fallback", `Fallback: ${hybrid.fallbackRunner}`, "tool", 660, 250, "Used when local route is unsuitable", "warn", "noop");
    connect("core_runner", "runner_local");
    connect("core_runner", "runner_fallback");
  } else {
    place("runner_primary", `Primary: ${runnerLabel(settings)}`, "tool", 660, 190, "Active runner path", "info", "noop");
    connect("core_runner", "runner_primary");
  }

  place(
    "core_scheduler",
    "Runbook Scheduler",
    "tool",
    360,
    330,
    `${overview.queue?.runbooks?.enabled || 0} enabled / ${overview.queue?.runbooks?.total || 0} total`,
    overview.queue?.runbooks?.error ? "warn" : "ok",
    "noop",
  );
  connect("core_server", "core_scheduler");

  const runbooks = (overview.runbooks || []).filter((r) => r.enabled).slice(0, 6);
  runbooks.forEach((r, idx) => {
    const id = `runbook_${safeId(r.runbookId)}`;
    const y = 300 + idx * 96;
    place(
      id,
      r.title || r.runbookId,
      "decision",
      660,
      y,
      `status: ${r.lastStatus}${r.stale ? " · stale" : ""}`,
      runbookStatus(r),
      `runbook:${r.runbookId}`,
    );
    connect("core_scheduler", id);
  });

  place(
    "queue_actions",
    "Action Queue",
    "memory",
    970,
    80,
    `${overview.queue?.actions?.pending || 0} pending / ${overview.queue?.actions?.total || 0} total`,
    overview.queue?.actions?.pending ? "warn" : "ok",
    "actions.pending",
  );
  place(
    "queue_triage",
    "Triage Queue",
    "memory",
    970,
    190,
    `${overview.queue?.triage?.open || 0} open · ${overview.queue?.triage?.urgentOpen || 0} urgent`,
    overview.queue?.triage?.urgentOpen ? "warn" : overview.queue?.triage?.open ? "info" : "ok",
    "triage.open",
  );
  connect("core_health", "queue_actions");
  connect("core_health", "queue_triage");

  place(
    "channels_hub",
    "OpenClaw Channels",
    "tool",
    970,
    320,
    `${overview.channels?.length || 0} linked channel account(s)`,
    (overview.channels || []).some((c) => c.state !== "ok") ? "warn" : "ok",
    "noop",
  );
  connect(effectiveRunner === "hybrid" ? "runner_local" : "core_runner", "channels_hub");

  (overview.channels || []).slice(0, 8).forEach((c, idx) => {
    const id = `channel_${safeId(`${c.channel}_${c.accountId}`)}`;
    const detail = `${c.accountId} · ${c.state}${c.running ? " · running" : ""}`;
    place(id, `${c.channel}`, "memory", 1260, 270 + idx * 88, detail, channelStatus(c), "noop");
    connect("channels_hub", id);
  });

  return { nodes, edges };
}

export function FlowBuilderPage() {
  const [nodes, setNodes] = useState<FlowNode[]>(seedNodes);
  const [edges, setEdges] = useState<FlowEdge[]>(seedEdges);
  const [selectedFrom, setSelectedFrom] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 1200, height: 760 });
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string>("");
  const [liveLoading, setLiveLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [executeBusy, setExecuteBusy] = useState(false);
  const [execution, setExecution] = useState<FlowExecutionResponse["execution"] | null>(null);
  const [configDraft, setConfigDraft] = useState("{}");
  const [configError, setConfigError] = useState("");
  const [runbookOptions, setRunbookOptions] = useState<OpsRunbook[]>([]);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.nodes) && Array.isArray(parsed?.edges)) {
        setNodes(parsed.nodes);
        setEdges(parsed.edges);
        if (parsed?.lastSyncAt) setLastSyncAt(String(parsed.lastSyncAt));
      }
    } catch {
      // ignore corrupted local cache
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ nodes, edges, lastSyncAt }));
  }, [lastSyncAt, nodes, edges]);

  async function refreshLiveTopology() {
    setLiveError("");
    setLiveLoading(true);
    try {
      const [opsRes, runnerRes] = await Promise.all([
        api<OpsOverviewResponse>("/api/ops/overview?timelineLimit=20"),
        api<RunnerSettingsResponse>("/api/settings/runner"),
      ]);
      setRunbookOptions(opsRes.overview.runbooks || []);
      const next = buildLiveTopology({ overview: opsRes.overview, settings: runnerRes, previousNodes: nodes });
      setNodes(next.nodes);
      setEdges(next.edges);
      setSelectedFrom(null);
      setSelectedNodeId(null);
      setLastSyncAt(new Date().toISOString());
    } catch (err: any) {
      setLiveError(String(err?.message || err || "Unable to load live topology"));
    } finally {
      setLiveLoading(false);
    }
  }

  async function loadSavedFlow() {
    try {
      const saved = await api<{ ok: true; flow: { nodes: FlowNode[]; edges: FlowEdge[]; updatedAt?: string | null } }>("/api/ops/flow");
      if (Array.isArray(saved?.flow?.nodes) && saved.flow.nodes.length) {
        setNodes(saved.flow.nodes);
        setEdges(Array.isArray(saved.flow.edges) ? saved.flow.edges : []);
        setLastSyncAt(saved.flow.updatedAt || new Date().toISOString());
        return true;
      }
    } catch {
      // fallback to live topology
    }
    return false;
  }

  async function saveFlow() {
    setSaveBusy(true);
    try {
      const payload = { flow: { nodes, edges } };
      const saved = await api<{ ok: true; flow: { updatedAt?: string } }>("/api/ops/flow", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setLastSyncAt(saved?.flow?.updatedAt || new Date().toISOString());
    } catch (err: any) {
      setLiveError(String(err?.message || err || "Unable to save flow"));
    } finally {
      setSaveBusy(false);
    }
  }

  async function executeFlow() {
    setExecuteBusy(true);
    setLiveError("");
    try {
      const payload = {
        flow: { nodes, edges },
        startNodeId: selectedNodeId || undefined,
      };
      const res = await api<FlowExecutionResponse>("/api/ops/flow/execute", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setExecution(res.execution);
      setRunbookOptions(res.overview.runbooks || []);
    } catch (err: any) {
      setLiveError(String(err?.message || err || "Unable to execute flow"));
    } finally {
      setExecuteBusy(false);
    }
  }

  useEffect(() => {
    (async () => {
      const hasSaved = await loadSavedFlow();
      if (!hasSaved) await refreshLiveTopology();
      else {
        try {
          const opsRes = await api<OpsOverviewResponse>("/api/ops/overview?timelineLimit=20");
          setRunbookOptions(opsRes.overview.runbooks || []);
        } catch {
          // ignore supplemental fetch issues
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      setCanvasSize({ width: Math.max(900, Math.floor(box.width)), height: Math.max(620, Math.floor(box.height)) });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const drag = dragRef.current;
      const el = canvasRef.current;
      if (!drag || !el) return;
      const rect = el.getBoundingClientRect();
      const x = clamp(ev.clientX - rect.left - drag.dx, 20, Math.max(20, canvasSize.width - NODE_W - 20));
      const y = clamp(ev.clientY - rect.top - drag.dy, 20, Math.max(20, canvasSize.height - NODE_H - 20));
      setNodes((prev) => prev.map((n) => (n.id === drag.nodeId ? { ...n, x, y } : n)));
    }

    function onUp() {
      dragRef.current = null;
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [canvasSize.height, canvasSize.width]);

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selectedNode = useMemo(() => nodes.find((n) => n.id === selectedNodeId) || null, [nodes, selectedNodeId]);
  const actionOptions = useMemo(() => coreActionOptions(runbookOptions), [runbookOptions]);

  useEffect(() => {
    if (!selectedNode) {
      setConfigDraft("{}");
      setConfigError("");
      return;
    }
    const raw = selectedNode.config && typeof selectedNode.config === "object" ? selectedNode.config : {};
    setConfigDraft(JSON.stringify(raw, null, 2));
    setConfigError("");
  }, [selectedNode]);

  function patchNode(nodeId: string, patch: Partial<FlowNode>) {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
  }

  function patchNodeConfig(raw: string) {
    setConfigDraft(raw);
    if (!selectedNode) return;
    const trimmed = raw.trim();
    if (!trimmed) {
      patchNode(selectedNode.id, { config: {} });
      setConfigError("");
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setConfigError("Config must be a JSON object.");
        return;
      }
      patchNode(selectedNode.id, { config: parsed });
      setConfigError("");
    } catch {
      setConfigError("Invalid JSON.");
    }
  }

  function startDrag(ev: React.PointerEvent, node: FlowNode) {
    const el = canvasRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      nodeId: node.id,
      dx: ev.clientX - rect.left - node.x,
      dy: ev.clientY - rect.top - node.y,
    };
  }

  function connectInto(targetNodeId: string) {
    if (!selectedFrom || selectedFrom === targetNodeId) return;
    const edgeId = `${selectedFrom}__${targetNodeId}`;
    setEdges((prev) => (prev.some((e) => e.id === edgeId) ? prev : [...prev, { id: edgeId, from: selectedFrom, to: targetNodeId }]));
    setSelectedFrom(null);
  }

  function addNode() {
    setNodes((prev) => {
      const id = nextNodeId(prev);
      const kinds: FlowNode["kind"][] = ["input", "process", "agent", "storage", "output", "tool", "memory", "decision"];
      const nextKind = kinds[prev.length % kinds.length];
      const x = clamp(80 + (prev.length % 5) * 220, 20, Math.max(20, canvasSize.width - NODE_W - 20));
      const y = clamp(80 + Math.floor(prev.length / 5) * 120, 20, Math.max(20, canvasSize.height - NODE_H - 20));
      return [...prev, { id, label: `Node ${prev.length + 1}`, kind: nextKind, x, y, actionKey: "noop", detail: "", config: {} }];
    });
    setSelectedNodeId(null);
  }

  function clearEdges() {
    setEdges([]);
    setSelectedFrom(null);
  }

  function resetLayout() {
    setNodes(seedNodes);
    setEdges(seedEdges);
    setSelectedFrom(null);
    setSelectedNodeId(null);
    setLastSyncAt(null);
    setLiveError("");
    setExecution(null);
  }

  function loadModularTemplate() {
    setNodes(seedNodes);
    setEdges(seedEdges);
    setSelectedFrom(null);
    setSelectedNodeId(null);
    setLiveError("");
    setExecution(null);
  }

  return (
    <div className="flowShell">
      <div className="flowTop">
        <div>
          <div className="flowTitle">Automation Flow Builder</div>
          <div className="flowSub">Build executable modular pipelines. Node links define order; node action/config defines behavior.</div>
          <div className="flowMeta">
            <span className="pill">{liveLoading ? "Syncing…" : "Live linked"}</span>
            <span className="pill">{lastSyncAt ? `Synced ${new Date(lastSyncAt).toLocaleString()}` : "Not synced yet"}</span>
            {liveError ? <span className="pill flowPillError">{liveError}</span> : null}
          </div>
        </div>
        <div className="flowActions">
          <button className="btn secondary" onClick={() => void refreshLiveTopology()} disabled={liveLoading}>
            <RotateCcw size={16} />
            Refresh Live
          </button>
          <button className="btn secondary" onClick={() => void saveFlow()} disabled={saveBusy}>
            <Save size={16} />
            {saveBusy ? "Saving…" : "Save Flow"}
          </button>
          <button className="btn secondary" onClick={() => void executeFlow()} disabled={executeBusy}>
            <Play size={16} />
            {executeBusy ? "Running…" : "Run Flow"}
          </button>
          <button className="btn secondary" onClick={addNode}>
            <Plus size={16} />
            Add Node
          </button>
          <button className="btn secondary" onClick={loadModularTemplate}>
            <RotateCcw size={16} />
            Load Email Flow
          </button>
          <button className="btn" onClick={clearEdges}>
            <Trash2 size={16} />
            Clear Links
          </button>
          <button className="btn" onClick={resetLayout}>
            <RotateCcw size={16} />
            Reset
          </button>
        </div>
      </div>

      <div className="flowCanvas" ref={canvasRef}>
        <svg className="flowSvg" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} preserveAspectRatio="none">
          {edges.map((edge) => {
            const fromNode = nodeMap.get(edge.from);
            const toNode = nodeMap.get(edge.to);
            if (!fromNode || !toNode) return null;
            const a = centerRight(fromNode);
            const b = centerLeft(toNode);
            const c1x = a.x + Math.max(30, Math.abs(b.x - a.x) * 0.35);
            const c2x = b.x - Math.max(30, Math.abs(b.x - a.x) * 0.35);
            const path = `M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`;
            return <path key={edge.id} d={path} className="flowEdge" />;
          })}
        </svg>

        {nodes.map((node) => (
          <article
            key={node.id}
            className={`flowNode ${nodeClass(node.kind)} ${statusClass(node.status)}${selectedNodeId === node.id ? " active" : ""}`}
            style={{ left: node.x, top: node.y }}
            onClick={() => setSelectedNodeId(node.id)}
          >
            <button className="flowInDot" title="Connect here" onClick={() => connectInto(node.id)} />
            <div className="flowNodeHead" onPointerDown={(e) => startDrag(e, node)}>
              <span>{node.label}</span>
              <span className="flowNodeKind">{node.kind}</span>
            </div>
            {node.detail ? <div className="flowNodeDetail">{node.detail}</div> : null}
            {node.actionKey ? <div className="flowNodeDetail">Action: {node.actionKey}</div> : null}
            <div className="flowNodeFoot">
              <button
                className={`flowOutDot${selectedFrom === node.id ? " active" : ""}`}
                title="Start link from this node"
                onClick={() => setSelectedFrom((prev) => (prev === node.id ? null : node.id))}
              >
                <Link2 size={12} />
              </button>
            </div>
          </article>
        ))}
      </div>

      <div className="flowLegend">
        <span className="pill">Nodes: {nodes.length}</span>
        <span className="pill">Links: {edges.length}</span>
        <span className="pill">{selectedFrom ? `Linking from ${selectedFrom}` : "Click link icon, then target node input"}</span>
      </div>

      <div className="flowInspector">
        {selectedNode ? (
          <>
            <div className="flowInspectorTitle">Node Settings</div>
            <label>
              Label
              <input value={selectedNode.label} onChange={(e) => patchNode(selectedNode.id, { label: e.target.value })} placeholder="Node label" />
            </label>
            <label>
              Kind
              <select value={selectedNode.kind} onChange={(e) => patchNode(selectedNode.id, { kind: e.target.value as FlowNode["kind"] })}>
                <option value="input">Input</option>
                <option value="process">Process</option>
                <option value="agent">Agent</option>
                <option value="storage">Storage</option>
                <option value="output">Output</option>
                <option value="tool">Tool</option>
                <option value="memory">Memory</option>
                <option value="decision">Decision</option>
              </select>
            </label>
            <label>
              Action
              <select value={selectedNode.actionKey || "noop"} onChange={(e) => patchNode(selectedNode.id, { actionKey: e.target.value })}>
                {actionOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Detail
              <textarea
                value={selectedNode.detail || ""}
                onChange={(e) => patchNode(selectedNode.id, { detail: e.target.value })}
                placeholder="Optional details"
                rows={3}
              />
            </label>
            <label>
              Config (JSON)
              <textarea value={configDraft} onChange={(e) => patchNodeConfig(e.target.value)} placeholder='{"accountKey":"work"}' rows={8} />
            </label>
            {configError ? <div className="flowPillError">{configError}</div> : null}
          </>
        ) : (
          <div className="flowInspectorTitle">Select a node to edit kind/action.</div>
        )}
      </div>

      {execution ? (
        <div className="flowExecution">
          <div className="flowInspectorTitle">
            Last Run: {execution.ok ? "OK" : "Failed"} ({execution.stepCount} step{execution.stepCount === 1 ? "" : "s"})
          </div>
          <div className="flowExecutionList">
            {execution.steps.map((step) => (
              <div key={`${step.ts}:${step.nodeId}`} className={`flowExecutionItem ${step.ok ? "ok" : "fail"}`}>
                <strong>{step.label}</strong> [{step.action}] {step.ok ? "ok" : "failed"}
                {step.detail ? ` - ${step.detail}` : ""}
                {step.stateKeys?.length ? ` | state: ${step.stateKeys.join(", ")}` : ""}
              </div>
            ))}
          </div>
          {execution.state ? (
            <pre className="flowExecutionItem" style={{ marginTop: 12, maxHeight: 260, overflow: "auto", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(execution.state, null, 2)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

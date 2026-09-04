import { AlertTriangle, CheckCircle2, CircleDashed, Play, RefreshCw } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type {
  OpsAction,
  OpsActionStatus,
  OpsActionUpdateResponse,
  OpsActionsResponse,
  OpsFlowExecutionStep,
  OpsFlowIntentResolution,
  OpsFlowRegistryResponse,
  OpsOverview,
  OpsOverviewResponse,
  OpsRefreshResponse,
  OpsResolveIntentExecuteResponse,
  OpsResolveIntentResponse,
  OpsTimelineEvent,
  TriageItem,
} from "../api/types";

type ActionFilter = "all" | OpsActionStatus;

function fmtTs(ts?: string | null) {
  if (!ts) return "n/a";
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return String(ts);
  return d.toLocaleString();
}

function ellipsize(s: string, n = 180) {
  const t = String(s || "");
  return t.length <= n ? t : `${t.slice(0, n - 1)}...`;
}

function stripMd(s: string) {
  return String(s || "")
    .replace(/[`*_>#\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function priorityLabel(priority: number) {
  if (priority >= 3) return "Urgent";
  if (priority >= 2) return "High";
  if (priority >= 1) return "Normal";
  return "Low";
}

function healthClass(level: OpsOverview["health"]["level"]) {
  if (level === "ok") return "ok";
  if (level === "critical") return "critical";
  return "warn";
}

function eventSeverityClass(severity: OpsTimelineEvent["severity"]) {
  if (severity === "ok") return "ok";
  if (severity === "error") return "critical";
  if (severity === "warn") return "warn";
  return "info";
}

function actionButtonsFor(status: OpsActionStatus) {
  if (status === "pending") return ["confirmed", "cancelled"] as const;
  if (status === "confirmed") return ["completed", "cancelled"] as const;
  return [] as const;
}

function actionButtonLabel(status: "confirmed" | "cancelled" | "completed") {
  if (status === "confirmed") return "Confirm";
  if (status === "cancelled") return "Cancel";
  return "Complete";
}

function parseInputsJson(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return { ok: true, value: {} as Record<string, any> };
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "Inputs JSON must be an object." };
    }
    return { ok: true, value: parsed as Record<string, any> };
  } catch {
    return { ok: false, error: "Inputs JSON is invalid." };
  }
}

function fmtDuration(ms: number) {
  const value = Number(ms) || 0;
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

function flowStatusClass(status: "healthy" | "degraded" | "still failing") {
  if (status === "healthy") return "ok";
  if (status === "degraded") return "warn";
  return "critical";
}

function planStepState(step: { runnable: boolean; blockedByFixIntent: boolean; missingInputs?: string[] }) {
  if (step.runnable) return "ready";
  if (step.blockedByFixIntent) return "fix-intent";
  if (Array.isArray(step.missingInputs) && step.missingInputs.length) return "missing-inputs";
  return "blocked";
}

function execStepClass(step: OpsFlowExecutionStep) {
  if (step.status === "ok") return "ok";
  if (step.status === "failed") return "critical";
  if (step.status === "noted") return "info";
  return "warn";
}

export function OpsPage({ onLaunchMicrosoftOps }: { onLaunchMicrosoftOps?: () => Promise<void> }) {
  const [overview, setOverview] = useState<OpsOverview | null>(null);
  const [actions, setActions] = useState<OpsAction[]>([]);
  const [actionCounts, setActionCounts] = useState<OpsOverview["queue"]["actions"] | null>(null);
  const [actionFilter, setActionFilter] = useState<ActionFilter>("pending");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [busyTriageId, setBusyTriageId] = useState<string | null>(null);
  const [busyRunbookId, setBusyRunbookId] = useState<string | null>(null);
  const [busyMicrosoftOps, setBusyMicrosoftOps] = useState(false);

  const [intentText, setIntentText] = useState("");
  const [intentInputs, setIntentInputs] = useState("{}");
  const [intentFixMode, setIntentFixMode] = useState<"auto" | "true" | "false">("auto");
  const [intentRunRepair, setIntentRunRepair] = useState(true);
  const [intentRunVerify, setIntentRunVerify] = useState(false);
  const [intentTimeoutMs, setIntentTimeoutMs] = useState("90000");
  const [intentBusy, setIntentBusy] = useState(false);
  const [intentError, setIntentError] = useState("");
  const [flowRegistry, setFlowRegistry] = useState<OpsFlowRegistryResponse | null>(null);
  const [intentPlan, setIntentPlan] = useState<OpsResolveIntentResponse | null>(null);
  const [intentExecution, setIntentExecution] = useState<OpsResolveIntentExecuteResponse | null>(null);

  async function loadOverview() {
    setLoading(true);
    setError("");
    try {
      const res = await api<OpsOverviewResponse>("/api/ops/overview");
      setOverview(res.overview);
      setActionCounts(res.overview.queue.actions);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function loadActions(filter: ActionFilter) {
    try {
      const res = await api<OpsActionsResponse>(`/api/ops/actions?status=${encodeURIComponent(filter)}&limit=180`);
      setActions(Array.isArray(res.actions) ? res.actions : []);
      setActionCounts(res.counts);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function refreshNow() {
    setRefreshing(true);
    setError("");
    try {
      const res = await api<OpsRefreshResponse>("/api/ops/refresh", { method: "POST", body: JSON.stringify({}) });
      setOverview(res.overview);
      setActionCounts(res.overview.queue.actions);
      await loadActions(actionFilter);

      const checks = [res.refresh.digest.ok, res.refresh.audit.ok, res.refresh.controlTower.ok, res.refresh.workstream.ok];
      if (!checks.every(Boolean)) {
        setError("Refresh completed with issues. Check timeline and capability/runbook cards.");
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setRefreshing(false);
    }
  }

  async function updateActionStatus(actionId: string, status: "confirmed" | "cancelled" | "completed") {
    setBusyActionId(actionId);
    setError("");
    try {
      const res = await api<OpsActionUpdateResponse>(`/api/ops/actions/${encodeURIComponent(actionId)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      setOverview(res.overview);
      setActionCounts(res.overview.queue.actions);
      await loadActions(actionFilter);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyActionId(null);
    }
  }

  async function updateTriageStatus(item: TriageItem, status: "completed" | "dismissed" | "open") {
    setBusyTriageId(item.id);
    setError("");
    try {
      await api(`/api/triage/items/${encodeURIComponent(item.id)}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      await loadOverview();
      await loadActions(actionFilter);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyTriageId(null);
    }
  }

  async function runRunbook(runbookId: string) {
    setBusyRunbookId(runbookId);
    setError("");
    try {
      await api(`/api/runbooks/${encodeURIComponent(runbookId)}/run-now`, { method: "POST", body: JSON.stringify({}) });
      await loadOverview();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusyRunbookId(null);
    }
  }

  async function launchMicrosoftOps() {
    if (!onLaunchMicrosoftOps) return;
    setBusyMicrosoftOps(true);
    setError("");
    try {
      await onLaunchMicrosoftOps();
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to start Microsoft Ops chat"));
    } finally {
      setBusyMicrosoftOps(false);
    }
  }

  async function loadFlowRegistry() {
    try {
      const res = await api<OpsFlowRegistryResponse>("/api/ops/flows");
      setFlowRegistry(res);
    } catch (e: any) {
      setIntentError(String(e?.message || e || "Unable to load flow registry"));
    }
  }

  async function resolveIntentPlan() {
    setIntentBusy(true);
    setIntentError("");
    setIntentExecution(null);
    try {
      const parsedInputs = parseInputsJson(intentInputs);
      if (!parsedInputs.ok) throw new Error(parsedInputs.error || "Invalid inputs");
      const text = intentText.trim();
      if (!text) throw new Error("Enter an intent to resolve.");

      const payload: Record<string, any> = { text, inputs: parsedInputs.value };
      if (intentFixMode === "true") payload.fixIntent = true;
      if (intentFixMode === "false") payload.fixIntent = false;

      const res = await api<OpsResolveIntentResponse>("/api/ops/resolve-intent", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setIntentPlan(res);
    } catch (e: any) {
      setIntentError(String(e?.message || e || "Unable to resolve intent"));
    } finally {
      setIntentBusy(false);
    }
  }

  async function executeIntentPlan() {
    setIntentBusy(true);
    setIntentError("");
    try {
      const parsedInputs = parseInputsJson(intentInputs);
      if (!parsedInputs.ok) throw new Error(parsedInputs.error || "Invalid inputs");
      const text = intentText.trim();
      if (!text) throw new Error("Enter an intent to execute.");

      const timeoutMs = Math.max(5000, Math.min(240000, Number(intentTimeoutMs) || 90000));
      const payload: Record<string, any> = {
        text,
        inputs: parsedInputs.value,
        runRepair: intentRunRepair,
        runVerify: intentRunVerify,
        timeoutMs,
      };
      if (intentFixMode === "true") payload.fixIntent = true;
      if (intentFixMode === "false") payload.fixIntent = false;

      const res = await api<OpsResolveIntentExecuteResponse>("/api/ops/resolve-intent/execute", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setIntentExecution(res);
      setIntentPlan({ ok: true, resolution: res.resolution, validation: res.validation });
      await loadOverview();
      await loadActions(actionFilter);
    } catch (e: any) {
      setIntentError(String(e?.message || e || "Unable to execute intent"));
    } finally {
      setIntentBusy(false);
    }
  }

  useEffect(() => {
    void loadOverview();
    void loadFlowRegistry();
  }, []);

  useEffect(() => {
    void loadActions(actionFilter);
  }, [actionFilter]);

  const channels = overview?.channels || [];
  const capabilities = overview?.capabilities?.items || [];
  const missingCapabilities = overview?.capabilities?.missing || [];
  const degradedCapabilities = overview?.capabilities?.degraded || [];
  const triageItems = overview?.triage || [];
  const runbooks = overview?.runbooks || [];
  const timeline = overview?.timeline || [];
  const controlFindings = overview?.findings?.controlTower?.findings || [];
  const workstreamFindings = overview?.findings?.workstream?.findings || [];
  const byAccount = overview?.byAccount?.rows || [];
  const byAccountSummary = overview?.byAccount?.summary || null;

  const queue = overview?.queue;
  const counts = actionCounts || queue?.actions || { total: 0, pending: 0, confirmed: 0, cancelled: 0, completed: 0 };

  const timelineTop = useMemo(() => timeline.slice(0, 30), [timeline]);
  const activeResolution: OpsFlowIntentResolution | null = intentExecution?.resolution || intentPlan?.resolution || null;
  const flowCount = flowRegistry?.validation?.stats?.flowCount || 0;
  const flowTriggerCount = flowRegistry?.validation?.stats?.triggerCount || 0;

  return (
    <section className="opsMain">
      <div className="opsTop">
        <div>
          <div className="opsTitle">OpenClaw Control Tower</div>
          <div className="opsSub">Unified channel health, action queue, triage backlog, runbooks, and capability coverage.</div>
          {overview?.health ? (
            <div className="opsInlineBadges">
              <span className={`opsHealthBadge ${healthClass(overview.health.level)}`}>{overview.health.level.toUpperCase()}</span>
              <span className="opsMuted">{overview.health.summary}</span>
              <span className="opsMuted">Generated: {fmtTs(overview.generatedAt)}</span>
            </div>
          ) : null}
        </div>
        <div className="opsTopActions">
          <button className="btn secondary" onClick={() => launchMicrosoftOps()} disabled={loading || refreshing || busyMicrosoftOps}>
            <Play size={16} />
            {busyMicrosoftOps ? "Starting..." : "Microsoft Ops"}
          </button>
          <button className="btn secondary" onClick={() => loadOverview()} disabled={loading || refreshing}>
            Reload
          </button>
          <button className="btn" onClick={() => refreshNow()} disabled={loading || refreshing}>
            <RefreshCw size={16} />
            {refreshing ? "Refreshing..." : "Refresh Signals"}
          </button>
        </div>
      </div>

      {loading ? <div className="opsBanner">Loading control tower...</div> : null}
      {error ? <div className="opsBanner error">{error}</div> : null}

      <div className="opsKpiGrid">
        <article className="opsKpiBlock">
          <span className="opsKpiLabel">Pending actions</span>
          <strong>{counts.pending}</strong>
        </article>
        <article className="opsKpiBlock">
          <span className="opsKpiLabel">Open triage</span>
          <strong>{queue?.triage?.open || 0}</strong>
        </article>
        <article className="opsKpiBlock">
          <span className="opsKpiLabel">Urgent triage</span>
          <strong>{queue?.triage?.urgentOpen || 0}</strong>
        </article>
        <article className="opsKpiBlock">
          <span className="opsKpiLabel">Runbook errors</span>
          <strong>{queue?.runbooks?.error || 0}</strong>
        </article>
      </div>

      <div className="opsGrid">
        <article className="opsCard opsCardWide">
          <div className="opsCardHeaderRow">
            <h3>Deterministic Flow Runner</h3>
            <div className="opsInlineBadges">
              <span className="opsMuted">Flows: {flowCount}</span>
              <span className="opsMuted">Triggers: {flowTriggerCount}</span>
              {activeResolution?.match?.id ? <span className="opsMuted">Matched: {activeResolution.match.id}</span> : null}
            </div>
          </div>

          <div className="opsIntentForm">
            <label htmlFor="ops-intent-text">Intent</label>
            <textarea
              id="ops-intent-text"
              className="opsIntentTextarea"
              rows={3}
              placeholder="Example: can you see why Geordie Shore hasnt downloaded on sonarr"
              value={intentText}
              onChange={(e) => setIntentText(e.target.value)}
            />
          </div>

          <div className="opsIntentControls">
            <label>
              <span>Fix intent</span>
              <select value={intentFixMode} onChange={(e) => setIntentFixMode(e.target.value as "auto" | "true" | "false")}>
                <option value="auto">Auto-detect</option>
                <option value="true">Force repair intent</option>
                <option value="false">Diagnosis only</option>
              </select>
            </label>
            <label>
              <span>Timeout (ms)</span>
              <input value={intentTimeoutMs} onChange={(e) => setIntentTimeoutMs(e.target.value)} />
            </label>
            <label className="opsIntentCheck">
              <input type="checkbox" checked={intentRunRepair} onChange={(e) => setIntentRunRepair(e.target.checked)} />
              <span>Run repair</span>
            </label>
            <label className="opsIntentCheck">
              <input type="checkbox" checked={intentRunVerify} onChange={(e) => setIntentRunVerify(e.target.checked)} />
              <span>Force verify phase</span>
            </label>
            <div className="opsActionBtns">
              <button className="btn secondary" disabled={intentBusy} onClick={() => void loadFlowRegistry()}>
                Reload Flows
              </button>
              <button className="btn secondary" disabled={intentBusy} onClick={() => void resolveIntentPlan()}>
                {intentBusy ? "Planning..." : "Plan"}
              </button>
              <button className="btn" disabled={intentBusy} onClick={() => void executeIntentPlan()}>
                {intentBusy ? "Executing..." : "Execute"}
              </button>
            </div>
          </div>

          <div className="opsIntentForm">
            <label htmlFor="ops-intent-inputs">Inputs (JSON object)</label>
            <textarea
              id="ops-intent-inputs"
              className="opsIntentTextarea"
              rows={4}
              value={intentInputs}
              onChange={(e) => setIntentInputs(e.target.value)}
            />
          </div>

          {intentError ? <div className="opsBanner error">{intentError}</div> : null}
          {flowRegistry?.registry?.flows?.length ? (
            <div className="opsMiniList">
              {flowRegistry.registry.flows.slice(0, 8).map((flow) => (
                <div key={flow.id} className="opsMiniItem info">
                  <strong>{flow.id}</strong> · {flow.title}
                </div>
              ))}
            </div>
          ) : null}

          {activeResolution?.plan ? (
            <div className="opsIntentPlanGrid">
              {(["diagnose", "repair", "verify"] as const).map((phaseKey) => {
                const phase = activeResolution.plan?.[phaseKey];
                if (!phase) return null;
                return (
                  <section key={phaseKey} className="opsIntentPhase">
                    <div className="opsCardHeaderRow">
                      <strong>{phaseKey.toUpperCase()}</strong>
                      <span className={`opsStatePill ${phase.ready ? "ok" : "warn"}`}>{phase.ready ? "ready" : "blocked"}</span>
                    </div>
                    {"enabled" in phase && phase.enabled === false ? <div className="opsMuted">{phase.reason || "Phase disabled."}</div> : null}
                    {phase.missingInputs?.length ? <div className="opsMuted">Missing inputs: {phase.missingInputs.join(", ")}</div> : null}
                    <div className="opsTableWrap">
                      <table className="opsTable">
                        <thead>
                          <tr>
                            <th>Step</th>
                            <th>Kind</th>
                            <th>State</th>
                            <th>Command / Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {phase.steps.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="opsMuted">
                                No steps.
                              </td>
                            </tr>
                          ) : (
                            phase.steps.map((step) => (
                              <tr key={`${phaseKey}-${step.id}`}>
                                <td>{step.id}</td>
                                <td>{step.kind}</td>
                                <td>{planStepState(step)}</td>
                                <td>{step.kind === "note" ? step.note || step.template || "-" : step.run || "-"}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          ) : null}

          {intentExecution ? (
            <div className="opsIntentExecution">
              <div className="opsCardHeaderRow">
                <strong>Execution Contract</strong>
                <span className={`opsStatePill ${flowStatusClass(intentExecution.response.status)}`}>{intentExecution.response.status}</span>
              </div>
              <div className="opsIntentContractBlocks">
                <article className="opsIntentContractBlock">
                  <div className="opsKpiLabel">Diagnosis</div>
                  <div>{intentExecution.response.diagnosis}</div>
                </article>
                <article className="opsIntentContractBlock">
                  <div className="opsKpiLabel">Next action</div>
                  <div>{intentExecution.response.nextAction}</div>
                </article>
              </div>
              <div className="opsIntentContractBlocks">
                <article className="opsIntentContractBlock">
                  <div className="opsKpiLabel">Evidence</div>
                  <ul className="opsList">
                    {intentExecution.response.evidence.map((line, idx) => (
                      <li key={`evidence-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </article>
                <article className="opsIntentContractBlock">
                  <div className="opsKpiLabel">Actions</div>
                  <ul className="opsList">
                    {intentExecution.response.actions.map((line, idx) => (
                      <li key={`actions-${idx}`}>{line}</li>
                    ))}
                  </ul>
                </article>
              </div>
              <div className="opsIntentPlanGrid">
                {(["diagnose", "repair", "verify"] as const).map((phaseKey) => {
                  const phaseSteps = intentExecution.execution.phases[phaseKey] || [];
                  const summary = intentExecution.execution.summaries[phaseKey];
                  return (
                    <section key={`exec-${phaseKey}`} className="opsIntentPhase">
                      <div className="opsCardHeaderRow">
                        <strong>{phaseKey.toUpperCase()} Results</strong>
                        <span className="opsMuted">
                          ok {summary.ok} · fail {summary.failed} · skip {summary.skipped} · {fmtDuration(summary.durationMs)}
                        </span>
                      </div>
                      <div className="opsTableWrap">
                        <table className="opsTable">
                          <thead>
                            <tr>
                              <th>Step</th>
                              <th>Status</th>
                              <th>Command / Note</th>
                              <th>Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {phaseSteps.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="opsMuted">
                                  No execution steps.
                                </td>
                              </tr>
                            ) : (
                              phaseSteps.map((step) => (
                                <tr key={`exec-row-${phaseKey}-${step.id}`}>
                                  <td>{step.id}</td>
                                  <td>
                                    <span className={`opsStatePill ${execStepClass(step)}`}>{step.status}</span>
                                  </td>
                                  <td>{step.kind === "note" ? step.note || "-" : step.command || "-"}</td>
                                  <td>{step.reason || "-"}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  );
                })}
              </div>
            </div>
          ) : null}
        </article>

        <article className="opsCard opsCardWide">
          <h3>By Account Pipeline</h3>
          {byAccountSummary ? (
            <div className="opsInlineBadges">
              <span className="opsMuted">Accounts: {byAccountSummary.accounts}</span>
              <span className="opsMuted">Open triage: {byAccountSummary.triageOpen}</span>
              <span className="opsMuted">Pending actions: {byAccountSummary.actionsPending}</span>
              <span className="opsMuted">Confirmed actions: {byAccountSummary.actionsConfirmed}</span>
              <span className="opsMuted">Draft pending: {byAccountSummary.draftPending}</span>
            </div>
          ) : null}
          <div className="opsTableWrap">
            <table className="opsTable">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Triage (open/urgent)</th>
                  <th>Triage split</th>
                  <th>Actions (pending/confirmed)</th>
                  <th>Drafts (pending/confirmed)</th>
                  <th>Closed actions</th>
                </tr>
              </thead>
              <tbody>
                {byAccount.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="opsMuted">
                      No account-level pipeline data yet.
                    </td>
                  </tr>
                ) : (
                  byAccount.map((row) => (
                    <tr key={row.accountKey}>
                      <td>{row.accountKey}</td>
                      <td>
                        {row.triageOpen} / {row.triageUrgent}
                      </td>
                      <td>
                        next_action {row.triageNextAction} · quick_read {row.triageQuickRead}
                      </td>
                      <td>
                        {row.actionsPending} / {row.actionsConfirmed}
                      </td>
                      <td>
                        {row.draftPending} / {row.draftConfirmed}
                      </td>
                      <td>
                        done {row.actionsCompleted} · cancelled {row.actionsCancelled}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="opsCard">
          <h3>Channels</h3>
          <div className="opsTableWrap">
            <table className="opsTable">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>State</th>
                  <th>Account</th>
                  <th>Last Inbound</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {channels.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="opsMuted">
                      No channel data yet.
                    </td>
                  </tr>
                ) : (
                  channels.map((c) => (
                    <tr key={`${c.channel}-${c.accountId}`}>
                      <td>{c.channel}</td>
                      <td>
                        <span className={`opsStatePill ${c.state}`}>{c.state}</span>
                      </td>
                      <td>{c.accountId}</td>
                      <td>{fmtTs(c.lastInboundAt)}</td>
                      <td>{ellipsize(c.lastError || "-", 90)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="opsCard">
          <h3>Capabilities</h3>
          <div className="opsHealthList">
            <div>
              <CheckCircle2 size={14} /> Healthy: {overview?.capabilities?.summary?.healthy || 0}/{overview?.capabilities?.summary?.total || 0}
            </div>
            <div>
              <AlertTriangle size={14} /> Missing: {missingCapabilities.length}
            </div>
            <div>
              <CircleDashed size={14} /> Degraded: {degradedCapabilities.length}
            </div>
          </div>
          {missingCapabilities.length ? (
            <div className="opsMiniList">
              {missingCapabilities.slice(0, 6).map((c) => (
                <div key={c.id} className="opsMiniItem warn">
                  {c.id}
                </div>
              ))}
            </div>
          ) : (
            <div className="opsMuted">No missing capabilities.</div>
          )}
          {degradedCapabilities.length ? (
            <div className="opsMiniList">
              {degradedCapabilities.slice(0, 6).map((c) => (
                <div key={c.id} className="opsMiniItem info">
                  {c.id}
                </div>
              ))}
            </div>
          ) : null}
          <div className="opsMuted">Capability entries indexed: {capabilities.length}</div>
        </article>

        <article className="opsCard opsCardWide">
          <div className="opsCardHeaderRow">
            <h3>Action Inbox</h3>
            <div className="opsFilterRow">
              {(["pending", "confirmed", "completed", "cancelled", "all"] as ActionFilter[]).map((f) => (
                <button key={f} className={`btn tiny${actionFilter === f ? " secondary" : ""}`} onClick={() => setActionFilter(f)}>
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="opsTableWrap">
            <table className="opsTable">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Status</th>
                  <th>Intent</th>
                  <th>Summary</th>
                  <th>Channel/Contact</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {actions.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="opsMuted">
                      No actions for this filter.
                    </td>
                  </tr>
                ) : (
                  actions.map((a) => {
                    const nextButtons = actionButtonsFor(a.status);
                    return (
                      <tr key={a.id}>
                        <td>{a.id}</td>
                        <td>
                          <span className={`opsStatePill ${a.status === "completed" ? "ok" : a.status === "cancelled" ? "warn" : a.status === "confirmed" ? "info" : "pending"}`}>{a.status}</span>
                        </td>
                        <td>{a.intent}</td>
                        <td>{ellipsize(a.summary, 120)}</td>
                        <td>{a.channel} / {a.contact}</td>
                        <td>{fmtTs(a.createdAt)}</td>
                        <td>
                          <div className="opsActionBtns">
                            {nextButtons.length === 0 ? (
                              <span className="opsMuted">-</span>
                            ) : (
                              nextButtons.map((st) => (
                                <button
                                  key={`${a.id}-${st}`}
                                  className={`btn tiny${st === "cancelled" ? " danger" : ""}`}
                                  disabled={busyActionId === a.id}
                                  onClick={() => updateActionStatus(a.id, st)}
                                >
                                  {busyActionId === a.id ? "..." : actionButtonLabel(st)}
                                </button>
                              ))
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="opsCard opsCardWide">
          <h3>Open Triage Queue</h3>
          <div className="opsTableWrap">
            <table className="opsTable">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Kind</th>
                  <th>Title</th>
                  <th>Summary</th>
                  <th>Runbook</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {triageItems.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="opsMuted">
                      No open triage items.
                    </td>
                  </tr>
                ) : (
                  triageItems.slice(0, 40).map((item) => (
                    <tr key={item.id}>
                      <td>{priorityLabel(item.priority)} ({item.priority})</td>
                      <td>{item.kind}</td>
                      <td>{item.title}</td>
                      <td>{ellipsize(stripMd(item.summaryMd), 140)}</td>
                      <td>{item.runbookId || "manual"}</td>
                      <td>{fmtTs(item.updatedAt)}</td>
                      <td>
                        <div className="opsActionBtns">
                          <button className="btn tiny" disabled={busyTriageId === item.id} onClick={() => updateTriageStatus(item, "completed")}>Done</button>
                          <button className="btn tiny danger" disabled={busyTriageId === item.id} onClick={() => updateTriageStatus(item, "dismissed")}>Dismiss</button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="opsCard opsCardWide">
          <h3>Runbooks</h3>
          <div className="opsTableWrap">
            <table className="opsTable">
              <thead>
                <tr>
                  <th>Runbook</th>
                  <th>Status</th>
                  <th>Schedule</th>
                  <th>Last run</th>
                  <th>Next run</th>
                  <th>Error</th>
                  <th>Run now</th>
                </tr>
              </thead>
              <tbody>
                {runbooks.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="opsMuted">
                      No runbooks found.
                    </td>
                  </tr>
                ) : (
                  runbooks.map((rb) => (
                    <tr key={rb.runbookId}>
                      <td>{rb.runbookId}</td>
                      <td>
                        <span className={`opsStatePill ${rb.lastStatus === "ok" ? "ok" : rb.lastStatus === "error" ? "critical" : rb.stale ? "warn" : "info"}`}>
                          {rb.lastStatus}
                        </span>
                      </td>
                      <td>{rb.everyMinutes ? `every ${rb.everyMinutes}m` : "manual"}</td>
                      <td>{fmtTs(rb.lastRunAt)}</td>
                      <td>{fmtTs(rb.nextRunAt)}</td>
                      <td>{ellipsize(rb.lastError || "-", 120)}</td>
                      <td>
                        <button className="btn tiny" disabled={busyRunbookId === rb.runbookId} onClick={() => runRunbook(rb.runbookId)}>
                          <Play size={12} /> {busyRunbookId === rb.runbookId ? "Running..." : "Run"}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </article>

        <article className="opsCard">
          <h3>Control Tower Findings</h3>
          {controlFindings.length === 0 ? (
            <div className="opsMuted">No control tower findings.</div>
          ) : (
            <ul className="opsList">
              {controlFindings.slice(0, 10).map((f) => (
                <li key={f.source_key}>
                  <strong>{f.title}</strong>
                  <div className="opsMuted">{ellipsize(stripMd(f.summary_md), 150)}</div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="opsCard">
          <h3>Workstream Findings</h3>
          {workstreamFindings.length === 0 ? (
            <div className="opsMuted">No workstream findings.</div>
          ) : (
            <ul className="opsList">
              {workstreamFindings.slice(0, 10).map((f) => (
                <li key={f.source_key}>
                  <strong>{f.title}</strong>
                  <div className="opsMuted">{ellipsize(stripMd(f.summary_md), 150)}</div>
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="opsCard opsCardWide">
          <h3>Timeline</h3>
          {timelineTop.length === 0 ? (
            <div className="opsMuted">No timeline events yet.</div>
          ) : (
            <div className="opsTimeline">
              {timelineTop.map((ev) => (
                <div key={ev.id} className="opsTimelineRow">
                  <span className={`opsStateDot ${eventSeverityClass(ev.severity)}`} />
                  <div className="opsTimelineBody">
                    <div className="opsTimelineTitle">{ev.title}</div>
                    <div className="opsTimelineMeta">
                      {fmtTs(ev.ts)} · {ev.source}
                      {ev.detail ? ` · ${ellipsize(ev.detail, 180)}` : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="opsCard opsCardWide">
          <h3>Quick CLI</h3>
          <div className="opsCodeBlock">
            <code>/opt/homebrew/bin/node tools/ops/openclaw_capability_audit.mjs --run-tests</code>
            <code>/opt/homebrew/bin/node tools/ops/openclaw_digest.mjs --json</code>
            <code>/opt/homebrew/bin/node tools/message-automation/actions.mjs list --status pending</code>
            <code>/opt/homebrew/bin/node tools/triage/triage.mjs list --status open</code>
          </div>
        </article>
      </div>
    </section>
  );
}

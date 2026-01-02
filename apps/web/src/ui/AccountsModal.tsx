import { Check, Copy, KeyRound, LogOut, Trash2, UserPlus, X } from "lucide-react";
import React, { useMemo, useState } from "react";
import { api } from "../api/client";
import type { CodexAccountsResponse, ContextMetrics, TaskEvent } from "../api/types";

type CreateProfileResponse = { ok: true; profileId: string };
type ActivateResponse = { ok: true };
type StartLoginResponse = { ok: true; taskId: string };
type LogoutResponse = { ok: true };
type DeleteResponse = { ok: true };
type UpdatePrefsResponse = {
  ok: true;
  runner: {
    sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
    reasoningEffort: "" | "none" | "low" | "medium" | "high";
  };
};

function useTaskStream(taskId: string | null) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [device, setDevice] = useState<{ url: string; code: string } | null>(null);
  const [done, setDone] = useState<{ ok: boolean; exitCode: number | null } | null>(null);

  React.useEffect(() => {
    if (!taskId) return;

    const es = new EventSource(`/api/tasks/${taskId}/events`);
    es.addEventListener("message", (e) => {
      const ev = JSON.parse((e as MessageEvent).data) as TaskEvent;
      setEvents((prev) => [...prev, ev]);
      if (ev.type === "device") setDevice({ url: ev.url, code: ev.code });
      if (ev.type === "done") setDone({ ok: ev.ok, exitCode: ev.exitCode });
    });
    es.addEventListener("error", () => {
      // Let the server close it.
    });
    return () => es.close();
  }, [taskId]);

  return { events, device, done };
}

export function AccountsModal({
  onClose,
  accounts,
  refreshAccounts,
  contextMetrics,
}: {
  onClose: () => void;
  accounts: CodexAccountsResponse | null;
  refreshAccounts: () => Promise<void>;
  contextMetrics: ContextMetrics | null;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
  const { device, events, done } = useTaskStream(loginTaskId);

  const activeId = accounts?.activeProfileId ?? null;
  const [sandboxMode, setSandboxMode] = useState<UpdatePrefsResponse["runner"]["sandboxMode"]>("read-only");
  const [reasoningEffort, setReasoningEffort] = useState<UpdatePrefsResponse["runner"]["reasoningEffort"]>("");

  React.useEffect(() => {
    if (!accounts?.runner) return;
    setSandboxMode(accounts.runner.sandboxMode);
    setReasoningEffort(accounts.runner.reasoningEffort);
  }, [accounts?.runner?.sandboxMode, accounts?.runner?.reasoningEffort]);

  const active = useMemo(() => {
    if (!activeId) return null;
    return accounts?.profiles.find((p) => p.id === activeId) ?? null;
  }, [accounts, activeId]);

  const activeUsage = useMemo(() => {
    if (!active) return null;
    const inTok = Number(active.totalInputTokens) || 0;
    const cachedTok = Number(active.totalCachedInputTokens) || 0;
    const outTok = Number(active.totalOutputTokens) || 0;
    const totalTok = inTok + cachedTok + outTok;
    const cost = Number(active.totalCostUsd) || 0;
    return { inTok, cachedTok, outTok, totalTok, cost, updatedAt: active.totalCostUpdatedAt };
  }, [active]);

  async function createProfile() {
    const label = newLabel.trim();
    if (!label) return;
    await api<CreateProfileResponse>("/api/accounts/codex", { method: "POST", body: JSON.stringify({ label }) });
    setNewLabel("");
    await refreshAccounts();
  }

  async function activate(profileId: string) {
    await api<ActivateResponse>(`/api/accounts/codex/${profileId}/activate`, { method: "POST", body: "{}" });
    await refreshAccounts();
  }

  async function startLogin(profileId: string) {
    setLoginTaskId(null);
    const res = await api<StartLoginResponse>(`/api/accounts/codex/${profileId}/login/start`, {
      method: "POST",
      body: "{}",
    });
    setLoginTaskId(res.taskId);
  }

  async function logout(profileId: string) {
    await api<LogoutResponse>(`/api/accounts/codex/${profileId}/logout`, { method: "POST", body: "{}" });
    await refreshAccounts();
  }

  async function remove(profileId: string) {
    if (!confirm("Remove this account from Friday? (This does not automatically cancel billing.)")) return;
    await api<DeleteResponse>(`/api/accounts/codex/${profileId}`, { method: "DELETE" });
    await refreshAccounts();
  }

  async function savePrefs() {
    await api<UpdatePrefsResponse>("/api/accounts/codex/prefs", {
      method: "POST",
      body: JSON.stringify({ sandboxMode, reasoningEffort }),
    });
    await refreshAccounts();
  }

  return (
    <div className="modalOverlay" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modalHeader">
          <div className="modalTitle">Settings · Accounts</div>
          <button className="btn iconBtn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        </div>
        <div className="modalBody">
          <div className="row">
            <div>
              <div style={{ fontWeight: 700 }}>ChatGPT / Codex</div>
              <div className="muted">Multiple Codex profiles (shared globally). Active profile is used for the runner.</div>
            </div>
            <div className="pill pillActive">{active ? `Active: ${active.label}` : "No active"}</div>
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 700 }}>Overview</div>
            <div className="muted">
              Context size:{" "}
              {contextMetrics
                ? `${contextMetrics.files} files · ${contextMetrics.chars.toLocaleString()} chars (~${contextMetrics.approxTokens.toLocaleString()} tokens)`
                : "unknown"}
            </div>
            {active && activeUsage ? (
              <div className="muted">
                Active account auth: {active.authMode === "api_key" ? "API key (metered)" : active.authMode}
                {" · "}
                Usage: {activeUsage.totalTok.toLocaleString()} tokens
                {activeUsage.cost > 0
                  ? ` · $${activeUsage.cost.toFixed(2)}`
                  : active.authMode === "api_key" && activeUsage.totalTok > 0
                    ? " · cost unknown (set METERED_USD_PER_1K_* in .env)"
                    : ""}
              </div>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ fontWeight: 700 }}>Runner preferences</div>
            <div className="row">
              <label style={{ flex: 1, display: "grid", gap: 6 }}>
                <div className="muted">Access mode</div>
                <select className="input" value={sandboxMode} onChange={(e) => setSandboxMode(e.target.value as any)}>
                  <option value="read-only">Read-only</option>
                  <option value="workspace-write">Workspace write</option>
                  <option value="danger-full-access">Danger full access</option>
                </select>
              </label>
              <label style={{ flex: 1, display: "grid", gap: 6 }}>
                <div className="muted">Reasoning level</div>
                <select
                  className="input"
                  value={reasoningEffort}
                  onChange={(e) => setReasoningEffort(e.target.value as any)}
                >
                  <option value="">Default</option>
                  <option value="none">None</option>
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </label>
              <button className="btn" onClick={() => savePrefs()}>
                Save
              </button>
            </div>
            <div className="muted">These persist in Friday and apply to new messages.</div>
          </div>

          <div className="row">
            <input
              className="input"
              placeholder="New account label (e.g. Plus, Business A)"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
            />
            <button className="btn" onClick={() => createProfile()}>
              <UserPlus size={16} />
              Add
            </button>
            <button className="btn" onClick={() => refreshAccounts()}>
              Refresh
            </button>
          </div>

          {(accounts?.profiles || []).map((p) => (
            <div key={p.id} className="row">
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ fontWeight: 700 }}>{p.label}</div>
                  {p.id === activeId ? <span className="pill pillActive">active</span> : <span className="pill">idle</span>}
                  {p.loggedIn ? <span className="pill pillActive">logged in</span> : <span className="pill">logged out</span>}
                </div>
                <div className="muted">{p.codexHomePath}</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" onClick={() => activate(p.id)} disabled={p.id === activeId}>
                  <Check size={16} />
                  Set active
                </button>
                <button className="btn secondary" onClick={() => startLogin(p.id)}>
                  <KeyRound size={16} />
                  Login with code
                </button>
                <button className="btn" onClick={() => logout(p.id)}>
                  <LogOut size={16} />
                  Logout
                </button>
                <button className="btn" onClick={() => remove(p.id)} title="Remove account">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}

          {loginTaskId ? (
            <>
              <div style={{ fontWeight: 700 }}>Login</div>
              {device ? (
                <>
                  <div className="muted">Open this URL, sign in, then enter the code:</div>
                  <pre className="pre">{device.url}</pre>
                  <div className="row">
                    <pre className="pre" style={{ flex: 1, margin: 0 }}>
                      {device.code}
                    </pre>
                    <button
                      className="btn"
                      onClick={async () => {
                        await navigator.clipboard.writeText(device.code);
                      }}
                      title="Copy code"
                    >
                      <Copy size={16} />
                      Copy
                    </button>
                  </div>
                </>
              ) : (
                <div className="muted">Waiting for device code…</div>
              )}

              <details>
                <summary className="muted">Logs</summary>
                <pre className="pre">{events.filter((e) => e.type === "log").map((e: any) => e.line).join("\n")}</pre>
              </details>

              {done ? (
                <div className="muted">{done.ok ? "Login complete." : `Login failed (exit ${done.exitCode ?? "?"}).`}</div>
              ) : (
                <div className="muted">Waiting for completion…</div>
              )}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

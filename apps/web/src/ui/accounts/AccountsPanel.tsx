import { Check, Copy, KeyRound, LogOut, Trash2, UserPlus } from "lucide-react";
import React, { useMemo, useState } from "react";
import { api } from "../../api/client";
import type {
  AssistantRunner,
  CodexAccountsResponse,
  ContextMetrics,
  GoogleAccountsResponse,
  MicrosoftAccountsResponse,
  RunnerSettingsResponse,
  VertexModelsResponse,
  TaskEvent,
} from "../../api/types";

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

type GoogleStartResponse = { ok: true; authUrl: string };
type GoogleDisconnectResponse = { ok: true };

type MicrosoftStartResponse = { ok: true; authUrl: string; accountKey: string };
type MicrosoftDisconnectResponse = { ok: true };

const OPENAI_MODEL_OPTIONS = ["gpt-4o-mini", "gpt-4o", "gpt-3.5-turbo-1106", "gpt-3.5-turbo", "gpt-5.2-2025-12-11", "gpt-5.2"] as const;
const VERTEX_AUTH_MODE_OPTIONS = [
  { value: "aws_secret" as const, label: "Service account (AWS secret/file)" },
  { value: "google_oauth" as const, label: "Google OAuth (work/personal)" },
] as const;

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

export function AccountsPanel({
  accounts,
  refreshAccounts,
  contextMetrics,
}: {
  accounts: CodexAccountsResponse | null;
  refreshAccounts: () => Promise<void>;
  contextMetrics: ContextMetrics | null;
}) {
  const [newLabel, setNewLabel] = useState("");
  const [loginTaskId, setLoginTaskId] = useState<string | null>(null);
  const { device, events, done } = useTaskStream(loginTaskId);
  const [googleAccounts, setGoogleAccounts] = useState<GoogleAccountsResponse | null>(null);
  const [microsoftAccounts, setMicrosoftAccounts] = useState<MicrosoftAccountsResponse | null>(null);
  const [msLabel, setMsLabel] = useState("");
  const [msKind, setMsKind] = useState("personal");
  const [msTenantId, setMsTenantId] = useState("");
  const [msConnecting, setMsConnecting] = useState(false);
  const [msError, setMsError] = useState<string | null>(null);
  const [runnerSettings, setRunnerSettings] = useState<RunnerSettingsResponse | null>(null);

  const [assistantRunner, setAssistantRunner] = useState<AssistantRunner>("codex");
  const [openaiModel, setOpenaiModel] = useState("");
  const [openaiBaseUrl, setOpenaiBaseUrl] = useState("");
  const [vertexModel, setVertexModel] = useState("");
  const [vertexAuthMode, setVertexAuthMode] = useState<"aws_secret" | "google_oauth">("aws_secret");
  const [vertexGoogleAccountKey, setVertexGoogleAccountKey] = useState<"work" | "personal">("work");
  const [vertexModels, setVertexModels] = useState<string[]>([]);
  const [vertexModelsLoading, setVertexModelsLoading] = useState(false);
  const [vertexModelsError, setVertexModelsError] = useState<string | null>(null);

  const activeId = accounts?.activeProfileId ?? null;
  const [sandboxMode, setSandboxMode] = useState<UpdatePrefsResponse["runner"]["sandboxMode"]>("read-only");
  const [reasoningEffort, setReasoningEffort] = useState<UpdatePrefsResponse["runner"]["reasoningEffort"]>("");

  React.useEffect(() => {
    if (!accounts?.runner) return;
    setSandboxMode(accounts.runner.sandboxMode);
    setReasoningEffort(accounts.runner.reasoningEffort);
  }, [accounts?.runner?.sandboxMode, accounts?.runner?.reasoningEffort]);

  async function refreshGoogle() {
    const res = await api<GoogleAccountsResponse>("/api/accounts/google");
    setGoogleAccounts(res);
  }

  async function refreshMicrosoft() {
    const res = await api<MicrosoftAccountsResponse>("/api/accounts/microsoft");
    setMicrosoftAccounts(res);
  }

  async function refreshRunnerSettings() {
    const res = await api<RunnerSettingsResponse>("/api/settings/runner");
    setRunnerSettings(res);
    setAssistantRunner(res.prefs.runner);
    setOpenaiModel(res.prefs.openai.model || "");
    setOpenaiBaseUrl(res.prefs.openai.baseUrl || "");
    setVertexModel(res.prefs.vertex.model || "");
    setVertexAuthMode((res.prefs.vertex.authMode as any) || "aws_secret");
    setVertexGoogleAccountKey((res.prefs.vertex.googleAccountKey as any) || "work");
  }

  async function refreshVertexModels() {
    setVertexModelsError(null);
    setVertexModelsLoading(true);
    try {
      const res = await api<VertexModelsResponse>("/api/models/vertex");
      setVertexModels(res.available || []);
      if (!vertexModel && Array.isArray(res.available) && res.available.length) {
        setVertexModel(res.available[0]);
      }
    } catch (e: any) {
      setVertexModelsError(String(e?.message || e));
      setVertexModels([]);
    } finally {
      setVertexModelsLoading(false);
    }
  }

  React.useEffect(() => {
    void refreshGoogle();
    void refreshMicrosoft();
    void refreshRunnerSettings();
    void refreshVertexModels();
  }, []);

  const active = useMemo(() => {
    if (!activeId) return null;
    return accounts?.profiles.find((p) => p.id === activeId) ?? null;
  }, [accounts, activeId]);

  const activeUsage = useMemo(() => {
    if (!active) return null;
    const inTok = Number(active.totalInputTokens) || 0;
    const cachedTok = Number(active.totalCachedInputTokens) || 0;
    const outTok = Number(active.totalOutputTokens) || 0;
    const totalTok = inTok + outTok; // cached tokens are a subset of input
    const uncachedTok = Math.max(0, inTok - cachedTok);
    const cost = active.totalCostUsd == null ? null : Number(active.totalCostUsd);
    const estimatedCost = active.estimatedTotalCostUsd == null ? null : Number(active.estimatedTotalCostUsd);
    return { inTok, cachedTok, uncachedTok, outTok, totalTok, cost, estimatedCost, updatedAt: active.totalCostUpdatedAt };
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

  async function saveRunner() {
    const res = await api<RunnerSettingsResponse>("/api/settings/runner", {
      method: "POST",
      body: JSON.stringify({
        runner: assistantRunner,
        openai: { model: openaiModel, baseUrl: openaiBaseUrl },
        vertex: { model: vertexModel, authMode: vertexAuthMode, googleAccountKey: vertexGoogleAccountKey },
      }),
    });
    setRunnerSettings(res);
    setAssistantRunner(res.prefs.runner);
    setOpenaiModel(res.prefs.openai.model || "");
    setOpenaiBaseUrl(res.prefs.openai.baseUrl || "");
    setVertexModel(res.prefs.vertex.model || "");
    setVertexAuthMode((res.prefs.vertex.authMode as any) || "aws_secret");
    setVertexGoogleAccountKey((res.prefs.vertex.googleAccountKey as any) || "work");
  }

  async function connectGoogle(accountKey: "work" | "personal", purpose: "default" | "vertex" = "default") {
    const res = await api<GoogleStartResponse>(`/api/accounts/google/${accountKey}/connect/start`, {
      method: "POST",
      body: JSON.stringify({ returnTo: "/", purpose }),
    });
    window.location.href = res.authUrl;
  }

  async function disconnectGoogle(accountKey: "work" | "personal") {
    await api<GoogleDisconnectResponse>(`/api/accounts/google/${accountKey}/disconnect`, { method: "POST", body: "{}" });
    await refreshGoogle();
  }

  async function connectMicrosoft() {
    const label = msLabel.trim();
    if (!label) return;
    setMsError(null);
    setMsConnecting(true);
    const kind = msKind.trim() || "personal";
    const tenantId = msTenantId.trim() || null;
    try {
      const res = await api<MicrosoftStartResponse>("/api/accounts/microsoft/connect/start", {
        method: "POST",
        body: JSON.stringify({ label, kind, tenantId, returnTo: "/" }),
      });
      window.location.href = res.authUrl;
    } catch (e: any) {
      const msg = String(e?.message || e || "Failed to start Microsoft connect");
      setMsError(msg);
    } finally {
      setMsConnecting(false);
    }
  }

  async function disconnectMicrosoft(accountKey: string) {
    await api<MicrosoftDisconnectResponse>(`/api/accounts/microsoft/${encodeURIComponent(accountKey)}/disconnect`, {
      method: "POST",
      body: "{}",
    });
    await refreshMicrosoft();
  }

  const vertexProjectId = runnerSettings?.prefs?.vertex?.projectId || "tmg-product-innovation-prod";
  const vertexLocation = runnerSettings?.prefs?.vertex?.location || "europe-west2";

  const selectedGoogle = useMemo(() => {
    const rows = googleAccounts?.accounts || [];
    return rows.find((a) => a.accountKey === vertexGoogleAccountKey) || null;
  }, [googleAccounts?.accounts, vertexGoogleAccountKey]);

  const selectedGoogleHasCloudPlatform = Boolean(
    selectedGoogle?.connected && String(selectedGoogle?.scopes || "").includes("https://www.googleapis.com/auth/cloud-platform"),
  );

  return (
    <div className="settingsSection">
      <section className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 700 }}>ChatGPT / Codex</div>
            <div className="pill pillActive">{active ? `Active: ${active.label}` : "No active"}</div>
          </div>
          <div className="muted">Multiple Codex profiles (shared globally). Active profile is used for the runner.</div>
        </div>

        <hr className="settingsDivider" />

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
              {activeUsage.cachedTok > 0 ? ` · ${activeUsage.cachedTok.toLocaleString()} cached` : ""}
              {activeUsage.cost != null && activeUsage.cost > 0
                ? ` · $${activeUsage.cost.toFixed(2)}`
                : activeUsage.estimatedCost != null && activeUsage.estimatedCost > 0
                  ? ` · ~$${activeUsage.estimatedCost.toFixed(2)}`
                  : active.authMode === "api_key" && activeUsage.totalTok > 0
                    ? " · cost unknown (set METERED_USD_PER_1K_* in .env)"
                    : ""}
            </div>
          ) : null}
        </div>

        <hr className="settingsDivider" />

        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontWeight: 700 }}>Runner preferences</div>
          <div className="row wrap">
            <label style={{ flex: 1, minWidth: 220, display: "grid", gap: 6 }}>
              <div className="muted">Access mode</div>
              <select className="input" value={sandboxMode} onChange={(e) => setSandboxMode(e.target.value as any)}>
                <option value="read-only">Read-only</option>
                <option value="workspace-write">Workspace write</option>
                <option value="danger-full-access">Danger full access</option>
              </select>
            </label>
            <label style={{ flex: 1, minWidth: 220, display: "grid", gap: 6 }}>
              <div className="muted">Reasoning level</div>
              <select className="input" value={reasoningEffort} onChange={(e) => setReasoningEffort(e.target.value as any)}>
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
      </section>

      <section className="settingsCard">
        <div className="settingsCardHeader">
          <div style={{ fontWeight: 700 }}>Assistant runner</div>
          <div className="muted">Select which model/provider Friday uses for new messages.</div>
        </div>

        {runnerSettings?.env?.FRIDAY_RUNNER && runnerSettings.env.FRIDAY_RUNNER !== "settings" ? (
          <div className="muted">
            Environment override active: <span className="pill">{runnerSettings.env.FRIDAY_RUNNER}</span> (set `FRIDAY_RUNNER=settings` to control from UI)
          </div>
        ) : null}

        {runnerSettings?.effective ? (
          <div className="muted">
            Effective runner: <span className="pill pillActive">{runnerSettings.effective.runner}</span> · source:{" "}
            <span className="pill">{runnerSettings.effective.source}</span>
          </div>
        ) : null}

        <div className="row wrap">
          <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
            <div className="muted">Runner</div>
            <select className="input" value={assistantRunner} onChange={(e) => setAssistantRunner(e.target.value as any)}>
              <option value="codex">Codex (seat)</option>
              <option value="vertex">Google (Gemini via Vertex)</option>
              <option value="openai">OpenAI (metered)</option>
              <option value="auto">Auto (Codex → OpenAI)</option>
              <option value="noop">Noop (disabled)</option>
            </select>
          </label>
          <button className="btn" onClick={() => saveRunner()}>
            Save
          </button>
          <button className="btn secondary" onClick={() => refreshRunnerSettings()}>
            Refresh
          </button>
        </div>

        <details>
          <summary className="muted">Provider settings</summary>
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>OpenAI</div>
              <div className="row wrap">
                <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
                  <div className="muted">Model</div>
                  <select className="input" value={openaiModel} onChange={(e) => setOpenaiModel(e.target.value)}>
                    <option value="">Default</option>
                    {OPENAI_MODEL_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {openaiModel && !(OPENAI_MODEL_OPTIONS as readonly string[]).includes(openaiModel) ? (
                      <option value={openaiModel}>Custom: {openaiModel}</option>
                    ) : null}
                  </select>
                </label>
              </div>
              <div className="muted">API key stays in `.env` as `OPENAI_API_KEY`.</div>
              <details>
                <summary className="muted">Advanced</summary>
                <div className="row wrap" style={{ marginTop: 10 }}>
                  <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
                    <div className="muted">Base URL (optional)</div>
                    <input
                      className="input"
                      value={openaiBaseUrl}
                      onChange={(e) => setOpenaiBaseUrl(e.target.value)}
                      placeholder="https://api.openai.com"
                    />
                  </label>
                </div>
                <div className="muted">Only needed for OpenAI-compatible proxies/self-hosted endpoints.</div>
              </details>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontWeight: 700 }}>Google (Vertex)</div>
              <div className="row wrap">
                <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
                  <div className="muted">Model</div>
                  <select
                    className="input"
                    value={vertexModel}
                    onChange={(e) => setVertexModel(e.target.value)}
                    disabled={vertexModelsLoading}
                    title={vertexModelsLoading ? "Loading models…" : undefined}
                  >
                    <option value="">Default</option>
                    {vertexModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                    {vertexModel && !vertexModels.includes(vertexModel) ? <option value={vertexModel}>Custom: {vertexModel}</option> : null}
                  </select>
                </label>
                <button className="btn secondary" onClick={() => refreshVertexModels()} disabled={vertexModelsLoading}>
                  {vertexModelsLoading ? "Loading…" : "Refresh models"}
                </button>
              </div>
              <div className="row wrap">
                <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
                  <div className="muted">Auth</div>
                  <select className="input" value={vertexAuthMode} onChange={(e) => setVertexAuthMode(e.target.value as any)}>
                    {VERTEX_AUTH_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {vertexAuthMode === "google_oauth" ? (
                  <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
                    <div className="muted">Google account</div>
                    <select
                      className="input"
                      value={vertexGoogleAccountKey}
                      onChange={(e) => setVertexGoogleAccountKey(e.target.value as any)}
                    >
                      <option value="work">work</option>
                      <option value="personal">personal</option>
                    </select>
                  </label>
                ) : null}
              </div>
              <div className="muted">
                Project: <code>{vertexProjectId}</code> · Location: <code>{vertexLocation}</code>
              </div>
              {vertexModelsError ? <div className="muted">Model discovery error: {vertexModelsError}</div> : null}
              {vertexAuthMode === "google_oauth" ? (
                <div className="muted" style={{ display: "grid", gap: 6 }}>
                  <div>
                    Uses your connected Google account’s OAuth token. Vertex requires{" "}
                    <code>https://www.googleapis.com/auth/cloud-platform</code>.
                  </div>
                  {!selectedGoogle?.connected ? (
                    <div className="row wrap">
                      <div className="muted">Not connected: <code>{vertexGoogleAccountKey}</code></div>
                      <button className="btn secondary" onClick={() => connectGoogle(vertexGoogleAccountKey, "vertex")}>
                        Connect + enable Vertex
                      </button>
                    </div>
                  ) : !selectedGoogleHasCloudPlatform ? (
                    <div className="row wrap">
                      <div className="muted">Connected, but missing Vertex scope.</div>
                      <button className="btn secondary" onClick={() => connectGoogle(vertexGoogleAccountKey, "vertex")}>
                        Enable Vertex scope
                      </button>
                    </div>
                  ) : (
                    <div className="muted">OAuth scopes look OK for Vertex.</div>
                  )}
                </div>
              ) : (
                <div className="muted">Auth stays in `.env` (recommended: `VERTEX_AWS_SECRET_ID` + `VERTEX_AWS_PROFILE=telegraph`).</div>
              )}
            </div>
          </div>
        </details>
      </section>

      <section className="settingsCard">
        <div className="settingsCardHeader">
          <div style={{ fontWeight: 700 }}>Codex profiles</div>
          <div className="muted">Add/remove accounts and switch the active profile.</div>
        </div>

        <div className="row wrap">
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

        {(accounts?.profiles || []).length ? <hr className="settingsDivider" /> : null}

      {(accounts?.profiles || []).map((p) => (
        <div key={p.id} className="row wrap">
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 700 }}>{p.label}</div>
              {p.id === activeId ? <span className="pill pillActive">active</span> : <span className="pill">idle</span>}
              {p.loggedIn ? <span className="pill pillActive">logged in</span> : <span className="pill">logged out</span>}
              {p.authMode === "api_key" ? <span className="pill">api key</span> : null}
            </div>
            <div className="muted">{p.codexHomePath}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
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
      </section>

      <section className="settingsCard">
        <div className="settingsCardHeader">
          <div style={{ fontWeight: 700 }}>Google</div>
          <div className="muted">Connect work and personal Google accounts. Tokens are stored server-side.</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          {(googleAccounts?.accounts || [
            { accountKey: "work" as const, connected: false },
            { accountKey: "personal" as const, connected: false },
          ]).map((ga) => (
            <div key={ga.accountKey} className="row wrap">
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{ga.accountKey}</div>
                  {ga.connected ? <span className="pill pillActive">connected</span> : <span className="pill">not connected</span>}
                  {ga.connected && ga.email ? <span className="pill">{ga.email}</span> : null}
                  {ga.connected && String(ga.scopes || "").includes("https://www.googleapis.com/auth/cloud-platform") ? (
                    <span className="pill pillActive">vertex</span>
                  ) : null}
                </div>
                {ga.connected && ga.scopes ? <div className="muted">{ga.scopes}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                {ga.connected ? (
                  <>
                    {String(ga.scopes || "").includes("https://www.googleapis.com/auth/cloud-platform") ? null : (
                      <button className="btn secondary" onClick={() => connectGoogle(ga.accountKey, "vertex")}>
                        Enable Vertex
                      </button>
                    )}
                    <button className="btn" onClick={() => disconnectGoogle(ga.accountKey)}>
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button className="btn secondary" onClick={() => connectGoogle(ga.accountKey)}>
                    Connect
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="row" style={{ justifyContent: "flex-start" }}>
          <button className="btn" onClick={() => refreshGoogle()}>
            Refresh Google status
          </button>
        </div>
      </section>

      <section className="settingsCard">
        <div className="settingsCardHeader">
          <div style={{ fontWeight: 700 }}>Microsoft</div>
          <div className="muted">Connect Microsoft accounts (Graph). Tokens are stored server-side.</div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div className="row wrap">
            <input
              className="input"
              placeholder="Label (e.g. family, kids-admin, spare)"
              value={msLabel}
              onChange={(e) => setMsLabel(e.target.value)}
              style={{ flex: 2, minWidth: 240 }}
            />
            <input
              className="input"
              placeholder="Kind (e.g. personal, family, admin)"
              value={msKind}
              onChange={(e) => setMsKind(e.target.value)}
              style={{ flex: 1, minWidth: 180 }}
            />
            <input
              className="input"
              placeholder="Tenant (optional; default common)"
              value={msTenantId}
              onChange={(e) => setMsTenantId(e.target.value)}
              style={{ flex: 1, minWidth: 220 }}
            />
            <button className="btn secondary" onClick={() => connectMicrosoft()} disabled={msConnecting}>
              Connect
            </button>
          </div>
          {msError ? <div className="muted">Microsoft connect error: {msError}</div> : null}

          {(microsoftAccounts?.accounts || []).length ? <hr className="settingsDivider" /> : null}

          {(microsoftAccounts?.accounts || []).map((ma) => (
            <div key={ma.accountKey} className="row wrap">
              <div style={{ display: "grid", gap: 2 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 700 }}>{ma.label || ma.accountKey}</div>
                  <span className="pill pillActive">connected</span>
                  {ma.kind ? <span className="pill">{ma.kind}</span> : null}
                  {ma.email ? <span className="pill">{ma.email}</span> : null}
                </div>
                <div className="muted">{ma.accountKey}</div>
                {ma.scopes ? <div className="muted">{ma.scopes}</div> : null}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button className="btn" onClick={() => disconnectMicrosoft(ma.accountKey)}>
                  Disconnect
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="row" style={{ justifyContent: "flex-start" }}>
          <button className="btn" onClick={() => refreshMicrosoft()}>
            Refresh Microsoft status
          </button>
        </div>
      </section>

      {loginTaskId ? (
        <section className="settingsCard">
          <div className="settingsCardHeader">
            <div style={{ fontWeight: 700 }}>Login</div>
            <div className="muted">Complete device auth for the selected Codex profile.</div>
          </div>
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
        </section>
      ) : null}
    </div>
  );
}

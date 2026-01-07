import { Play, RefreshCcw } from "lucide-react";
import React, { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { RunbookSummary, RunbooksResponse } from "../../api/types";

type RunNowResponse = { ok: true; results: any[] };
type RunNowAcceptedResponse = { ok: true; started: Array<{ accountKey: string; taskId: string }> };

export function ScheduledPanel() {
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([]);
  const [runningId, setRunningId] = useState<string | null>(null);

  async function refresh() {
    const res = await api<RunbooksResponse>("/api/runbooks");
    setRunbooks(res.runbooks);
  }

  async function patchRunbook(runbookId: string, patch: Partial<Pick<RunbookSummary, "enabled" | "everyMinutes" | "title" | "accounts">>) {
    await api<{ ok: true }>(`/api/runbooks/${runbookId}`, { method: "POST", body: JSON.stringify(patch) });
    await refresh();
  }

  async function runNow(runbookId: string) {
    setRunningId(runbookId);
    try {
      await api<RunNowAcceptedResponse>(`/api/runbooks/${runbookId}/run-now`, { method: "POST", body: "{}" });
    } finally {
      setRunningId(null);
      await refresh();
    }
  }

  useEffect(() => {
    void refresh();
    const t = setInterval(() => refresh().catch(() => {}), 20000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="settingsSection">
      <div className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 800 }}>Scheduled</div>
            <button className="btn" onClick={() => refresh()} title="Refresh">
              <RefreshCcw size={16} /> Refresh
            </button>
          </div>
          <div className="muted">Runbooks are Markdown files in `runbooks/automation/` (edit via chat or git).</div>
        </div>
      </div>

      {runbooks.map((rb) => (
        <div key={rb.id} className="settingsCard">
          <div className="settingsCardTitleRow">
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ fontWeight: 800 }}>{rb.title || rb.id}</div>
                {rb.enabled ? <span className="pill pillActive">enabled</span> : <span className="pill">disabled</span>}
                {rb.everyMinutes ? <span className="pill">every {rb.everyMinutes}m</span> : <span className="pill">no schedule</span>}
                <span className="pill">{rb.accounts.join(", ")}</span>
              </div>
              <div className="muted">
                {rb.lastRunAt ? `Last: ${new Date(rb.lastRunAt).toLocaleString()} (${rb.lastStatus || "?"})` : "Never run"}
                {rb.nextRunAt ? ` · Next: ${new Date(rb.nextRunAt).toLocaleString()}` : ""}
                {rb.lastError ? ` · ${rb.lastError}` : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <button className="btn" onClick={() => runNow(rb.id)} disabled={runningId === rb.id} title="Run now">
                <Play size={16} /> Run now
              </button>
            </div>
          </div>

          <div className="settingsDivider" />

          <div className="row wrap">
            <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
              <div className="muted">Enabled</div>
              <select
                className="input"
                value={rb.enabled ? "on" : "off"}
                onChange={(e) => patchRunbook(rb.id, { enabled: e.target.value === "on" })}
              >
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
            </label>

            <label style={{ flex: 1, minWidth: 240, display: "grid", gap: 6 }}>
              <div className="muted">Frequency (minutes)</div>
              <input
                className="input"
                inputMode="numeric"
                value={rb.everyMinutes ?? ""}
                placeholder="e.g. 60"
                onChange={(e) => patchRunbook(rb.id, { everyMinutes: e.target.value ? Number(e.target.value) : null })}
              />
            </label>
          </div>
        </div>
      ))}

      {runbooks.length === 0 ? <div className="muted">No runbooks found in `runbooks/automation/`.</div> : null}
    </div>
  );
}

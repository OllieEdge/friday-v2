import { FlaskConical, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";
import type {
  ModelLane,
  ModelRegistryCertifyResponse,
  ModelRegistryModel,
  ModelRegistryResponse,
  ModelRegistryRouting,
  ModelRegistryStore,
} from "../../api/types";

type PersonasResponse = {
  ok: true;
  personas: Array<{ id: string; label?: string }>;
};

const LANE_KEYS: ModelLane[] = ["triage", "planning", "coding", "highRisk", "ops"];
const PROVIDER_OPTIONS = ["vertex", "codex", "openai", "hybrid"];
const TIER_OPTIONS = ["low", "medium", "high"];

function toInt(value: any, fallback: number, min = 1, max = 1_000_000) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}

function cloneModel(model: ModelRegistryModel): ModelRegistryModel {
  return {
    ...model,
    capabilities: {
      ...model.capabilities,
    },
    certification: {
      ...model.certification,
      checks: Array.isArray(model.certification?.checks) ? [...model.certification.checks] : [],
    },
  };
}

function blankModel(): ModelRegistryModel {
  const ts = Date.now();
  return {
    id: `model-${ts}`,
    label: "New Model",
    provider: "vertex",
    model: "",
    enabled: true,
    capabilities: {
      planning: true,
      coding: false,
      toolCalling: false,
      longContext: false,
      maxContextTokens: 32768,
    },
    costTier: "medium",
    latencyTier: "medium",
    notes: "",
    certification: { status: "unknown", lastRunAt: null, lastOk: false, checks: [] },
    updatedAt: new Date().toISOString(),
  };
}

function sortModels(models: ModelRegistryModel[]) {
  return [...models].sort((a, b) => String(a.label || a.id).localeCompare(String(b.label || b.id)));
}

export function ModelsSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [filePath, setFilePath] = useState("");
  const [store, setStore] = useState<ModelRegistryStore | null>(null);
  const [routingDraft, setRoutingDraft] = useState<ModelRegistryRouting>({ laneDefaults: {}, personaOverrides: {} });
  const [selectedModelId, setSelectedModelId] = useState("");
  const [modelDraft, setModelDraft] = useState<ModelRegistryModel | null>(null);
  const [personas, setPersonas] = useState<Array<{ id: string; label?: string }>>([]);
  const [selectedPersonaId, setSelectedPersonaId] = useState("");

  const models = useMemo(() => sortModels(store?.models || []), [store]);
  const selectedModel = useMemo(
    () => models.find((m) => m.id === selectedModelId) || null,
    [models, selectedModelId],
  );

  const personaOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of personas) {
      if (!p?.id) continue;
      map.set(String(p.id), String(p.label || p.id));
    }
    const overrideKeys = Object.keys(routingDraft.personaOverrides || {});
    for (const id of overrideKeys) {
      if (!map.has(id)) map.set(id, id);
    }
    return [...map.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [personas, routingDraft]);

  useEffect(() => {
    if (!personaOptions.length) {
      setSelectedPersonaId("");
      return;
    }
    const exists = personaOptions.some((p) => p.id === selectedPersonaId);
    if (!exists) setSelectedPersonaId(personaOptions[0].id);
  }, [personaOptions, selectedPersonaId]);

  useEffect(() => {
    if (!selectedModel) return;
    setModelDraft(cloneModel(selectedModel));
  }, [selectedModel]);

  async function load() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const [registry, personaRes] = await Promise.all([
        api<ModelRegistryResponse>("/api/model-registry"),
        api<PersonasResponse>("/api/personas").catch(() => ({ ok: true, personas: [] as Array<{ id: string; label?: string }> })),
      ]);
      setStore(registry.store);
      setRoutingDraft(registry.store?.routing || { laneDefaults: {}, personaOverrides: {} });
      setFilePath(String(registry.file || ""));
      const list = sortModels(registry.store?.models || []);
      setSelectedModelId((prev) => prev || (list[0]?.id || ""));
      setPersonas(Array.isArray(personaRes?.personas) ? personaRes.personas : []);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to load model registry"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function updateDraft(patch: Partial<ModelRegistryModel>) {
    setModelDraft((prev) => {
      const base = prev ? cloneModel(prev) : blankModel();
      return {
        ...base,
        ...patch,
        capabilities: patch.capabilities ? { ...base.capabilities, ...patch.capabilities } : base.capabilities,
      };
    });
  }

  async function saveModel() {
    if (!modelDraft) return;
    const next: ModelRegistryModel = {
      ...modelDraft,
      id: String(modelDraft.id || "").trim(),
      label: String(modelDraft.label || "").trim() || String(modelDraft.id || "").trim(),
      provider: String(modelDraft.provider || "vertex").trim().toLowerCase(),
      model: String(modelDraft.model || "").trim(),
      costTier: (TIER_OPTIONS.includes(String(modelDraft.costTier || "")) ? modelDraft.costTier : "medium") as any,
      latencyTier: (TIER_OPTIONS.includes(String(modelDraft.latencyTier || "")) ? modelDraft.latencyTier : "medium") as any,
      capabilities: {
        ...modelDraft.capabilities,
        maxContextTokens: toInt(modelDraft.capabilities?.maxContextTokens, 32768, 1024, 1_000_000),
      },
      notes: String(modelDraft.notes || ""),
    };
    if (!next.id) {
      setError("Model id is required.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api<{ ok: true; model: ModelRegistryModel; store: ModelRegistryStore; file: string }>("/api/model-registry", {
        method: "POST",
        body: JSON.stringify({ model: next }),
      });
      setStore(res.store);
      setRoutingDraft(res.store.routing || { laneDefaults: {}, personaOverrides: {} });
      setFilePath(String(res.file || ""));
      setSelectedModelId(String(res.model?.id || next.id));
      setModelDraft(cloneModel(res.model || next));
      setNotice(`Saved model: ${next.id}`);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to save model"));
    } finally {
      setBusy(false);
    }
  }

  async function deleteModel() {
    const id = String(selectedModelId || modelDraft?.id || "").trim();
    if (!id) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api<ModelRegistryResponse>(`/api/model-registry/${encodeURIComponent(id)}`, { method: "DELETE" });
      setStore(res.store);
      setRoutingDraft(res.store.routing || { laneDefaults: {}, personaOverrides: {} });
      setFilePath(String(res.file || ""));
      const list = sortModels(res.store.models || []);
      const nextId = list[0]?.id || "";
      setSelectedModelId(nextId);
      setModelDraft(nextId ? cloneModel(list[0]) : blankModel());
      setNotice(`Deleted model: ${id}`);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to delete model"));
    } finally {
      setBusy(false);
    }
  }

  async function certifySelected() {
    const id = String(selectedModelId || "").trim();
    if (!id) {
      setError("Save/select a model before certification.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api<ModelRegistryCertifyResponse>(`/api/model-registry/${encodeURIComponent(id)}/certify`, {
        method: "POST",
      });
      setStore(res.store);
      setRoutingDraft(res.store.routing || { laneDefaults: {}, personaOverrides: {} });
      setModelDraft(cloneModel(res.model));
      setNotice(res.certification.summary || "Certification complete.");
    } catch (e: any) {
      setError(String(e?.message || e || "Certification failed"));
    } finally {
      setBusy(false);
    }
  }

  function setLaneDefault(lane: ModelLane, modelId: string) {
    setRoutingDraft((prev) => ({
      laneDefaults: {
        ...(prev?.laneDefaults || {}),
        [lane]: String(modelId || "").trim(),
      },
      personaOverrides: {
        ...(prev?.personaOverrides || {}),
      },
    }));
  }

  function setPersonaLane(personaId: string, lane: ModelLane, modelId: string) {
    const pid = String(personaId || "").trim();
    if (!pid) return;
    setRoutingDraft((prev) => ({
      laneDefaults: {
        ...(prev?.laneDefaults || {}),
      },
      personaOverrides: {
        ...(prev?.personaOverrides || {}),
        [pid]: {
          ...((prev?.personaOverrides || {})[pid] || {}),
          [lane]: String(modelId || "").trim(),
        },
      },
    }));
  }

  function removePersonaOverride(personaId: string) {
    const pid = String(personaId || "").trim();
    if (!pid) return;
    setRoutingDraft((prev) => {
      const copy = { ...(prev?.personaOverrides || {}) };
      delete copy[pid];
      return {
        laneDefaults: {
          ...(prev?.laneDefaults || {}),
        },
        personaOverrides: copy,
      };
    });
  }

  async function saveRouting() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api<{ ok: true; store: ModelRegistryStore }>("/api/model-registry", {
        method: "POST",
        body: JSON.stringify({ routing: routingDraft }),
      });
      setStore(res.store);
      setRoutingDraft(res.store.routing || { laneDefaults: {}, personaOverrides: {} });
      setNotice("Routing saved.");
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to save routing"));
    } finally {
      setBusy(false);
    }
  }

  const selectedPersonaMap = selectedPersonaId ? routingDraft.personaOverrides?.[selectedPersonaId] || {} : {};

  return (
    <section className="settingsSection modelSettings">
      <article className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <h3>Model Registry</h3>
            <div className="muted">File: <code>{filePath || "n/a"}</code></div>
          </div>
          {store?.updatedAt ? <div className="muted">Updated: {new Date(store.updatedAt).toLocaleString()}</div> : null}
        </div>

        <div className="row wrap">
          <button className="btn secondary" onClick={() => void load()} disabled={busy || loading}>
            <RefreshCw size={14} /> Reload
          </button>
          <button
            className="btn secondary"
            onClick={() => {
              const next = blankModel();
              setSelectedModelId("");
              setModelDraft(next);
              setNotice("");
              setError("");
            }}
            disabled={busy}
          >
            <Plus size={14} /> New Model
          </button>
          <button className="btn" onClick={() => void saveModel()} disabled={busy || !modelDraft}>
            <Save size={14} /> Save Model
          </button>
          <button className="btn secondary" onClick={() => void certifySelected()} disabled={busy || !selectedModelId}>
            <FlaskConical size={14} /> Certify
          </button>
          <button className="btn danger" onClick={() => void deleteModel()} disabled={busy || !selectedModelId}>
            <Trash2 size={14} /> Delete
          </button>
        </div>

        {loading ? <div className="opsBanner">Loading model registry...</div> : null}
        {error ? <div className="opsBanner error">{error}</div> : null}
        {notice ? <div className="opsBanner ok">{notice}</div> : null}

        <div className="modelSettingsGrid">
          <div className="settingsCard">
            <h4>Models</h4>
            <div className="opsMiniList">
              {models.length === 0 ? (
                <div className="muted">No models configured.</div>
              ) : (
                models.map((m) => (
                  <button
                    key={m.id}
                    className={`settingsNavItem${selectedModelId === m.id ? " active" : ""}`}
                    onClick={() => setSelectedModelId(m.id)}
                  >
                    {m.label || m.id}
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="settingsCard modelEditorCard">
            <h4>{selectedModelId ? `Edit: ${selectedModel?.label || selectedModelId}` : "New Model"}</h4>
            {modelDraft ? (
              <div className="modelForm">
                <div className="field">
                  <label>Model ID</label>
                  <input className="input" value={modelDraft.id} onChange={(e) => updateDraft({ id: e.target.value })} />
                </div>
                <div className="field">
                  <label>Label</label>
                  <input className="input" value={modelDraft.label} onChange={(e) => updateDraft({ label: e.target.value })} />
                </div>
                <div className="row wrap">
                  <div className="field">
                    <label>Provider</label>
                    <select className="input" value={modelDraft.provider} onChange={(e) => updateDraft({ provider: e.target.value })}>
                      {PROVIDER_OPTIONS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Model Name</label>
                    <input className="input" value={modelDraft.model} onChange={(e) => updateDraft({ model: e.target.value })} />
                  </div>
                </div>

                <div className="row wrap">
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.enabled)}
                      onChange={(e) => updateDraft({ enabled: e.target.checked })}
                    />
                    <span>Enabled</span>
                  </label>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.capabilities?.planning)}
                      onChange={(e) => updateDraft({ capabilities: { ...modelDraft.capabilities, planning: e.target.checked } })}
                    />
                    <span>Planning</span>
                  </label>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.capabilities?.coding)}
                      onChange={(e) => updateDraft({ capabilities: { ...modelDraft.capabilities, coding: e.target.checked } })}
                    />
                    <span>Coding</span>
                  </label>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.capabilities?.toolCalling)}
                      onChange={(e) => updateDraft({ capabilities: { ...modelDraft.capabilities, toolCalling: e.target.checked } })}
                    />
                    <span>Tool Calling</span>
                  </label>
                  <label className="row">
                    <input
                      type="checkbox"
                      checked={Boolean(modelDraft.capabilities?.longContext)}
                      onChange={(e) => updateDraft({ capabilities: { ...modelDraft.capabilities, longContext: e.target.checked } })}
                    />
                    <span>Long Context</span>
                  </label>
                </div>

                <div className="row wrap">
                  <div className="field">
                    <label>Max Context Tokens</label>
                    <input
                      className="input"
                      type="number"
                      value={Number(modelDraft.capabilities?.maxContextTokens || 32768)}
                      onChange={(e) =>
                        updateDraft({
                          capabilities: {
                            ...modelDraft.capabilities,
                            maxContextTokens: toInt(e.target.value, 32768, 1024, 1_000_000),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label>Cost Tier</label>
                    <select className="input" value={modelDraft.costTier} onChange={(e) => updateDraft({ costTier: e.target.value as any })}>
                      {TIER_OPTIONS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label>Latency Tier</label>
                    <select className="input" value={modelDraft.latencyTier} onChange={(e) => updateDraft({ latencyTier: e.target.value as any })}>
                      {TIER_OPTIONS.map((x) => (
                        <option key={x} value={x}>
                          {x}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field">
                  <label>Notes</label>
                  <textarea className="input" rows={4} value={modelDraft.notes || ""} onChange={(e) => updateDraft({ notes: e.target.value })} />
                </div>

                <div className="muted">
                  Certification: <strong>{modelDraft.certification?.status || "unknown"}</strong>
                  {modelDraft.certification?.lastRunAt ? ` · ${new Date(modelDraft.certification.lastRunAt).toLocaleString()}` : ""}
                </div>
                {Array.isArray(modelDraft.certification?.checks) && modelDraft.certification.checks.length ? (
                  <div className="modelChecks">
                    {modelDraft.certification.checks.map((check) => (
                      <div key={check.id} className={`modelCheck${check.ok ? " ok" : " fail"}`}>
                        <strong>{check.ok ? "PASS" : "FAIL"}</strong> {check.id}: {check.detail}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="muted">Select a model to edit.</div>
            )}
          </div>
        </div>
      </article>

      <article className="settingsCard">
        <div className="settingsCardHeader">
          <h3>Routing</h3>
          <div className="muted">Choose lane defaults and persona-specific overrides.</div>
        </div>

        <div className="modelRoutingGrid">
          <div className="settingsCard">
            <h4>Lane Defaults</h4>
            {LANE_KEYS.map((lane) => (
              <div key={lane} className="field">
                <label>{lane}</label>
                <select
                  className="input"
                  value={String(routingDraft.laneDefaults?.[lane] || "")}
                  onChange={(e) => setLaneDefault(lane, e.target.value)}
                >
                  <option value="">(none)</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.id}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          <div className="settingsCard">
            <h4>Persona Overrides</h4>
            <div className="row wrap">
              <div className="field">
                <label>Persona</label>
                <select className="input" value={selectedPersonaId} onChange={(e) => setSelectedPersonaId(e.target.value)}>
                  <option value="">(select)</option>
                  {personaOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn danger" onClick={() => removePersonaOverride(selectedPersonaId)} disabled={!selectedPersonaId || busy}>
                <Trash2 size={14} /> Remove Override
              </button>
            </div>
            {selectedPersonaId ? (
              <div className="modelPersonaLanes">
                {LANE_KEYS.map((lane) => (
                  <div key={lane} className="field">
                    <label>{lane}</label>
                    <select
                      className="input"
                      value={String((selectedPersonaMap as any)?.[lane] || "")}
                      onChange={(e) => setPersonaLane(selectedPersonaId, lane, e.target.value)}
                    >
                      <option value="">(inherit lane default)</option>
                      {models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.label || m.id}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Select a persona to edit lane overrides.</div>
            )}
          </div>
        </div>

        <div className="row wrap">
          <button className="btn" onClick={() => void saveRouting()} disabled={busy || loading}>
            <Save size={14} /> Save Routing
          </button>
        </div>
      </article>
    </section>
  );
}

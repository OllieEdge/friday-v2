import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { api } from "../../api/client";

type Persona = {
  id: string;
  label: string;
  description: string;
  traits: string[];
  responsibilities: string[];
  tone: { voice: string; formality: string; verbosity: string };
  boundaries: string[];
  toolPolicy: { mode: string; allow: string[]; deny: string[] };
  channels: string[];
  promptAddendum: string;
  source?: any;
  updatedAt?: string;
};

type PersonasResponse = {
  ok: true;
  updatedAt: string;
  template: { title?: string; description?: string; example?: Persona };
  personas: Persona[];
  file: string;
};

function prettyJson(value: any) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

export function PersonasSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [filePath, setFilePath] = useState("");
  const [template, setTemplate] = useState<PersonasResponse["template"] | null>(null);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState("{}");

  const selected = useMemo(() => personas.find((p) => p.id === selectedId) || null, [personas, selectedId]);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await api<PersonasResponse>("/api/personas");
      setTemplate(res.template || null);
      setPersonas(Array.isArray(res.personas) ? res.personas : []);
      setSavedAt(String(res.updatedAt || ""));
      setFilePath(String(res.file || ""));
      const first = Array.isArray(res.personas) && res.personas.length ? String(res.personas[0].id || "") : "";
      setSelectedId((prev) => prev || first);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to load personas"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!selected) {
      setDraft("{}");
      return;
    }
    setDraft(prettyJson(selected));
  }, [selected]);

  async function saveDraft() {
    setBusy(true);
    setError("");
    try {
      const parsed = JSON.parse(String(draft || "{}"));
      const res = await api<PersonasResponse>("/api/personas", {
        method: "POST",
        body: JSON.stringify({ persona: parsed }),
      });
      setPersonas(res.personas || []);
      setSavedAt(String(res.updatedAt || ""));
      setFilePath(String(res.file || ""));
      const id = String(parsed?.id || "");
      if (id) setSelectedId(id);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to save persona"));
    } finally {
      setBusy(false);
    }
  }

  async function removeSelected() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await api<PersonasResponse>(`/api/personas/${encodeURIComponent(selected.id)}`, { method: "DELETE" });
      setPersonas(res.personas || []);
      setSavedAt(String(res.updatedAt || ""));
      const next = Array.isArray(res.personas) && res.personas.length ? String(res.personas[0].id || "") : "";
      setSelectedId(next);
    } catch (e: any) {
      setError(String(e?.message || e || "Unable to delete persona"));
    } finally {
      setBusy(false);
    }
  }

  function newFromTemplate() {
    const base = template?.example || {
      id: "",
      label: "",
      description: "",
      traits: [],
      responsibilities: [],
      tone: { voice: "", formality: "", verbosity: "" },
      boundaries: [],
      toolPolicy: { mode: "allowlist", allow: [], deny: [] },
      channels: [],
      promptAddendum: "",
    };
    setSelectedId("");
    setDraft(prettyJson(base));
  }

  return (
    <section className="personaSettings">
      <div className="personaSettingsTop">
        <div>
          <h3>Agent Personas</h3>
          <div className="opsMuted">Define reusable personas for flow agents and assistant routing. Saved at: <code>{filePath || "n/a"}</code></div>
          {savedAt ? <div className="opsMuted">Updated: {new Date(savedAt).toLocaleString()}</div> : null}
        </div>
        <div className="personaActions">
          <button className="btn secondary" onClick={() => void load()} disabled={busy || loading}>
            <RefreshCw size={14} /> Reload
          </button>
          <button className="btn secondary" onClick={newFromTemplate} disabled={busy}>
            <Plus size={14} /> New From Template
          </button>
          <button className="btn" onClick={() => void saveDraft()} disabled={busy}>
            <Save size={14} /> Save
          </button>
          <button className="btn danger" onClick={() => void removeSelected()} disabled={busy || !selected}>
            <Trash2 size={14} /> Delete
          </button>
        </div>
      </div>

      {loading ? <div className="opsBanner">Loading personas...</div> : null}
      {error ? <div className="opsBanner error">{error}</div> : null}

      <div className="personaGrid">
        <article className="opsCard">
          <h4>Personas</h4>
          <div className="opsMiniList">
            {personas.length === 0 ? (
              <div className="opsMuted">No personas yet.</div>
            ) : (
              personas.map((p) => (
                <button key={p.id} className={`settingsNavItem${selectedId === p.id ? " active" : ""}`} onClick={() => setSelectedId(p.id)}>
                  {p.label || p.id}
                </button>
              ))
            )}
          </div>
        </article>

        <article className="opsCard opsCardWide">
          <h4>{selected ? `Edit: ${selected.label || selected.id}` : "Persona JSON"}</h4>
          <textarea
            className="personaEditor"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            placeholder="Persona JSON"
          />
        </article>
      </div>
    </section>
  );
}

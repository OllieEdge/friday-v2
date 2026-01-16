import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { IdentifyPersonResponse, PeopleResponse, PersonRecord } from "../api/types";

type ProviderOption = "gchat" | "email" | "slack" | "custom";

export function ContactsPage() {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [displayName, setDisplayName] = useState("");
  const [provider, setProvider] = useState<ProviderOption>("gchat");
  const [providerUserId, setProviderUserId] = useState("");
  const [label, setLabel] = useState("");
  const [personId, setPersonId] = useState("");
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const res = await api<PeopleResponse>("/api/people");
      setPeople(res.people || []);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function saveIdentity() {
    const name = displayName.trim();
    const id = providerUserId.trim();
    if (!name || !id) return;
    setSaving(true);
    try {
      await api<IdentifyPersonResponse>("/api/people/identify", {
        method: "POST",
        body: JSON.stringify({
          personId: personId.trim() || null,
          displayName: name,
          provider,
          providerUserId: id,
          label: label.trim() || null,
        }),
      });
      setDisplayName("");
      setProviderUserId("");
      setLabel("");
      setPersonId("");
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  const peopleOptions = useMemo(
    () => people.map((p) => ({ id: p.id, label: p.displayName })),
    [people],
  );

  return (
    <div className="contactsShell">
      <div className="settingsCard">
        <div className="settingsCardTitleRow">
          <div style={{ fontWeight: 800 }}>Contacts</div>
          <span className="pill">{people.length}</span>
        </div>
        <div className="muted">Store people + identifiers (gchat, email, slack, etc).</div>
        <div className="settingsDivider" />
        <div className="row wrap">
          <label style={{ display: "grid", gap: 6, minWidth: 200 }}>
            <div className="muted">Display name</div>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Contact Name"
            />
          </label>
          <label style={{ display: "grid", gap: 6, minWidth: 140 }}>
            <div className="muted">Provider</div>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as ProviderOption)}>
              <option value="gchat">gchat</option>
              <option value="email">email</option>
              <option value="slack">slack</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6, minWidth: 220 }}>
            <div className="muted">Identifier</div>
            <input
              className="input"
              value={providerUserId}
              onChange={(e) => setProviderUserId(e.target.value)}
              placeholder="users/123… or name@example.com"
            />
          </label>
          <label style={{ display: "grid", gap: 6, minWidth: 160 }}>
            <div className="muted">Label (optional)</div>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work" />
          </label>
          <label style={{ display: "grid", gap: 6, minWidth: 200 }}>
            <div className="muted">Attach to existing</div>
            <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
              <option value="">New contact</option>
              {peopleOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "grid", gap: 6, alignSelf: "flex-end" }}>
            <button className="btn secondary" onClick={() => void saveIdentity()} disabled={saving || !displayName.trim() || !providerUserId.trim()}>
              {saving ? "Saving..." : "Save contact"}
            </button>
          </div>
        </div>
        {error ? <div className="muted">Error: {error}</div> : null}
      </div>

      <div className="contactsGrid">
        {loading ? (
          <div className="muted">Loading contacts…</div>
        ) : people.length ? (
          people.map((person) => (
            <div key={person.id} className="settingsCard">
              <div className="settingsCardTitleRow">
                <div style={{ fontWeight: 800 }}>{person.displayName}</div>
              </div>
              <div className="muted">Updated {new Date(person.updatedAt).toLocaleString()}</div>
              <div className="settingsDivider" />
              <div className="contactsIdentities">
                {(person.identities || []).map((ident) => (
                  <div key={ident.id} className="contactsIdentity">
                    <div style={{ fontWeight: 700 }}>{ident.provider}</div>
                    <div className="muted">{ident.providerUserId}</div>
                    {ident.label ? <div className="pill">{ident.label}</div> : null}
                  </div>
                ))}
                {person.identities?.length ? null : <div className="muted">No identifiers yet.</div>}
              </div>
            </div>
          ))
        ) : (
          <div className="muted">No contacts yet.</div>
        )}
      </div>
    </div>
  );
}

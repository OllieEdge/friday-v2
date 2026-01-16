import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type {
  BootstrapMeResponse,
  DeleteIdentityResponse,
  DeletePersonResponse,
  IdentifyPersonResponse,
  PeopleResponse,
  PersonRecord,
  UpdatePersonResponse,
} from "../api/types";
import { ContactPopover } from "./contacts/ContactPopover";

export function ContactsPage() {
  const [people, setPeople] = useState<PersonRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editPersonId, setEditPersonId] = useState("");
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

  async function saveName() {
    if (!editPersonId || !editName.trim()) return;
    setSaving(true);
    try {
      await api<UpdatePersonResponse>(`/api/people/${editPersonId}`, {
        method: "PATCH",
        body: JSON.stringify({ displayName: editName.trim() }),
      });
      setEditName("");
      setEditPersonId("");
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function setMe(personId: string) {
    setSaving(true);
    try {
      await api<UpdatePersonResponse>(`/api/people/${personId}`, {
        method: "PATCH",
        body: JSON.stringify({ isMe: true }),
      });
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function deletePerson(personId: string) {
    if (!personId) return;
    setSaving(true);
    try {
      await api<DeletePersonResponse>(`/api/people/${personId}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function deleteIdentity(identityId: string) {
    if (!identityId) return;
    setSaving(true);
    try {
      await api<DeleteIdentityResponse>(`/api/people/identities/${identityId}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function addIdentity(payload: { displayName: string; provider: string; providerUserId: string; label?: string | null; personId?: string | null }) {
    setSaving(true);
    try {
      await api<IdentifyPersonResponse>("/api/people/identify", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }

  async function bootstrapMe() {
    setSaving(true);
    try {
      await api<BootstrapMeResponse>("/api/people/bootstrap-me", { method: "POST", body: JSON.stringify({}) });
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

  const me = useMemo(() => people.find((p) => p.isMe), [people]);

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
          <button className="btn secondary" onClick={() => setPopoverOpen(true)}>
            Add contact
          </button>
          <button className="btn" onClick={() => void bootstrapMe()} disabled={saving}>
            Use account info
          </button>
          {me ? <span className="pill">Me: {me.displayName}</span> : <span className="muted">No “me” contact set.</span>}
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
                {person.isMe ? <span className="pill">me</span> : null}
              </div>
              <div className="muted">Updated {new Date(person.updatedAt).toLocaleString()}</div>
              <div className="settingsDivider" />
              <div className="row wrap">
                <button
                  className="btn"
                  onClick={() => {
                    setEditPersonId(person.id);
                    setEditName(person.displayName);
                  }}
                >
                  Edit name
                </button>
                <button className="btn secondary" onClick={() => setMe(person.id)} disabled={saving}>
                  Set as me
                </button>
                <button className="btn danger" onClick={() => deletePerson(person.id)} disabled={saving}>
                  Delete
                </button>
              </div>
              {editPersonId === person.id ? (
                <div className="row wrap" style={{ marginTop: 8 }}>
                  <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Contact Name" />
                  <button className="btn secondary" onClick={() => void saveName()} disabled={saving || !editName.trim()}>
                    {saving ? "Saving..." : "Save name"}
                  </button>
                </div>
              ) : null}
              <div className="settingsDivider" />
              <div className="contactsIdentities">
                {(person.identities || []).map((ident) => (
                  <div key={ident.id} className="contactsIdentity">
                    <div style={{ fontWeight: 700 }}>{ident.provider}</div>
                    <div className="muted">{ident.providerUserId}</div>
                    <div className="row wrap">
                      {ident.label ? <div className="pill">{ident.label}</div> : null}
                      <button className="btn tiny" onClick={() => deleteIdentity(ident.id)} disabled={saving}>
                        Remove
                      </button>
                    </div>
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

      <ContactPopover
        open={popoverOpen}
        onClose={() => setPopoverOpen(false)}
        people={people}
        onSaved={async (payload) => {
          await addIdentity(payload);
          setPopoverOpen(false);
        }}
      />
    </div>
  );
}

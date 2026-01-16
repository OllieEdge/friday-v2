import React, { useEffect, useMemo, useState } from "react";
import type { PersonRecord } from "../../api/types";

type ProviderOption = "gchat" | "email" | "slack" | "custom";

export function ContactPopover({
  open,
  onClose,
  people,
  presetDisplayName = "",
  presetProvider = "gchat",
  presetProviderUserId = "",
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  people: PersonRecord[];
  presetDisplayName?: string;
  presetProvider?: ProviderOption;
  presetProviderUserId?: string;
  onSaved: (payload: {
    displayName: string;
    provider: ProviderOption;
    providerUserId: string;
    label?: string | null;
    personId?: string | null;
  }) => Promise<void> | void;
}) {
  const [displayName, setDisplayName] = useState(presetDisplayName);
  const [provider, setProvider] = useState<ProviderOption>(presetProvider);
  const [providerUserId, setProviderUserId] = useState(presetProviderUserId);
  const [label, setLabel] = useState("");
  const [personId, setPersonId] = useState("");

  const peopleOptions = useMemo(() => people.map((p) => ({ id: p.id, label: p.displayName })), [people]);

  useEffect(() => {
    if (!open) return;
    setDisplayName(presetDisplayName);
    setProvider(presetProvider);
    setProviderUserId(presetProviderUserId);
  }, [open, presetDisplayName, presetProvider, presetProviderUserId]);

  if (!open) return null;

  return (
    <div className="popoverBackdrop" role="dialog" aria-modal="true">
      <div className="popoverCard">
        <div className="popoverHeader">
          <div style={{ fontWeight: 800 }}>Add contact</div>
          <button className="btn iconBtn" onClick={onClose} title="Close">
            ✕
          </button>
        </div>
        <div className="popoverBody">
          <label style={{ display: "grid", gap: 6 }}>
            <div className="muted">Display name</div>
            <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Contact Name" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <div className="muted">Provider</div>
            <select className="input" value={provider} onChange={(e) => setProvider(e.target.value as ProviderOption)}>
              <option value="gchat">gchat</option>
              <option value="email">email</option>
              <option value="slack">slack</option>
              <option value="custom">custom</option>
            </select>
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <div className="muted">Identifier</div>
            <input
              className="input"
              value={providerUserId}
              onChange={(e) => setProviderUserId(e.target.value)}
              placeholder="users/123… or name@example.com"
            />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
            <div className="muted">Label (optional)</div>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Work" />
          </label>
          <label style={{ display: "grid", gap: 6 }}>
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
          <div className="row wrap" style={{ justifyContent: "flex-end" }}>
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button
              className="btn secondary"
              onClick={() =>
                onSaved({
                  displayName: displayName.trim(),
                  provider,
                  providerUserId: providerUserId.trim(),
                  label: label.trim() || null,
                  personId: personId.trim() || null,
                })
              }
              disabled={!displayName.trim() || !providerUserId.trim()}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

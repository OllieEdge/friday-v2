import { startRegistration } from "@simplewebauthn/browser";
import { KeyRound, LogOut, RefreshCcw, Trash2 } from "lucide-react";
import React, { useEffect, useState } from "react";
import { api } from "../../api/client";
import type { PasskeysResponse } from "../../api/types";

type RegistrationOptionsResponse = { ok: true; challengeId: string; user: { id: string; label: string }; options: any };
type RegistrationVerifyResponse = { ok: true; user: { id: string; label: string } };

export function SecurityPanel({ onLoggedOut }: { onLoggedOut: () => Promise<void> }) {
  const [data, setData] = useState<PasskeysResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const res = await api<PasskeysResponse>("/api/auth/passkeys");
      setData(res);
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const { options } = await api<RegistrationOptionsResponse>("/api/auth/registration/options", { method: "POST", body: "{}" });
      const resp = await startRegistration(options);
      await api<RegistrationVerifyResponse>("/api/auth/registration/verify", {
        method: "POST",
        body: JSON.stringify({ challenge: options.challenge, response: resp }),
      });
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api<{ ok: true }>(`/api/auth/passkeys/${id}`, { method: "DELETE" });
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    setError(null);
    try {
      await api<{ ok: true }>("/api/auth/logout", { method: "POST", body: "{}" });
      await onLoggedOut();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settingsSection">
      <section className="settingsCard">
        <div className="settingsCardHeader">
          <div className="settingsCardTitleRow">
            <div style={{ fontWeight: 700 }}>Security</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn iconBtn" onClick={() => void refresh()} title="Refresh" disabled={busy}>
                <RefreshCcw size={16} />
              </button>
              <button className="btn secondary" onClick={() => void logout()} disabled={busy} title="Log out">
                <LogOut size={16} />
                Log out
              </button>
            </div>
          </div>
          <div className="muted">Passkeys are required to use Friday v2.</div>
        </div>

        {error ? <div className="muted" style={{ color: "rgba(248,113,113,0.95)" }}>{error}</div> : null}

        <div className="row wrap">
          <div style={{ display: "grid", gap: 2 }}>
            <div className="muted">User</div>
            <div style={{ fontWeight: 700 }}>{data?.user?.label || "—"}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn secondary" onClick={() => void addPasskey()} disabled={busy}>
              <KeyRound size={16} />
              Add passkey
            </button>
          </div>
        </div>

        {(data?.passkeys || []).length ? <hr className="settingsDivider" /> : null}

        {(data?.passkeys || []).map((p) => (
          <div key={p.id} className="row wrap">
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontWeight: 700 }}>{p.credentialId.slice(0, 12)}…</div>
              <div className="muted">{new Date(p.createdAt).toLocaleString()}</div>
            </div>
            <button className="btn iconBtn danger" onClick={() => void removePasskey(p.id)} title="Remove" disabled={busy}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}

        {data && data.passkeys.length === 0 ? <div className="muted">No passkeys yet.</div> : null}
      </section>
    </section>
  );
}

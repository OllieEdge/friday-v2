import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { KeyRound, LogIn, Plus, Shield } from "lucide-react";
import React, { useMemo, useState } from "react";
import { api } from "../api/client";
import type { AuthStatusResponse } from "../api/types";

type RegistrationOptionsResponse = { ok: true; challengeId: string; user: { id: string; label: string }; options: any };
type RegistrationVerifyResponse = { ok: true; user: { id: string; label: string } };
type AuthenticationOptionsResponse = { ok: true; challengeId: string; options: any };
type AuthenticationVerifyResponse = { ok: true; user: { id: string; label: string } };

export function AuthOverlay({
  status,
  onAuthed,
}: {
  status: AuthStatusResponse;
  onAuthed: () => Promise<void>;
}) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsBootstrap = useMemo(() => !status.hasAnyPasskeys, [status.hasAnyPasskeys]);

  async function signIn() {
    setError(null);
    setBusy(true);
    try {
      const { options } = await api<AuthenticationOptionsResponse>("/api/auth/authentication/options", { method: "POST", body: "{}" });
      const resp = await startAuthentication(options);
      await api<AuthenticationVerifyResponse>("/api/auth/authentication/verify", {
        method: "POST",
        body: JSON.stringify({ challenge: options.challenge, response: resp }),
      });
      await onAuthed();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function register() {
    setError(null);
    const trimmed = label.trim();
    if (!trimmed && !status.hasAnyUsers) {
      setError("Enter a label first (e.g. Ollie)");
      return;
    }
    setBusy(true);
    try {
      const { options } = await api<RegistrationOptionsResponse>("/api/auth/registration/options", {
        method: "POST",
        body: JSON.stringify({ label: trimmed }),
      });
      const resp = await startRegistration(options);
      await api<RegistrationVerifyResponse>("/api/auth/registration/verify", {
        method: "POST",
        body: JSON.stringify({ challenge: options.challenge, response: resp }),
      });
      await onAuthed();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="authOverlay" role="dialog" aria-modal="true">
      <div className="authCard">
        <div className="authTitleRow">
          <div className="authIcon">
            <Shield size={18} />
          </div>
          <div className="authTitle">Sign in</div>
        </div>
        <div className="authSubtitle">{needsBootstrap ? "Set up a passkey to use Friday v2." : "Passkey required."}</div>

        {error ? <div className="authError">{error}</div> : null}

        {!needsBootstrap ? (
          <div className="authActions">
            <button className="btn primary" onClick={() => void signIn()} disabled={busy}>
              <LogIn size={16} />
              Sign in with passkey
            </button>
          </div>
        ) : null}

        {needsBootstrap ? (
          <div className="authRegister">
            <div className="authDivider" />
            <div className="authHint">{status.hasAnyUsers ? "Finish setup" : "First time setup"}</div>
            <div className="authRow">
              <input
                className="input"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={status.hasAnyUsers ? "Label (optional)" : "Passkey label (e.g. Ollie)"}
                disabled={busy}
              />
              <button className="btn secondary" onClick={() => void register()} disabled={busy}>
                <Plus size={16} />
                Create
              </button>
            </div>
            <div className="authSmall">
              <KeyRound size={14} /> This creates the first passkey user and logs you in.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

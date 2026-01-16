import { ChevronLeft, X } from "lucide-react";
import React, { useMemo, useState } from "react";
import type { CodexAccountsResponse, ContextMetrics } from "../api/types";
import { AccountsPanel } from "./accounts/AccountsPanel";
import { PmPanel } from "./pm/PmPanel";
import { ScheduledPanel } from "./runbooks/ScheduledPanel";
import { SecurityPanel } from "./security/SecurityPanel";

type Section = "accounts" | "scheduled" | "pm" | "security";

export function SettingsPage({
  onClose,
  onLoggedOut,
  accounts,
  refreshAccounts,
  contextMetrics,
  embedded = false,
}: {
  onClose: () => void;
  onLoggedOut: () => Promise<void>;
  accounts: CodexAccountsResponse | null;
  refreshAccounts: () => Promise<void>;
  contextMetrics: ContextMetrics | null;
  embedded?: boolean;
}) {
  const [section, setSection] = useState<Section>("accounts");

  const title = useMemo(() => {
    if (section === "accounts") return "Accounts";
    if (section === "scheduled") return "Scheduled";
    if (section === "pm") return "PM";
    if (section === "security") return "Security";
    return "Settings";
  }, [section]);

  const body = (
    <div className={`settingsShell${embedded ? " embedded" : ""}`}>
      <div className="settingsHeader">
        <div className="settingsHeaderLeft">
          {!embedded ? (
            <button className="btn iconBtn mobileOnly" onClick={onClose} title="Back">
              <ChevronLeft size={18} />
            </button>
          ) : null}
          <div className="settingsTitle">Settings · {title}</div>
        </div>
        {!embedded ? (
          <button className="btn iconBtn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
        ) : null}
      </div>

      <div className="settingsBody">
        <nav className="settingsNav" aria-label="Settings navigation">
          <button
            className={`settingsNavItem${section === "accounts" ? " active" : ""}`}
            onClick={() => setSection("accounts")}
          >
            Accounts
          </button>
          <button
            className={`settingsNavItem${section === "scheduled" ? " active" : ""}`}
            onClick={() => setSection("scheduled")}
          >
            Scheduled
          </button>
          <button
            className={`settingsNavItem${section === "pm" ? " active" : ""}`}
            onClick={() => setSection("pm")}
          >
            PM
          </button>
          <button
            className={`settingsNavItem${section === "security" ? " active" : ""}`}
            onClick={() => setSection("security")}
          >
            Security
          </button>
        </nav>

        <div className="settingsContent">
          {section === "accounts" ? (
            <AccountsPanel accounts={accounts} refreshAccounts={refreshAccounts} contextMetrics={contextMetrics} />
          ) : section === "scheduled" ? (
            <ScheduledPanel />
          ) : section === "pm" ? (
            <PmPanel />
          ) : section === "security" ? (
            <SecurityPanel onLoggedOut={onLoggedOut} />
          ) : null}
        </div>
      </div>
    </div>
  );

  if (embedded) return body;
  return (
    <div className="settingsOverlay" role="dialog" aria-modal="true">
      {body}
    </div>
  );
}

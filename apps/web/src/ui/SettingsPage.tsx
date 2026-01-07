import { ChevronLeft, X } from "lucide-react";
import React, { useMemo, useState } from "react";
import type { CodexAccountsResponse, ContextMetrics } from "../api/types";
import { AccountsPanel } from "./accounts/AccountsPanel";
import { ScheduledPanel } from "./runbooks/ScheduledPanel";
import { SecurityPanel } from "./security/SecurityPanel";

type Section = "accounts" | "scheduled" | "security";

export function SettingsPage({
  onClose,
  onLoggedOut,
  accounts,
  refreshAccounts,
  contextMetrics,
}: {
  onClose: () => void;
  onLoggedOut: () => Promise<void>;
  accounts: CodexAccountsResponse | null;
  refreshAccounts: () => Promise<void>;
  contextMetrics: ContextMetrics | null;
}) {
  const [section, setSection] = useState<Section>("accounts");

  const title = useMemo(() => {
    if (section === "accounts") return "Accounts";
    if (section === "scheduled") return "Scheduled";
    if (section === "security") return "Security";
    return "Settings";
  }, [section]);

  return (
    <div className="settingsOverlay" role="dialog" aria-modal="true">
      <div className="settingsShell">
        <div className="settingsHeader">
          <div className="settingsHeaderLeft">
            <button className="btn iconBtn mobileOnly" onClick={onClose} title="Back">
              <ChevronLeft size={18} />
            </button>
            <div className="settingsTitle">Settings · {title}</div>
          </div>
          <button className="btn iconBtn" onClick={onClose} title="Close">
            <X size={18} />
          </button>
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
            ) : section === "security" ? (
              <SecurityPanel onLoggedOut={onLoggedOut} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

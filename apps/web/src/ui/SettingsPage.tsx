import { ChevronLeft, X } from "lucide-react";
import React, { useMemo, useState } from "react";
import type { CodexAccountsResponse, ContextMetrics } from "../api/types";
import { AccountsPanel } from "./accounts/AccountsPanel";

type Section = "accounts";

export function SettingsPage({
  onClose,
  accounts,
  refreshAccounts,
  contextMetrics,
}: {
  onClose: () => void;
  accounts: CodexAccountsResponse | null;
  refreshAccounts: () => Promise<void>;
  contextMetrics: ContextMetrics | null;
}) {
  const [section, setSection] = useState<Section>("accounts");

  const title = useMemo(() => {
    if (section === "accounts") return "Accounts";
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
          </nav>

          <div className="settingsContent">
            {section === "accounts" ? (
              <AccountsPanel accounts={accounts} refreshAccounts={refreshAccounts} contextMetrics={contextMetrics} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}


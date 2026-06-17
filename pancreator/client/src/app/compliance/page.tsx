"use client";

import { useState } from "react";
import { MaintenanceModule } from "@/components/command-center/maintenance/MaintenanceModule";

export default function CompliancePage() {
  const [, setAuditHistoryPath] = useState<string | null>(null);

  return (
    <div className="compliance-page" data-testid="compliance-page">
      <header className="compliance-page-header">
        <h1>Compliance + Recovery</h1>
        <p>Trigger audits, inspect failures, and run recovery actions.</p>
      </header>
      <MaintenanceModule onOpenAuditHistory={(path) => setAuditHistoryPath(path)} />
    </div>
  );
}

"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MaintenanceModule } from "../maintenance/MaintenanceModule";
import { PipelineModule } from "../pipeline/PipelineModule";

export type DashboardModule = "pipeline" | "automations" | "maintenance" | "files";

export function DashboardModuleShell({
  filesContent,
  activeModule,
  onActiveModuleChange,
  onOpenNextPrompt,
  onOpenRunFolder,
  onOpenArtifact,
  onOpenInboxEntry,
  onOpenRefreshProcedure,
}: {
  filesContent: ReactNode;
  activeModule: DashboardModule;
  onActiveModuleChange: (module: DashboardModule) => void;
  onOpenNextPrompt: (filePath: string) => void;
  onOpenRunFolder: (runDir: string) => void;
  onOpenArtifact: (filePath: string) => void;
  onOpenInboxEntry: (filePath: string) => void;
  onOpenRefreshProcedure: (filePath: string) => void;
}) {

  return (
    <div className="dashboard-module-shell" data-testid="dashboard-module-shell">
      <nav className="dashboard-module-tabs" aria-label="Command Center surfaces">
        <button
          type="button"
          className={`dashboard-module-tab${activeModule === "pipeline" ? " dashboard-module-tab-active" : ""}`}
          data-testid="module-tab-pipeline"
          aria-selected={activeModule === "pipeline"}
          onClick={() => onActiveModuleChange("pipeline")}
        >
          Pipeline
        </button>
        <button
          type="button"
          className={`dashboard-module-tab${activeModule === "automations" ? " dashboard-module-tab-active" : ""}`}
          data-testid="module-tab-automations"
          aria-selected={activeModule === "automations"}
          onClick={() => onActiveModuleChange("automations")}
        >
          Automations
        </button>
        <button
          type="button"
          className={`dashboard-module-tab${activeModule === "maintenance" ? " dashboard-module-tab-active" : ""}`}
          data-testid="module-tab-maintenance"
          aria-selected={activeModule === "maintenance"}
          onClick={() => onActiveModuleChange("maintenance")}
        >
          Maintenance
        </button>
        <button
          type="button"
          className={`dashboard-module-tab dashboard-module-tab-secondary${activeModule === "files" ? " dashboard-module-tab-active" : ""}`}
          data-testid="module-tab-files"
          aria-selected={activeModule === "files"}
          onClick={() => onActiveModuleChange("files")}
        >
          Files
        </button>
      </nav>

      <div className="dashboard-module-content">
        {activeModule === "pipeline" ? (
          <PipelineModule
            onOpenNextPrompt={onOpenNextPrompt}
            onOpenRunFolder={onOpenRunFolder}
            onOpenArtifact={onOpenArtifact}
            onOpenInboxEntry={onOpenInboxEntry}
            onOpenRefreshProcedure={onOpenRefreshProcedure}
            onNavigateToMaintenance={() => onActiveModuleChange("maintenance")}
          />
        ) : null}
        {activeModule === "automations" ? (
          <div
            className="command-center-legacy-surface-banner"
            data-testid="automations-legacy-banner"
            role="region"
            aria-label="Automations surface migration"
          >
            <p>Automations now live in the Command Center ten-surface shell.</p>
            <Link href="/automations" className="command-center-action-cta">
              Open automations surface
            </Link>
          </div>
        ) : null}
        {activeModule === "maintenance" ? (
          <MaintenanceModule onOpenAuditHistory={onOpenArtifact} />
        ) : null}
        {activeModule === "files" ? filesContent : null}
      </div>
    </div>
  );
}

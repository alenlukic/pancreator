"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { MaintenanceModule } from "../maintenance/MaintenanceModule";
import { PipelineModule } from "../pipeline/PipelineModule";

export type CockpitModule = "pipeline" | "automations" | "maintenance" | "files";

export function CockpitShell({
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
  activeModule: CockpitModule;
  onActiveModuleChange: (module: CockpitModule) => void;
  onOpenNextPrompt: (filePath: string) => void;
  onOpenRunFolder: (runDir: string) => void;
  onOpenArtifact: (filePath: string) => void;
  onOpenInboxEntry: (filePath: string) => void;
  onOpenRefreshProcedure: (filePath: string) => void;
}) {

  return (
    <div className="cockpit-shell" data-testid="cockpit-shell">
      <nav className="cockpit-module-tabs" aria-label="Cockpit modules">
        <button
          type="button"
          className={`cockpit-module-tab${activeModule === "pipeline" ? " cockpit-module-tab-active" : ""}`}
          data-testid="module-tab-pipeline"
          aria-selected={activeModule === "pipeline"}
          onClick={() => onActiveModuleChange("pipeline")}
        >
          Pipeline
        </button>
        <button
          type="button"
          className={`cockpit-module-tab${activeModule === "automations" ? " cockpit-module-tab-active" : ""}`}
          data-testid="module-tab-automations"
          aria-selected={activeModule === "automations"}
          onClick={() => onActiveModuleChange("automations")}
        >
          Automations
        </button>
        <button
          type="button"
          className={`cockpit-module-tab${activeModule === "maintenance" ? " cockpit-module-tab-active" : ""}`}
          data-testid="module-tab-maintenance"
          aria-selected={activeModule === "maintenance"}
          onClick={() => onActiveModuleChange("maintenance")}
        >
          Maintenance
        </button>
        <button
          type="button"
          className={`cockpit-module-tab cockpit-module-tab-secondary${activeModule === "files" ? " cockpit-module-tab-active" : ""}`}
          data-testid="module-tab-files"
          aria-selected={activeModule === "files"}
          onClick={() => onActiveModuleChange("files")}
        >
          Files
        </button>
      </nav>

      <div className="cockpit-module-content">
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
            className="cockpit-legacy-surface-banner"
            data-testid="automations-legacy-banner"
            role="region"
            aria-label="Automations surface migration"
          >
            <p>Automations now live in the Cockpit v2 ten-surface shell.</p>
            <Link href="/automations" className="cockpit-action-cta">
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

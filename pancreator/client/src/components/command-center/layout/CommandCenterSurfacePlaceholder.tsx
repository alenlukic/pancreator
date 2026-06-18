import Link from "next/link";
import { SeverityChip } from "../shared/SeverityChip";
import { StatusPill } from "../shared/StatusPill";
import type { CommandCenterSurfaceConfig } from "./surface-config";

export function CommandCenterSurfacePlaceholder({
  surface,
  isKickoffStub = false,
}: {
  surface: CommandCenterSurfaceConfig;
  isKickoffStub?: boolean;
}) {
  if (isKickoffStub) {
    return (
      <div className="command-center-surface-placeholder command-center-kickoff-stub" data-testid="command-center-surface-placeholder">
        <div className="command-center-surface-card">
          <h1>Kickoff flow coming soon</h1>
          <p className="command-center-surface-description">
            Feature delivery kickoff will guide inbox intake here.
          </p>
          <Link href="/command-center" className="command-center-action-cta command-center-action-cta-secondary">
            Open command center
          </Link>
        </div>
      </div>
    );
  }

  const showReturnLink = surface.id !== "command-center";

  return (
    <div className="command-center-surface-placeholder" data-testid="command-center-surface-placeholder">
      <div className="command-center-surface-card">
        <h1>{surface.label}</h1>
        <p className="command-center-surface-description">{surface.description}</p>
        <div className="command-center-taxonomy-demo">
          <StatusPill status="Running" />
          <SeverityChip severity="Needs attention" />
        </div>
        <button type="button" className="command-center-action-cta">
          Open mission control
        </button>
        {showReturnLink ? (
          <p className="command-center-surface-hint">
            <Link href="/command-center">Return to command center</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

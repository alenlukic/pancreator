import Link from "next/link";
import { SeverityChip } from "../shared/SeverityChip";
import { StatusPill } from "../shared/StatusPill";
import type { CockpitSurfaceConfig } from "./surface-config";

export function CockpitSurfacePlaceholder({
  surface,
  isKickoffStub = false,
}: {
  surface: CockpitSurfaceConfig;
  isKickoffStub?: boolean;
}) {
  if (isKickoffStub) {
    return (
      <div className="cockpit-surface-placeholder cockpit-kickoff-stub" data-testid="cockpit-surface-placeholder">
        <div className="cockpit-surface-card">
          <h1>Kickoff flow coming soon</h1>
          <p className="cockpit-surface-description">
            Feature delivery kickoff will guide inbox intake here.
          </p>
          <Link href="/command-center" className="cockpit-action-cta cockpit-action-cta-secondary">
            Open command center
          </Link>
        </div>
      </div>
    );
  }

  const showReturnLink = surface.id !== "command-center";

  return (
    <div className="cockpit-surface-placeholder" data-testid="cockpit-surface-placeholder">
      <div className="cockpit-surface-card">
        <h1>{surface.label}</h1>
        <p className="cockpit-surface-description">{surface.description}</p>
        <div className="cockpit-taxonomy-demo">
          <StatusPill status="Running" />
          <SeverityChip severity="Needs attention" />
        </div>
        <button type="button" className="cockpit-action-cta">
          Open mission control
        </button>
        {showReturnLink ? (
          <p className="cockpit-surface-hint">
            <Link href="/command-center">Return to command center</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COCKPIT_SURFACES } from "./surface-config";
import { CockpitSurfacePlaceholder } from "./CockpitSurfacePlaceholder";

const commandCenter = COCKPIT_SURFACES.find((surface) => surface.id === "command-center")!;

describe("CockpitSurfacePlaceholder", () => {
  it("renders taxonomy demo card on first-slice surfaces", () => {
    render(<CockpitSurfacePlaceholder surface={commandCenter} />);
    expect(screen.getByTestId("cockpit-surface-placeholder")).toBeInTheDocument();
    expect(screen.getByText("Open mission control")).toBeInTheDocument();
    expect(screen.getByTestId("status-pill")).toHaveTextContent("Running");
    expect(screen.getByTestId("severity-chip")).toHaveTextContent("Needs attention");
  });

  it("renders kickoff stub copy on work intake", () => {
    const workIntake = COCKPIT_SURFACES.find((surface) => surface.id === "work-intake")!;
    render(<CockpitSurfacePlaceholder surface={workIntake} isKickoffStub />);
    expect(screen.getByText("Kickoff flow coming soon")).toBeInTheDocument();
    expect(screen.getByText("Open command center")).toBeInTheDocument();
  });
});

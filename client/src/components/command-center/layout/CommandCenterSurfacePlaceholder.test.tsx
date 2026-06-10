import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COMMAND_CENTER_SURFACES } from "./surface-config";
import { CommandCenterSurfacePlaceholder } from "./CommandCenterSurfacePlaceholder";

const commandCenter = COMMAND_CENTER_SURFACES.find((surface) => surface.id === "command-center")!;

describe("CommandCenterSurfacePlaceholder", () => {
  it("renders taxonomy demo card on first-slice surfaces", () => {
    render(<CommandCenterSurfacePlaceholder surface={commandCenter} />);
    expect(screen.getByTestId("command-center-surface-placeholder")).toBeInTheDocument();
    expect(screen.getByText("Open mission control")).toBeInTheDocument();
    expect(screen.getByTestId("status-pill-running")).toHaveTextContent("Running");
    expect(screen.getByTestId("severity-chip-needs-attention")).toHaveTextContent("Needs attention");
  });

  it("renders kickoff stub copy on work intake", () => {
    const workIntake = COMMAND_CENTER_SURFACES.find((surface) => surface.id === "work-intake")!;
    render(<CommandCenterSurfacePlaceholder surface={workIntake} isKickoffStub />);
    expect(screen.getByText("Kickoff flow coming soon")).toBeInTheDocument();
    expect(screen.getByText("Open command center")).toBeInTheDocument();
  });
});

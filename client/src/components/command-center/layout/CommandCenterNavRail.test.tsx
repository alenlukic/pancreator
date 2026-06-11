import type React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCenterShell } from "./CommandCenterShell";
import { CommandCenterNavRail } from "./CommandCenterNavRail";
import { CommandCenterMobileTabs } from "./CommandCenterMobileTabs";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const mockPathname = vi.fn(() => "/command-center");

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));

describe("CommandCenterNavRail", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/command-center");
    window.sessionStorage.clear();
  });

  it("renders five shipped destinations without Coming soon chrome", () => {
    render(<CommandCenterNavRail />);
    expect(screen.queryByText("Coming soon")).not.toBeInTheDocument();
    expect(screen.getByTestId("rail-item-command-center")).toBeInTheDocument();
    expect(screen.getByTestId("rail-item-mission-control")).toBeInTheDocument();
    expect(screen.getByTestId("rail-item-compliance")).toBeInTheDocument();
    expect(screen.getByTestId("rail-item-automations")).toBeInTheDocument();
    expect(screen.getByTestId("rail-item-activity-log")).toBeInTheDocument();
  });

  it("marks command center active for /command-center route", () => {
    render(<CommandCenterNavRail />);
    expect(screen.getByTestId("rail-item-command-center")).toHaveAttribute("aria-current", "page");
  });

  it("marks command center active when pathname is root", () => {
    mockPathname.mockReturnValue("/");
    render(<CommandCenterNavRail />);
    expect(screen.getByTestId("rail-item-command-center")).toHaveAttribute("aria-current", "page");
  });

  it("marks automations active for /automations route", () => {
    mockPathname.mockReturnValue("/automations");
    render(<CommandCenterNavRail />);
    expect(screen.getByTestId("rail-item-automations")).toHaveAttribute("aria-current", "page");
    expect(screen.getByTestId("rail-item-command-center")).not.toHaveAttribute("aria-current", "page");
  });
});

describe("CommandCenterMobileTabs", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/command-center");
  });

  it("renders six mobile tabs with Home selected", () => {
    render(<CommandCenterMobileTabs />);
    expect(screen.getByTestId("mobile-tab-command-center")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("mobile-tab-mission-control")).toHaveAttribute("aria-selected", "false");
    expect(screen.getByTestId("mobile-tab-activity-log")).toBeInTheDocument();
  });
});

describe("CommandCenterShell", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/command-center");
  });

  it("composes nav rail, main content, and mobile tabs on command center", () => {
    render(
      <CommandCenterShell>
        <div data-testid="layout-child">Surface content</div>
      </CommandCenterShell>,
    );

    expect(screen.getByTestId("command-center-shell")).toHaveClass("command-center-shell-no-inspector");
    expect(screen.getByTestId("command-center-nav-rail")).toBeInTheDocument();
    expect(screen.getByTestId("command-center-mobile-tabs")).toBeInTheDocument();
    expect(screen.queryByTestId("command-center-inspector-slot")).not.toBeInTheDocument();
    expect(screen.getByTestId("layout-child")).toBeInTheDocument();
  });

  it("does not render inspector placeholder on non-command-center routes", () => {
    mockPathname.mockReturnValue("/mission-control");
    render(
      <CommandCenterShell>
        <div data-testid="layout-child">Surface content</div>
      </CommandCenterShell>,
    );

    expect(screen.getByTestId("command-center-shell")).toHaveClass("command-center-shell-no-inspector");
    expect(screen.queryByTestId("command-center-inspector-slot")).not.toBeInTheDocument();
  });
});

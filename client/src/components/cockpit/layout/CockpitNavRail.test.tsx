import type React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import CockpitLayout from "@/app/(cockpit)/layout";
import { CockpitNavRail } from "./CockpitNavRail";
import { CockpitMobileTabs } from "./CockpitMobileTabs";

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

describe("CockpitNavRail", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/command-center");
    window.sessionStorage.clear();
  });

  it("marks command center active for /command-center route", () => {
    render(<CockpitNavRail />);
    expect(screen.getByTestId("rail-item-command-center")).toHaveAttribute("aria-current", "page");
  });

  it("marks command center active when pathname is root", () => {
    mockPathname.mockReturnValue("/");
    render(<CockpitNavRail />);
    expect(screen.getByTestId("rail-item-command-center")).toHaveAttribute("aria-current", "page");
  });
});

describe("CockpitMobileTabs", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/command-center");
  });

  it("renders first-slice mobile tabs with command center selected", () => {
    render(<CockpitMobileTabs />);
    expect(screen.getByTestId("mobile-tab-command-center")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("mobile-tab-mission-control")).toHaveAttribute("aria-selected", "false");
  });
});

describe("CockpitLayout", () => {
  beforeEach(() => {
    mockPathname.mockReturnValue("/command-center");
  });

  it("composes nav rail, main content, and mobile tabs on command center", () => {
    render(
      <CockpitLayout>
        <div data-testid="layout-child">Surface content</div>
      </CockpitLayout>,
    );

    expect(screen.getByTestId("cockpit-v2-shell")).toHaveClass("cockpit-v2-shell-no-inspector");
    expect(screen.getByTestId("cockpit-nav-rail")).toBeInTheDocument();
    expect(screen.getByTestId("cockpit-mobile-tabs")).toBeInTheDocument();
    expect(screen.queryByTestId("cockpit-inspector-slot")).not.toBeInTheDocument();
    expect(screen.getByTestId("layout-child")).toBeInTheDocument();
  });

  it("renders inspector slot on non-command-center routes", () => {
    mockPathname.mockReturnValue("/mission-control");
    render(
      <CockpitLayout>
        <div data-testid="layout-child">Surface content</div>
      </CockpitLayout>,
    );

    expect(screen.getByTestId("cockpit-v2-shell")).not.toHaveClass("cockpit-v2-shell-no-inspector");
    expect(screen.getByTestId("cockpit-inspector-slot")).toBeInTheDocument();
  });
});

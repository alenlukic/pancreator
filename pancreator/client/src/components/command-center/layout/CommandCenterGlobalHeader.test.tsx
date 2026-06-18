import type React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandCenterGlobalHeader } from "./CommandCenterGlobalHeader";

const mockUsePathname = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
}));

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

describe("CommandCenterGlobalHeader", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/command-center");
  });

  it("hides subtitle and Feature Delivery CTA on Home", () => {
    render(<CommandCenterGlobalHeader />);
    expect(screen.queryByTestId("command-center-global-header")).not.toBeInTheDocument();
    expect(screen.queryByText("Operator delivery surface")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open Feature Delivery" })).not.toBeInTheDocument();
  });

  it("hides on routes outside the shipped destination set", () => {
    mockUsePathname.mockReturnValue("/work-intake");
    render(<CommandCenterGlobalHeader />);
    expect(screen.queryByTestId("command-center-global-header")).not.toBeInTheDocument();
  });
});

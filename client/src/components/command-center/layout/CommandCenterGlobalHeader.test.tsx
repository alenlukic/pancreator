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

  it("renders Start feature delivery link on first-slice routes", () => {
    render(<CommandCenterGlobalHeader />);
    expect(screen.getByTestId("command-center-global-header")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Start feature delivery" })).toHaveAttribute(
      "href",
      "/work-intake",
    );
  });

  it("hides on non-first-slice routes", () => {
    mockUsePathname.mockReturnValue("/repo-explorer");
    render(<CommandCenterGlobalHeader />);
    expect(screen.queryByTestId("command-center-global-header")).not.toBeInTheDocument();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CommandCenterRowOverflow } from "./CommandCenterRowOverflow";

describe("CommandCenterRowOverflow", () => {
  it("reveals stage context only inside closed technical details", () => {
    render(<CommandCenterRowOverflow stageName="implement" taskId="demo-task" />);

    expect(screen.queryByText("Stage: implement")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Row actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Show technical details" }));

    expect(screen.getByText("Stage: implement")).toBeInTheDocument();
    expect(screen.getByText("Task id: demo-task")).toBeInTheDocument();
  });

  it("dismisses the menu when Escape is pressed", () => {
    render(<CommandCenterRowOverflow stageName="implement" taskId="demo-task" />);

    fireEvent.click(screen.getByRole("button", { name: "Row actions" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });
});

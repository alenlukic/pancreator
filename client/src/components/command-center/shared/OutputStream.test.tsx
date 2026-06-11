import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutputStream } from "./OutputStream";

describe("OutputStream", () => {
  it("renders guided empty state when no output lines are present", () => {
    render(<OutputStream lines={[]} inFlight={false} exitCode={null} />);

    expect(screen.getByTestId("output-stream-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Run a compliance audit or test suite above to stream command output here/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Results appear in this panel when a command finishes/i),
    ).toBeInTheDocument();
  });

  it("renders streamed lines and exit code when output is available", () => {
    render(
      <OutputStream
        lines={[{ stream: "stdout", line: "vitest output" }]}
        inFlight={false}
        exitCode={0}
      />,
    );

    expect(screen.getByTestId("output-stream-log")).toHaveTextContent("vitest output");
    expect(screen.getByTestId("output-stream-exit-code")).toHaveTextContent("Exit code: 0");
  });
});

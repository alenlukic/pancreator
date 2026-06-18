import type React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stringifyCompactJson } from "@/lib/json-io";
import { KickoffSurface } from "./KickoffSurface";

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

const inboxEntry = {
  path: "lib/inbox/in/172967_06-08-26/54352_0854_demo-kickoff.md",
  title: "Demo kickoff directive",
  slug: "demo-kickoff",
  ageHours: 1,
};

const launchEnvelope = {
  taskId: "25237_1659_demo-kickoff",
  featureId: "demo-kickoff",
  runDir: ".pan/work/172966_06-09-26/25237_1659_demo-kickoff",
  handoffFile: ".pan/work/172966_06-09-26/25237_1659_demo-kickoff/handoff.md",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(stringifyCompactJson(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function mockFetch(handlers: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const ordered = Object.entries(handlers).sort(
      (left, right) => right[0].length - left[0].length,
    );
    for (const [pattern, handler] of ordered) {
      if (url.includes(pattern)) {
        return handler(init);
      }
    }
    throw new Error(`Unhandled fetch: ${url}`);
  });
}

async function selectInboxEntry(fetchMock: ReturnType<typeof mockFetch>) {
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/inbox")));
  await act(async () => {
    fireEvent.click(screen.getByTestId("kickoff-source-inbox"));
  });
  await waitFor(
    () => expect(screen.getByRole("button", { name: "Select inbox item" })).toBeInTheDocument(),
    { timeout: 5000 },
  );
  fireEvent.click(screen.getByRole("button", { name: "Select inbox item" }));
}

async function advanceToReview() {
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByTestId("kickoff-step-preview")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByTestId("kickoff-step-models")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await waitFor(() => expect(screen.getByTestId("kickoff-step-review")).toBeInTheDocument());
}

describe("KickoffSurface", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders four-step kickoff stepper", () => {
    mockFetch({
      "/api/inbox": () => jsonResponse({ entries: [] }),
    });
    render(<KickoffSurface />);
    expect(screen.getByTestId("kickoff-surface")).toBeInTheDocument();
    expect(screen.getByTestId("kickoff-stepper")).toBeInTheDocument();
    expect(screen.getByTestId("kickoff-stepper")).toHaveTextContent("Choose source");
    expect(screen.getByTestId("kickoff-stepper")).toHaveTextContent("Preview directive");
    expect(screen.getByTestId("kickoff-stepper")).toHaveTextContent("Configure models");
    expect(screen.getByTestId("kickoff-stepper")).toHaveTextContent("Review and launch");
  });

  it("preserves state on backward navigation for inbox source", async () => {
    const fetchMock = mockFetch({
      "/api/inbox": () => jsonResponse({ entries: [inboxEntry] }),
      "/api/file": () =>
        jsonResponse({
          content: "# Demo kickoff directive\n\n## Problem\n\nTest body\n",
        }),
    });

    render(<KickoffSurface />);
    await selectInboxEntry(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    await waitFor(() => expect(screen.getByTestId("kickoff-step-preview")).toBeInTheDocument());
    const editor = screen.getByLabelText("Directive markdown") as HTMLTextAreaElement;
    expect(editor.value).toContain("Demo kickoff directive");

    fireEvent.change(editor, { target: { value: "# Edited directive\n\nCarry forward\n" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("kickoff-step-models")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Go back" }));
    await waitFor(() => expect(screen.getByTestId("kickoff-step-preview")).toBeInTheDocument());
    expect((screen.getByLabelText("Directive markdown") as HTMLTextAreaElement).value).toContain(
      "Edited directive",
    );
  });

  it("covers URL source happy path through launch", async () => {
    mockFetch({
      "/api/inbox": () => jsonResponse({ entries: [] }),
      "/api/kickoff/url": () =>
        jsonResponse({
          title: "Example Spec",
          excerpt: "Example excerpt",
          directiveSeed: "# Example Spec\n\n## Problem\n\nExample excerpt\n",
        }),
      "/api/kickoff/save": () =>
        jsonResponse({ path: "lib/inbox/in/172967_06-08-26/99999_1200_example-spec.md" }),
      "/api/kickoff/launch": () => jsonResponse(launchEnvelope),
    });

    render(<KickoffSurface />);
    fireEvent.click(screen.getByTestId("kickoff-source-url"));
    fireEvent.change(screen.getByLabelText("Paste page URL"), {
      target: { value: "https://example.com/spec" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fetch page context" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
    );

    await advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: "Launch feature delivery" }));

    await waitFor(() => expect(screen.getByTestId("kickoff-launch-success")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Open mission control" })).toHaveAttribute(
      "href",
      "/mission-control",
    );
  });

  it("covers raw text source happy path through launch", async () => {
    mockFetch({
      "/api/inbox": () => jsonResponse({ entries: [] }),
      "/api/kickoff/save": () =>
        jsonResponse({ path: "lib/inbox/in/172967_06-08-26/99999_1200_raw-text.md" }),
      "/api/kickoff/launch": () => jsonResponse(launchEnvelope),
    });

    render(<KickoffSurface />);
    fireEvent.click(screen.getByTestId("kickoff-source-raw-text"));
    fireEvent.change(screen.getByLabelText("Paste markdown"), {
      target: { value: "# Raw kickoff\n\n## Problem\n\nFrom textarea\n" },
    });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).not.toBeDisabled(),
    );

    await advanceToReview();
    fireEvent.click(screen.getByRole("button", { name: "Launch feature delivery" }));

    await waitFor(() => expect(screen.getByTestId("kickoff-launch-success")).toBeInTheDocument());
  });

  it("covers inbox source happy path through launch", async () => {
    const fetchMock = mockFetch({
      "/api/inbox": () => jsonResponse({ entries: [inboxEntry] }),
      "/api/file": () =>
        jsonResponse({
          content: "# Demo kickoff directive\n\n## Problem\n\nInbox body\n",
        }),
      "/api/kickoff/launch": () => jsonResponse(launchEnvelope),
    });

    render(<KickoffSurface />);
    await selectInboxEntry(fetchMock);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("kickoff-step-preview")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("kickoff-step-models")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(screen.getByTestId("kickoff-step-review")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Launch feature delivery" }));
    await waitFor(() => expect(screen.getByTestId("kickoff-launch-success")).toBeInTheDocument());
  });
});

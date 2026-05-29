import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardPage } from "@/components/DashboardPage";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders navigation for the five repository domains", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/activity")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/list")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<DashboardPage />);

    expect(screen.getByTestId("domain-inbox")).toBeInTheDocument();
    expect(screen.getByTestId("domain-memory")).toBeInTheDocument();
    expect(screen.getByTestId("domain-personas")).toBeInTheDocument();
    expect(screen.getByTestId("domain-work")).toBeInTheDocument();
    expect(screen.getByTestId("domain-packages")).toBeInTheDocument();
    expect(screen.getByTestId("domain-inbox")).toHaveTextContent("src/inbox/");
    expect(screen.getByTestId("domain-memory")).toHaveTextContent("src/memory/");
    expect(screen.getByTestId("domain-personas")).toHaveTextContent("src/personas/");
    expect(screen.getByTestId("domain-work")).toHaveTextContent("src/work/");
    expect(screen.getByTestId("domain-packages")).toHaveTextContent("src/internal/packages/");
  });

  it("opens the inline modal with file content", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/activity")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/list")) {
        return new Response(
          JSON.stringify({
            entries: [{ path: "src/memory/sample.md", name: "sample.md", kind: "file" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/file")) {
        return new Response(JSON.stringify({ content: "modal content" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("sample.md")).toBeInTheDocument();
    });

    screen.getByText("sample.md").click();

    await waitFor(() => {
      expect(screen.getByTestId("file-modal")).toBeInTheDocument();
      expect(screen.getByDisplayValue("modal content")).toBeInTheDocument();
    });
  });

  it("drills into directories instead of opening them as files", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/activity")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("/api/list?path=src%2Fmemory%2Ffeatures")) {
        return new Response(
          JSON.stringify({
            entries: [{ path: "src/memory/features/spec.md", name: "spec.md", kind: "file" }],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/api/list?path=src%2Fmemory")) {
        return new Response(
          JSON.stringify({
            entries: [{ path: "src/memory/features", name: "features", kind: "directory" }],
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ entries: [] }), { status: 200 });
    });

    render(<DashboardPage />);

    screen.getByTestId("domain-memory").querySelector("button")?.click();

    await waitFor(() => {
      expect(screen.getByText("features")).toBeInTheDocument();
    });

    screen.getByText("features").click();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/list?path=src%2Fmemory%2Ffeatures"));
      expect(screen.getByText("spec.md")).toBeInTheDocument();
    });
  });

  it("renders reverse-chronological activity entries", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/activity")) {
        return new Response(
          JSON.stringify([
            {
              timestamp: "2026-05-02T12:00:00.000Z",
              title: "Newer event",
              description: "Second",
            },
            {
              timestamp: "2026-05-01T12:00:00.000Z",
              title: "Older event",
              description: "First",
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/api/list")) {
        return new Response(JSON.stringify({ entries: [] }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<DashboardPage />);

    await waitFor(() => {
      const feed = screen.getByTestId("activity-feed");
      const titles = [...feed.querySelectorAll("h4")].map((node) => node.textContent);
      expect(titles).toEqual(["Newer event", "Older event"]);
    });
  });
});

"use client";

import { useMemo, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import { findActiveStage, type TaskRunStateEnvelope } from "@/services/run-state-shared";

type ChecklistRow = {
  id: "pan-check" | "compliance" | "client";
  label: string;
  status: "pending" | "running" | "pass" | "fail";
};

const PRE_CLOSE_ROWS: Array<{ id: ChecklistRow["id"]; label: string }> = [
  { id: "pan-check", label: "pnpm -w exec pan check" },
  { id: "compliance", label: "node lib/internal/tools/run-compliance.mjs" },
  { id: "client", label: "pnpm test" },
];

function parseSseExitCode(body: string): number {
  for (const chunk of body.split("\n\n")) {
    if (!chunk.includes("event: exit")) {
      continue;
    }
    const dataLine = chunk.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) {
      continue;
    }
    const payload = JSON.parse(dataLine.slice("data:".length).trim()) as { exitCode: number };
    return payload.exitCode;
  }
  return 1;
}

export function PreCloseValidationPanel({
  tasks,
  selectedTaskId,
  onNavigateToMaintenance,
}: {
  tasks: TaskRunStateEnvelope[];
  selectedTaskId: string | null;
  onNavigateToMaintenance: () => void;
}) {
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<ChecklistRow[]>(
    PRE_CLOSE_ROWS.map((row) => ({ ...row, status: "pending" })),
  );

  const selectedTask = useMemo(
    () => tasks.find((task) => task.taskId === selectedTaskId) ?? tasks[0],
    [selectedTaskId, tasks],
  );

  const activeStage = selectedTask ? findActiveStage(selectedTask) : undefined;
  const eligible = activeStage?.name === "ship" || activeStage?.name === "index";

  async function runPreCloseBundle(rowId: ChecklistRow["id"]): Promise<number> {
    if (rowId === "compliance") {
      const response = await fetch("/api/compliance-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({}),
      });
      const payload = (await response.json()) as { exitCode?: number; status?: string };
      if (!response.ok) {
        return 1;
      }
      return payload.exitCode ?? (payload.status === "pass" ? 0 : 1);
    }

    const suite = rowId === "pan-check" ? "pan-check" : "client";
    const response = await fetch("/api/test-run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: stringifyCompactJson({ suite }),
    });
    if (!response.ok) {
      return 1;
    }
    const body = await response.text();
    return parseSseExitCode(body);
  }

  async function runPreCloseValidation() {
    setRunning(true);
    setRows(PRE_CLOSE_ROWS.map((row) => ({ ...row, status: "pending" })));

    for (const row of PRE_CLOSE_ROWS) {
      setRows((current) =>
        current.map((entry) =>
          entry.id === row.id ? { ...entry, status: "running" } : entry,
        ),
      );
      const exitCode = await runPreCloseBundle(row.id);
      setRows((current) =>
        current.map((entry) =>
          entry.id === row.id ? { ...entry, status: exitCode === 0 ? "pass" : "fail" } : entry,
        ),
      );
      if (exitCode !== 0) {
        break;
      }
    }

    setRunning(false);
  }

  return (
    <section className="pre-close-validation-panel" data-testid="pre-close-validation-panel">
      <div className="pre-close-validation-header">
        <h2>Pre-close validation</h2>
        <button
          type="button"
          className="command-center-action-button"
          data-testid="pre-close-run-button"
          disabled={!eligible || running}
          aria-busy={running}
          onClick={() => void runPreCloseValidation()}
        >
          Run pre-close preset
        </button>
      </div>

      {!eligible ? (
        <p className="pre-close-validation-helper" data-testid="pre-close-eligibility-helper">
          Pre-close validation is available when the selected task is in the ship or index stage.
        </p>
      ) : null}

      {eligible ? (
        <ul className="pre-close-checklist">
          {rows.map((row) => (
            <li key={row.id} data-testid={`pre-close-row-${row.id}`}>
              <span className={`pre-close-status pre-close-status-${row.status}`}>{row.status}</span>
              <span>{row.label}</span>
              {row.status === "fail" ? (
                <button
                  type="button"
                  className="pre-close-maintenance-link"
                  data-testid={`pre-close-maintenance-link-${row.id}`}
                  onClick={onNavigateToMaintenance}
                >
                  View in Maintenance
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

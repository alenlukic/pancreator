"use client";

import { useMemo, useState } from "react";
import { stringifyCompactJson } from "@/lib/json-io";
import { SUITE_DEFINITIONS, type SuiteId } from "@/services/maintenance-suite-presets";
import type { OutputLine } from "../shared/OutputStream";

export type SessionRunRecord = {
  id: string;
  suite: SuiteId;
  label: string;
  command: string;
  startedAt: string;
  exitCode: number | null;
};

function parseSseChunk(rawChunk: string): { event?: string; data?: string } {
  const lines = rawChunk.split("\n");
  let event: string | undefined;
  let data: string | undefined;
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    }
    if (line.startsWith("data:")) {
      data = line.slice("data:".length).trim();
    }
  }
  return { event, data };
}

export function TestSuitePicker({
  onOutput,
  onRunStart,
}: {
  onOutput: (lines: OutputLine[], exitCode: number | null, inFlight: boolean, command?: string) => void;
  onRunStart: () => void;
}) {
  const [selectedSuite, setSelectedSuite] = useState<SuiteId>("client");
  const [running, setRunning] = useState(false);
  const [history, setHistory] = useState<SessionRunRecord[]>([]);

  const activeDefinition = useMemo(
    () => SUITE_DEFINITIONS.find((entry) => entry.id === selectedSuite) ?? SUITE_DEFINITIONS[0],
    [selectedSuite],
  );

  async function runSelectedSuite() {
    onRunStart();
    setRunning(true);
    const startedAt = new Date().toISOString();
    const runId = `${Date.now()}`;
    const lines: OutputLine[] = [];
    onOutput(lines, null, true, activeDefinition.command);

    try {
      const response = await fetch("/api/test-run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stringifyCompactJson({ suite: selectedSuite }),
      });
      if (!response.ok || response.body === null) {
        const payload = (await response.json()) as { error?: string };
        throw new Error(payload.error ?? "Test run failed");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let exitCode: number | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() ?? "";
        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk);
          if (parsed.event === "exit" && parsed.data) {
            exitCode = (JSON.parse(parsed.data) as { exitCode: number }).exitCode;
          } else if (parsed.data) {
            const payload = JSON.parse(parsed.data) as {
              stream?: "stdout" | "stderr";
              line?: string;
            };
            if (payload.stream && payload.line) {
              lines.push({ stream: payload.stream, line: payload.line });
              onOutput([...lines], null, true, activeDefinition.command);
            }
          }
        }
      }

      const resolvedExitCode = exitCode ?? 1;
      onOutput([...lines], resolvedExitCode, false, activeDefinition.command);
      setHistory((current) => [
        {
          id: runId,
          suite: selectedSuite,
          label: activeDefinition.label,
          command: activeDefinition.command,
          startedAt,
          exitCode: resolvedExitCode,
        },
        ...current,
      ]);
    } catch (runError) {
      onOutput(
        [
          {
            stream: "stderr",
            line: runError instanceof Error ? runError.message : "Test run failed",
          },
        ],
        1,
        false,
        activeDefinition.command,
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="test-suite-picker" data-testid="test-suite-picker">
      <div className="test-suite-picker-header">
        <h2>Test suites</h2>
        <button
          type="button"
          className="cockpit-action-button"
          data-testid="test-suite-run-button"
          disabled={running}
          aria-busy={running}
          onClick={() => void runSelectedSuite()}
        >
          Run selected suite
        </button>
      </div>

      <div className="test-suite-presets" role="group" aria-label="Test suite presets">
        {SUITE_DEFINITIONS.map((definition) => (
          <button
            key={definition.id}
            type="button"
            className={`test-suite-preset${selectedSuite === definition.id ? " test-suite-preset-active" : ""}`}
            data-testid={`test-suite-preset-${definition.id}`}
            aria-pressed={selectedSuite === definition.id}
            disabled={running}
            onClick={() => setSelectedSuite(definition.id)}
          >
            {definition.label}
          </button>
        ))}
      </div>

      {history.length > 0 ? (
        <div className="test-suite-history" data-testid="test-suite-history">
          <h3>Session history</h3>
          <ul className="test-suite-history-list">
            {history.map((entry) => (
              <li key={entry.id} data-testid={`test-suite-history-${entry.id}`}>
                <span>{entry.label}</span>
                <span className="test-suite-history-meta">
                  {entry.startedAt} · exit {entry.exitCode ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

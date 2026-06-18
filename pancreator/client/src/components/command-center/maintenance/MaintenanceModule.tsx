"use client";

import { useState } from "react";
import { ComplianceAuditPanel } from "./ComplianceAuditPanel";
import { TestSuitePicker } from "./TestSuitePicker";
import { OutputStream, type OutputLine } from "../shared/OutputStream";

export function MaintenanceModule({
  onOpenAuditHistory,
}: {
  onOpenAuditHistory: (path: string) => void;
}) {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [copyCommand, setCopyCommand] = useState<string | undefined>(undefined);
  const [runKey, setRunKey] = useState("initial");

  function handleRunStart() {
    setRunKey(`${Date.now()}`);
    setLines([]);
    setExitCode(null);
  }

  function handleOutput(
    nextLines: OutputLine[],
    nextExitCode: number | null,
    nextInFlight: boolean,
    command?: string,
  ) {
    setLines(nextLines);
    setExitCode(nextExitCode);
    setInFlight(nextInFlight);
    if (command) {
      setCopyCommand(command);
    }
  }

  return (
    <div className="maintenance-module" data-testid="maintenance-module">
      <div className="maintenance-module-body">
        <ComplianceAuditPanel
          onRunStart={handleRunStart}
          onOutput={handleOutput}
          onOpenAuditHistory={onOpenAuditHistory}
        />
        <TestSuitePicker onRunStart={handleRunStart} onOutput={handleOutput} />
      </div>
      <OutputStream
        lines={lines}
        inFlight={inFlight}
        exitCode={exitCode}
        copyCommand={copyCommand}
        resetKey={runKey}
      />
    </div>
  );
}

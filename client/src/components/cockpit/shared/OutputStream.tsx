"use client";

import { useEffect, useRef, useState } from "react";
import { CopyCommandButton } from "./CopyCommandButton";

export type OutputLine = {
  stream: "stdout" | "stderr";
  line: string;
};

export function OutputStream({
  lines,
  inFlight,
  exitCode,
  copyCommand,
  resetKey,
}: {
  lines: OutputLine[];
  inFlight: boolean;
  exitCode: number | null;
  copyCommand?: string;
  resetKey?: string;
}) {
  const containerRef = useRef<HTMLPreElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    setAutoScroll(true);
  }, [resetKey]);

  useEffect(() => {
    if (!autoScroll || containerRef.current === null) {
      return;
    }
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [autoScroll, lines, inFlight]);

  function handleScroll() {
    const node = containerRef.current;
    if (node === null) {
      return;
    }
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 24;
    setAutoScroll(atBottom);
  }

  const exitClass =
    exitCode !== null && exitCode !== 0 ? " output-stream-exit-nonzero" : "";

  return (
    <section className="output-stream-panel" data-testid="output-stream-panel" aria-busy={inFlight}>
      <div className="output-stream-header">
        <h3>Output</h3>
        {copyCommand ? <CopyCommandButton command={copyCommand} /> : null}
      </div>
      <pre
        ref={containerRef}
        className={`output-stream-log${prefersReducedMotion ? " output-stream-reduced-motion" : ""}`}
        data-testid="output-stream-log"
        onScroll={handleScroll}
      >
        {lines.map((entry, index) => (
          <span
            key={`${resetKey ?? "run"}-${index}`}
            className={`output-stream-line output-stream-${entry.stream}`}
          >
            {entry.line}
            {"\n"}
          </span>
        ))}
        {inFlight ? <span className="output-stream-line">Running…</span> : null}
      </pre>
      {exitCode !== null ? (
        <p
          className={`output-stream-exit${exitClass}`}
          data-testid="output-stream-exit-code"
          aria-live="polite"
        >
          Exit code: {exitCode}
        </p>
      ) : null}
    </section>
  );
}

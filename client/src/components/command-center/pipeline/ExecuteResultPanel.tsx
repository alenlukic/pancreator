"use client";

import type { PanExecuteResult } from "@/services/run-state-shared";

export function ExecuteResultPanel({ result }: { result: PanExecuteResult | null }) {
  if (result === null) {
    return null;
  }

  const failed = result.exitCode !== 0;

  return (
    <section
      className={`execute-result-panel${failed ? " execute-result-panel-failed" : ""}`}
      data-testid="execute-result-panel"
    >
      <h3>Execute result</h3>
      {result.deferralMessage ? <p className="execute-deferral-message">{result.deferralMessage}</p> : null}
      <dl className="execute-result-fields">
        <div>
          <dt>Exit code</dt>
          <dd data-testid="execute-exit-code">{result.exitCode}</dd>
        </div>
        <div>
          <dt>stdout</dt>
          <dd>
            <pre data-testid="execute-stdout">{result.stdout || "—"}</pre>
          </dd>
        </div>
        <div>
          <dt>stderr</dt>
          <dd>
            <pre data-testid="execute-stderr">{result.stderr || "—"}</pre>
          </dd>
        </div>
      </dl>
    </section>
  );
}

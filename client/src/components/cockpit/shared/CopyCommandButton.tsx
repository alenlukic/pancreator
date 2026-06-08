"use client";

import { useEffect, useState } from "react";

export function CopyCommandButton({
  command,
  label = "Copy command",
}: {
  command: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const disabled = command.trim().length === 0;

  useEffect(() => {
    if (!copied) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopied(false);
    }, 2000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copied]);

  async function handleCopy() {
    if (disabled) {
      return;
    }
    await navigator.clipboard.writeText(command);
    setCopied(true);
  }

  return (
    <span className="copy-command-wrap">
      <button
        type="button"
        className="cockpit-action-button"
        data-testid="copy-command-button"
        disabled={disabled}
        onClick={() => void handleCopy()}
      >
        {disabled ? `${label} (none)` : label}
      </button>
      {copied ? (
        <span className="copy-command-tooltip" aria-live="polite">
          Copied
        </span>
      ) : null}
    </span>
  );
}

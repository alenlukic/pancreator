"use client";

import { MoreHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function CommandCenterRowOverflow({
  taskId,
  runDir,
  inboxSource,
  runCommand,
  stageName,
}: {
  taskId?: string;
  runDir?: string;
  inboxSource?: string;
  runCommand?: string;
  stageName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setShowDetails(false);
      return undefined;
    }
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function copyText(label: string, value: string | undefined) {
    if (!value) {
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(null), 1500);
  }

  const hasOverflow =
    runCommand !== undefined ||
    inboxSource !== undefined ||
    taskId !== undefined ||
    runDir !== undefined ||
    stageName !== undefined;

  if (!hasOverflow) {
    return null;
  }

  return (
    <div className="command-center-row-overflow-wrap" ref={menuRef}>
      <button
        type="button"
        className="command-center-row-overflow"
        aria-label="Row actions"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreHorizontal aria-hidden="true" size={16} />
      </button>
      {open ? (
        <div className="command-center-overflow-menu" role="menu">
          {runCommand ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void copyText("run", runCommand)}
            >
              Copy run command
            </button>
          ) : null}
          {inboxSource ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void copyText("inbox", inboxSource)}
            >
              Copy inbox path
            </button>
          ) : null}
          {taskId || runDir || stageName ? (
            <button
              type="button"
              role="menuitem"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((current) => !current)}
            >
              Show technical details
            </button>
          ) : null}
          {showDetails ? (
            <div className="command-center-overflow-details" data-testid="overflow-technical-details">
              {stageName ? <p>Stage: {stageName}</p> : null}
              {taskId ? <p>Task id: {taskId}</p> : null}
              {runDir ? <p>Run directory: {runDir}</p> : null}
            </div>
          ) : null}
          {copied ? (
            <span className="command-center-overflow-copied" aria-live="polite">
              Copied
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

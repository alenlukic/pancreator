"use client";

import { useState, type ReactNode } from "react";

export function MetadataDisclosure({
  label,
  children,
  defaultOpen = false,
  testId = "metadata-disclosure",
}: {
  label: string;
  children: ReactNode;
  defaultOpen?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="metadata-disclosure" data-testid={testId}>
      <button
        type="button"
        className="metadata-disclosure-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? `Hide ${label}` : `Show ${label}`}
      </button>
      {open ? (
        <div className="metadata-disclosure-panel" data-testid={`${testId}-panel`}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

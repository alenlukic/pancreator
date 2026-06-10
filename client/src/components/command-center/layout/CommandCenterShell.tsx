"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CommandCenterGlobalHeader } from "./CommandCenterGlobalHeader";
import { CommandCenterInspectorSlot } from "./CommandCenterInspectorSlot";
import { CommandCenterMobileTabs } from "./CommandCenterMobileTabs";
import { CommandCenterNavRail } from "./CommandCenterNavRail";
import { filterCommandPaletteActions } from "./surface-config";

function isCommandCenterRoute(pathname: string): boolean {
  return pathname === "/command-center" || pathname === "/";
}

export function CommandCenterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideInspector = isCommandCenterRoute(pathname);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    setPaletteQuery("");
  }, []);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setPaletteQuery("");
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
      if (event.key === "Escape" && paletteOpen) {
        closePalette();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closePalette, openPalette, paletteOpen]);

  useEffect(() => {
    if (paletteOpen) {
      inputRef.current?.focus();
    }
  }, [paletteOpen]);

  const paletteActions = filterCommandPaletteActions(
    paletteQuery,
    paletteQuery.toLowerCase().includes("abort") || paletteQuery.toLowerCase().includes("destructive"),
  );

  return (
    <div
      className={`command-center-shell${hideInspector ? " command-center-shell-no-inspector" : ""}`}
      data-testid="command-center-shell"
    >
      <div className="command-center-shell-body">
        <CommandCenterNavRail onOpenCommandPalette={openPalette} />
        <main className="command-center-main" id="command-center-main">
          <CommandCenterGlobalHeader onOpenCommandPalette={openPalette} />
          {children}
        </main>
        {hideInspector ? null : <CommandCenterInspectorSlot />}
      </div>
      <CommandCenterMobileTabs />

      {paletteOpen ? (
        <div
          className="command-center-cmdk-overlay"
          data-testid="command-palette"
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
        >
          <div className="command-center-cmdk-panel">
            <input
              ref={inputRef}
              className="command-center-cmdk-input"
              data-testid="command-palette-input"
              value={paletteQuery}
              onChange={(event) => setPaletteQuery(event.target.value)}
              placeholder="Search destinations and actions"
              aria-label="Search destinations and actions"
            />
            <ul className="command-center-cmdk-list" role="listbox">
              {paletteActions.map((action) => (
                <li key={action.id}>
                  {action.href ? (
                    <Link
                      href={action.href}
                      className={`command-center-cmdk-item${action.destructive ? " command-center-cmdk-item-destructive" : ""}`}
                      data-testid={`cmdk-action-${action.id}`}
                      onClick={closePalette}
                    >
                      <span className="command-center-cmdk-group">{action.group}</span>
                      {action.label}
                    </Link>
                  ) : (
                    <span className="command-center-cmdk-item">{action.label}</span>
                  )}
                </li>
              ))}
            </ul>
            <button type="button" className="command-center-cmdk-close" onClick={closePalette}>
              Close
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

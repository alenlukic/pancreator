"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CommandCenterGlobalHeader } from "./CommandCenterGlobalHeader";
import { CommandCenterInspectorSlot } from "./CommandCenterInspectorSlot";
import { CommandCenterMobileTabs } from "./CommandCenterMobileTabs";
import { CommandCenterNavRail } from "./CommandCenterNavRail";

function isCommandCenterRoute(pathname: string): boolean {
  return pathname === "/command-center" || pathname === "/";
}

export function CommandCenterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideInspector = isCommandCenterRoute(pathname);

  return (
    <div
      className={`command-center-shell${hideInspector ? " command-center-shell-no-inspector" : ""}`}
      data-testid="command-center-shell"
    >
      <div className="command-center-shell-body">
        <CommandCenterNavRail />
        <main className="command-center-main" id="command-center-main">
          <CommandCenterGlobalHeader />
          {children}
        </main>
        {hideInspector ? null : <CommandCenterInspectorSlot />}
      </div>
      <CommandCenterMobileTabs />
    </div>
  );
}

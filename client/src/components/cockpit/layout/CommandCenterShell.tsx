"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CockpitGlobalHeader } from "./CockpitGlobalHeader";
import { CockpitInspectorSlot } from "./CockpitInspectorSlot";
import { CockpitMobileTabs } from "./CockpitMobileTabs";
import { CockpitNavRail } from "./CockpitNavRail";

function isCommandCenterRoute(pathname: string): boolean {
  return pathname === "/command-center" || pathname === "/";
}

export function CommandCenterShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const hideInspector = isCommandCenterRoute(pathname);

  return (
    <div
      className={`cockpit-v2-shell${hideInspector ? " cockpit-v2-shell-no-inspector" : ""}`}
      data-testid="cockpit-v2-shell"
    >
      <div className="cockpit-v2-shell-body">
        <CockpitNavRail />
        <main className="cockpit-v2-main" id="cockpit-main">
          <CockpitGlobalHeader />
          {children}
        </main>
        {hideInspector ? null : <CockpitInspectorSlot />}
      </div>
      <CockpitMobileTabs />
    </div>
  );
}

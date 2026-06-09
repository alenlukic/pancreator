"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CockpitInspectorSlot } from "@/components/cockpit/layout/CockpitInspectorSlot";
import { CockpitMobileTabs } from "@/components/cockpit/layout/CockpitMobileTabs";
import { CockpitNavRail } from "@/components/cockpit/layout/CockpitNavRail";

function isCommandCenterRoute(pathname: string): boolean {
  return pathname === "/command-center" || pathname === "/";
}

export default function CockpitLayout({ children }: { children: ReactNode }) {
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
          {children}
        </main>
        {hideInspector ? null : <CockpitInspectorSlot />}
      </div>
      <CockpitMobileTabs />
    </div>
  );
}

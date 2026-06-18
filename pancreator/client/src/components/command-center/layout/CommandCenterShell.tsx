"use client";

import type { ReactNode } from "react";
import { CommandCenterGlobalHeader } from "./CommandCenterGlobalHeader";
import { CommandCenterMobileTabs } from "./CommandCenterMobileTabs";
import { CommandCenterNavRail } from "./CommandCenterNavRail";

export function CommandCenterShell({ children }: { children: ReactNode }) {
  return (
    <div
      className="command-center-shell command-center-shell-no-inspector"
      data-testid="command-center-shell"
    >
      <div className="command-center-shell-body">
        <CommandCenterNavRail />
        <main className="command-center-main" id="command-center-main">
          <CommandCenterGlobalHeader />
          {children}
        </main>
      </div>
      <CommandCenterMobileTabs />
    </div>
  );
}

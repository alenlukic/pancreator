import type { ReactNode } from "react";

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="cockpit-empty-state">{children}</div>;
}

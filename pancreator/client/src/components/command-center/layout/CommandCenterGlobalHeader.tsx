"use client";

import { usePathname } from "next/navigation";
import { FIRST_SLICE_SURFACES } from "./surface-config";

export function CommandCenterGlobalHeader() {
  const pathname = usePathname();
  const normalized = pathname === "/" ? "/command-center" : pathname;

  if (normalized === "/command-center" || normalized === "/") {
    return null;
  }

  const isFirstSlice = FIRST_SLICE_SURFACES.some((surface) => surface.route === normalized);

  if (!isFirstSlice) {
    return null;
  }

  return (
    <header className="command-center-global-header" data-testid="command-center-global-header">
      <div className="command-center-global-header-copy">
        <p className="command-center-global-header-eyebrow">Command Center</p>
      </div>
    </header>
  );
}

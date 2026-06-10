"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FIRST_SLICE_SURFACES } from "./surface-config";

export function CommandCenterGlobalHeader() {
  const pathname = usePathname();
  const normalized = pathname === "/" ? "/command-center" : pathname;
  const isFirstSlice = FIRST_SLICE_SURFACES.some((surface) => surface.route === normalized);

  if (!isFirstSlice) {
    return null;
  }

  return (
    <header className="command-center-global-header" data-testid="command-center-global-header">
      <div className="command-center-global-header-copy">
        <p className="command-center-global-header-eyebrow">Command Center</p>
        <p className="command-center-global-header-title">Operator delivery surface</p>
      </div>
      <Link href="/work-intake" className="command-center-global-header-cta">
        Start feature delivery
      </Link>
    </header>
  );
}

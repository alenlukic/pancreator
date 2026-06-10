"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FIRST_SLICE_SURFACES } from "./surface-config";

export function CockpitGlobalHeader() {
  const pathname = usePathname();
  const normalized = pathname === "/" ? "/command-center" : pathname;
  const isFirstSlice = FIRST_SLICE_SURFACES.some((surface) => surface.route === normalized);

  if (!isFirstSlice) {
    return null;
  }

  return (
    <header className="cockpit-global-header" data-testid="cockpit-global-header">
      <div className="cockpit-global-header-copy">
        <p className="cockpit-global-header-eyebrow">Command Center</p>
        <p className="cockpit-global-header-title">Operator delivery surface</p>
      </div>
      <Link href="/work-intake" className="cockpit-global-header-cta">
        Start feature delivery
      </Link>
    </header>
  );
}

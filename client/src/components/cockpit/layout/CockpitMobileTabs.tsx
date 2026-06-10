"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSurfaceByRoute, MOBILE_TAB_SURFACES } from "./surface-config";

export function CockpitMobileTabs() {
  const pathname = usePathname();
  const activeSurface = getSurfaceByRoute(pathname);

  return (
    <nav
      className="cockpit-mobile-tabs"
      role="tablist"
      aria-label="Command Center surfaces"
      data-testid="cockpit-mobile-tabs"
    >
      {MOBILE_TAB_SURFACES.map((surface) => {
        const isActive = activeSurface?.id === surface.id;
        return (
          <Link
            key={surface.id}
            href={surface.route}
            role="tab"
            className={`cockpit-mobile-tab${isActive ? " cockpit-mobile-tab-active" : ""}`}
            data-testid={`mobile-tab-${surface.id}`}
            aria-selected={isActive}
          >
            <span className="cockpit-mobile-tab-icon" aria-hidden="true">
              {surface.icon}
            </span>
            <span className="cockpit-mobile-tab-label">{surface.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

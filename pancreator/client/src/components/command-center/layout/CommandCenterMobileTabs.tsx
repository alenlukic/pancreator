"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getSurfaceByRoute, MOBILE_TAB_SURFACES } from "./surface-config";
import { getSurfaceIcon } from "./surface-icons";

export function CommandCenterMobileTabs() {
  const pathname = usePathname();
  const activeSurface = getSurfaceByRoute(pathname);

  return (
    <nav
      className="command-center-mobile-tabs"
      role="tablist"
      aria-label="Command Center surfaces"
      data-testid="command-center-mobile-tabs"
    >
      {MOBILE_TAB_SURFACES.map((surface) => {
        const isActive = activeSurface?.id === surface.id;
        const Icon = getSurfaceIcon(surface.id);
        return (
          <Link
            key={surface.id}
            href={surface.route}
            role="tab"
            className={`command-center-mobile-tab${isActive ? " command-center-mobile-tab-active" : ""}`}
            data-testid={`mobile-tab-${surface.id}`}
            aria-selected={isActive}
            aria-label={surface.label}
          >
            <span className="command-center-mobile-tab-icon" aria-hidden="true">
              <Icon size={20} strokeWidth={1.75} />
            </span>
            <span className="command-center-mobile-tab-label">{surface.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

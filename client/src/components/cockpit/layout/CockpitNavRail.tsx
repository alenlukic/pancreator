"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { COCKPIT_SURFACES, getSurfaceByRoute, type CockpitSurfaceConfig } from "./surface-config";

const RAIL_COLLAPSE_KEY = "cockpit-rail-collapsed";
const DESKTOP_RAIL_QUERY = "(min-width: 1280px)";

export function CockpitNavRail() {
  const pathname = usePathname();
  const listRef = useRef<HTMLUListElement>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [isDesktopWide, setIsDesktopWide] = useState(false);
  const activeSurface = getSurfaceByRoute(pathname);
  const railCollapsed = collapsed && !isDesktopWide;

  useEffect(() => {
    const stored = window.sessionStorage.getItem(RAIL_COLLAPSE_KEY);
    setCollapsed(stored === "true");
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia(DESKTOP_RAIL_QUERY);
    const syncDesktopWide = () => {
      const desktop = media.matches;
      setIsDesktopWide(desktop);
      if (desktop && window.sessionStorage.getItem(RAIL_COLLAPSE_KEY) === "true") {
        window.sessionStorage.removeItem(RAIL_COLLAPSE_KEY);
        setCollapsed(false);
      }
    };
    syncDesktopWide();
    media.addEventListener("change", syncDesktopWide);
    return () => media.removeEventListener("change", syncDesktopWide);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      window.sessionStorage.setItem(RAIL_COLLAPSE_KEY, String(next));
      return next;
    });
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent, index: number) => {
      const items = COCKPIT_SURFACES;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = (index + 1) % items.length;
        listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-rail-item]")[next]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        const next = (index - 1 + items.length) % items.length;
        listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-rail-item]")[next]?.focus();
      } else if (event.key === "Enter" && !items[index].firstSlice) {
        event.preventDefault();
      }
    },
    [],
  );

  return (
    <nav
      className={`cockpit-nav-rail${railCollapsed ? " cockpit-nav-rail-collapsed" : ""}`}
      role="navigation"
      aria-label="Command Center surfaces"
      data-testid="cockpit-nav-rail"
    >
      <button
        type="button"
        className="cockpit-rail-collapse-toggle"
        data-testid="rail-collapse-toggle"
        onClick={toggleCollapsed}
      >
        {railCollapsed ? "Expand navigation" : "Collapse navigation"}
      </button>
      <ul ref={listRef} className="cockpit-nav-rail-list">
        {COCKPIT_SURFACES.map((surface, index) => (
          <CockpitNavRailItem
            key={surface.id}
            surface={surface}
            isActive={activeSurface?.id === surface.id}
            collapsed={railCollapsed}
            onKeyDown={(event) => handleKeyDown(event, index)}
          />
        ))}
      </ul>
    </nav>
  );
}

function CockpitNavRailItem({
  surface,
  isActive,
  collapsed,
  onKeyDown,
}: {
  surface: CockpitSurfaceConfig;
  isActive: boolean;
  collapsed: boolean;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  const deferred = !surface.firstSlice;

  if (deferred) {
    return (
      <li className="cockpit-nav-rail-item cockpit-nav-rail-item-deferred">
        <span
          className="cockpit-nav-rail-link cockpit-nav-rail-link-disabled"
          data-rail-item
          data-testid={`rail-item-${surface.id}`}
          aria-disabled="true"
          title="Coming soon"
          tabIndex={0}
          onKeyDown={onKeyDown}
        >
          <span className="cockpit-nav-rail-icon" aria-hidden="true">
            {surface.icon}
          </span>
          {!collapsed ? (
            <>
              <span className="cockpit-nav-rail-label">{surface.label}</span>
              <span className="cockpit-nav-rail-soon">Coming soon</span>
            </>
          ) : null}
        </span>
      </li>
    );
  }

  return (
    <li className={`cockpit-nav-rail-item${isActive ? " cockpit-nav-rail-item-active" : ""}`}>
      <Link
        href={surface.route}
        className="cockpit-nav-rail-link"
        data-rail-item
        data-testid={`rail-item-${surface.id}`}
        aria-current={isActive ? "page" : undefined}
        onKeyDown={onKeyDown}
      >
        <span className="cockpit-nav-rail-icon" aria-hidden="true">
          {surface.icon}
        </span>
        {!collapsed ? <span className="cockpit-nav-rail-label">{surface.label}</span> : null}
      </Link>
    </li>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { COMMAND_CENTER_SURFACES, getSurfaceByRoute, type CommandCenterSurfaceConfig } from "./surface-config";

const RAIL_COLLAPSE_KEY = "command-center-rail-collapsed";
const DESKTOP_RAIL_QUERY = "(min-width: 1280px)";

export function CommandCenterNavRail({ onOpenCommandPalette }: { onOpenCommandPalette?: () => void }) {
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

  const handleKeyDown = useCallback((event: React.KeyboardEvent, index: number) => {
    const items = COMMAND_CENTER_SURFACES;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = (index + 1) % items.length;
      listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-rail-item]")[next]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = (index - 1 + items.length) % items.length;
      listRef.current?.querySelectorAll<HTMLAnchorElement>("[data-rail-item]")[next]?.focus();
    }
  }, []);

  return (
    <nav
      className={`command-center-nav-rail${railCollapsed ? " command-center-nav-rail-collapsed" : ""}`}
      role="navigation"
      aria-label="Command Center surfaces"
      data-testid="command-center-nav-rail"
    >
      <button
        type="button"
        className="command-center-rail-collapse-toggle"
        data-testid="rail-collapse-toggle"
        onClick={toggleCollapsed}
      >
        {railCollapsed ? "Expand navigation" : "Collapse navigation"}
      </button>
      <button
        type="button"
        className="command-center-cmdk-trigger"
        data-testid="cmdk-trigger-rail"
        onClick={() => onOpenCommandPalette?.()}
        aria-keyshortcuts="Meta+K Control+K"
      >
        <span className="command-center-nav-rail-icon" aria-hidden="true">
          ⌘
        </span>
        {!railCollapsed ? <span className="command-center-nav-rail-label">Cmd-K</span> : null}
      </button>
      <ul ref={listRef} className="command-center-nav-rail-list">
        {COMMAND_CENTER_SURFACES.map((surface, index) => (
          <CommandCenterNavRailItem
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

function CommandCenterNavRailItem({
  surface,
  isActive,
  collapsed,
  onKeyDown,
}: {
  surface: CommandCenterSurfaceConfig;
  isActive: boolean;
  collapsed: boolean;
  onKeyDown: (event: React.KeyboardEvent) => void;
}) {
  return (
    <li className={`command-center-nav-rail-item${isActive ? " command-center-nav-rail-item-active" : ""}`}>
      <Link
        href={surface.route}
        className="command-center-nav-rail-link"
        data-rail-item
        data-testid={`rail-item-${surface.id}`}
        aria-current={isActive ? "page" : undefined}
        title={surface.operatorJob}
        onKeyDown={onKeyDown}
      >
        <span className="command-center-nav-rail-icon" aria-hidden="true">
          {surface.iconLabel}
        </span>
        {!collapsed ? <span className="command-center-nav-rail-label">{surface.label}</span> : null}
      </Link>
    </li>
  );
}

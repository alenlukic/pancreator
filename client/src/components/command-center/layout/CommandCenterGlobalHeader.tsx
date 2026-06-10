"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FIRST_SLICE_SURFACES } from "./surface-config";

export function CommandCenterGlobalHeader({
  onOpenCommandPalette,
}: {
  onOpenCommandPalette?: () => void;
}) {
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
      <div className="command-center-global-header-actions">
        <button
          type="button"
          className="command-center-global-header-cmdk"
          data-testid="cmdk-trigger-header"
          onClick={() => onOpenCommandPalette?.()}
          aria-keyshortcuts="Meta+K Control+K"
        >
          Cmd-K
        </button>
        <Link href="/mission-control" className="command-center-global-header-cta">
          Open Feature Delivery
        </Link>
      </div>
    </header>
  );
}

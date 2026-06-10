"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CommandCenterShell } from "./CommandCenterShell";
import { COCKPIT_SURFACES } from "./surface-config";

const SURFACE_ROUTES = new Set(COCKPIT_SURFACES.map((surface) => surface.route));

function isSurfaceRoute(pathname: string): boolean {
  return pathname === "/" || SURFACE_ROUTES.has(pathname);
}

export function SurfaceShellGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (!isSurfaceRoute(pathname)) {
    return children;
  }

  return <CommandCenterShell>{children}</CommandCenterShell>;
}

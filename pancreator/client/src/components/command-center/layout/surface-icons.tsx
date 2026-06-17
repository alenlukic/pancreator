import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  House,
  Rocket,
  ShieldCheck,
} from "lucide-react";
import type { CommandCenterSurfaceId } from "./surface-config";

const SURFACE_ICONS: Record<CommandCenterSurfaceId, LucideIcon> = {
  "command-center": House,
  "mission-control": Rocket,
  compliance: ShieldCheck,
  automations: Bot,
  "activity-log": Activity,
};

export function getSurfaceIcon(surfaceId: CommandCenterSurfaceId): LucideIcon {
  return SURFACE_ICONS[surfaceId];
}

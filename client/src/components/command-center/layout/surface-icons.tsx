import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Bot,
  Home,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import type { CommandCenterSurfaceId } from "./surface-config";

const SURFACE_ICONS: Record<CommandCenterSurfaceId, LucideIcon> = {
  "command-center": Home,
  "mission-control": Workflow,
  compliance: ShieldCheck,
  automations: Bot,
  "activity-log": Activity,
};

export function getSurfaceIcon(surfaceId: CommandCenterSurfaceId): LucideIcon {
  return SURFACE_ICONS[surfaceId];
}

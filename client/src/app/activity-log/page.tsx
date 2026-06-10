import { CommandCenterSurfacePlaceholder } from "@/components/command-center/layout/CommandCenterSurfacePlaceholder";
import { COMMAND_CENTER_SURFACES } from "@/components/command-center/layout/surface-config";

const surface = COMMAND_CENTER_SURFACES.find((entry) => entry.id === "activity-log")!;

export default function ActivityLogPage() {
  return <CommandCenterSurfacePlaceholder surface={surface} />;
}

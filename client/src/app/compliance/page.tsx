import { CommandCenterSurfacePlaceholder } from "@/components/command-center/layout/CommandCenterSurfacePlaceholder";
import { COMMAND_CENTER_SURFACES } from "@/components/command-center/layout/surface-config";

const surface = COMMAND_CENTER_SURFACES.find((entry) => entry.id === "compliance")!;

export default function CompliancePage() {
  return <CommandCenterSurfacePlaceholder surface={surface} />;
}

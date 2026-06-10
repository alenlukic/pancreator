import { CockpitSurfacePlaceholder } from "@/components/cockpit/layout/CockpitSurfacePlaceholder";
import { COCKPIT_SURFACES } from "@/components/cockpit/layout/surface-config";

const surface = COCKPIT_SURFACES.find((entry) => entry.id === "activity-log")!;

export default function ActivityLogPage() {
  return <CockpitSurfacePlaceholder surface={surface} />;
}

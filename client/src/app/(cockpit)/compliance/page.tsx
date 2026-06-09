import { CockpitSurfacePlaceholder } from "@/components/cockpit/layout/CockpitSurfacePlaceholder";
import { COCKPIT_SURFACES } from "@/components/cockpit/layout/surface-config";

const surface = COCKPIT_SURFACES.find((entry) => entry.id === "compliance")!;

export default function CompliancePage() {
  return <CockpitSurfacePlaceholder surface={surface} />;
}

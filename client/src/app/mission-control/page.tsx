import { Suspense } from "react";
import { MissionControlModule } from "@/components/cockpit/mission-control/MissionControlModule";

export default function MissionControlPage() {
  return (
    <Suspense fallback={<div data-testid="mission-control-page-loading">Loading…</div>}>
      <MissionControlModule />
    </Suspense>
  );
}

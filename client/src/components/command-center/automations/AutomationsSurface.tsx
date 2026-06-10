"use client";

import { AutomationsModule } from "./AutomationsModule";

export function AutomationsSurface() {
  return (
    <div className="automations-surface" data-testid="automations-surface">
      <AutomationsModule />
    </div>
  );
}

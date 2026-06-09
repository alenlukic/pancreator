import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AutomationWizardReview } from "./Review";

describe("AutomationWizardReview", () => {
  it("shows preview next run from draft cron schedule", () => {
    render(
      <AutomationWizardReview
        name="Hourly review"
        automationId="hourly-review"
        enabled
        schedule="0 * * * *"
        persona="coder"
        prompt="Review open tasks."
        maxConcurrent={1}
        timeoutMinutes={60}
        saving={false}
      />,
    );

    const preview = screen.getByTestId("automation-wizard-preview-next-run");
    expect(preview.textContent).toMatch(/^in \d+m$|^in \d+h$|^at /u);
  });
});

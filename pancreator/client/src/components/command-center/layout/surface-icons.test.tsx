import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { COMMAND_CENTER_SURFACES } from "./surface-config";
import { getSurfaceIcon } from "./surface-icons";

describe("getSurfaceIcon", () => {
  it("returns a Lucide icon component for every shipped surface", () => {
    for (const surface of COMMAND_CENTER_SURFACES) {
      const Icon = getSurfaceIcon(surface.id);
      const { container } = render(<Icon aria-hidden="true" size={24} />);
      expect(container.querySelector("svg")).toBeTruthy();
    }
  });
});

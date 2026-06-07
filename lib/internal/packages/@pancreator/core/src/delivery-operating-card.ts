import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  readProjectRootFromYaml,
  resolvePancreatorYamlPath,
} from "./project-root.js";

const DELIVERY_APPENDIX_HEADING = /^## Delivery operating card/m;

/**
 * Project-relative path to the delivery operating card for a harness root.
 * - Embedded (`project_root: ".pancreator"`): `.pancreator/AGENTS.md`
 * - Self-host with README appendix (daedaline): `README.md`
 * - Greenfield (`project_root: "."` without appendix): `AGENTS.md`
 */
export function resolveDeliveryOperatingCardRel(harnessRoot: string): string {
  const harness = path.resolve(harnessRoot);
  const cfgPath = resolvePancreatorYamlPath(harness);
  const projectRootRel = cfgPath
    ? readProjectRootFromYaml(readFileSync(cfgPath, "utf8"))
    : ".";

  if (projectRootRel === ".pancreator") {
    return ".pancreator/AGENTS.md";
  }

  const readmePath = path.join(harness, "README.md");
  if (existsSync(readmePath)) {
    const readme = readFileSync(readmePath, "utf8");
    if (DELIVERY_APPENDIX_HEADING.test(readme)) {
      return "README.md";
    }
  }

  return "AGENTS.md";
}

/** Absolute path to the delivery operating card. */
export function resolveDeliveryOperatingCard(harnessRoot: string): string {
  const rel = resolveDeliveryOperatingCardRel(harnessRoot);
  return path.join(path.resolve(harnessRoot), ...rel.split("/"));
}

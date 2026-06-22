import { readdirSync } from "node:fs";
import path from "node:path";
import { invariant } from "./errors.mjs";
import { readJson } from "./io.mjs";

function matches(pattern, value) {
  return pattern === "*" || pattern === value;
}

/** Load every policy JSON under governance/policies, keyed by unique id. */
export function loadPolicyCatalog(root) {
  const dir = path.join(root, "governance", "policies");
  const catalog = new Map();
  for (const name of readdirSync(dir).filter((entry) => entry.endsWith(".json")).sort()) {
    const policy = readJson(path.join(dir, name));
    invariant(typeof policy.id === "string" && policy.id.length > 0,
      `Policy ${name} is missing id.`, { code: "INVALID_POLICY" });
    invariant(!catalog.has(policy.id), `Duplicate policy id: ${policy.id}`, {
      code: "DUPLICATE_POLICY",
    });
    catalog.set(policy.id, policy);
  }
  return catalog;
}

/**
 * Resolve the policies that apply to a (persona, workflow, stage) tuple by
 * unioning every matching lookup row, then return the policy objects sorted by
 * id. Throws if a lookup references a missing policy.
 */
export function resolvePolicies(root, { persona, workflow, stage }) {
  const lookup = readJson(path.join(root, "governance", "policy_lookup_table.json"));
  invariant(Array.isArray(lookup.rows), "Policy lookup table must contain rows[].", {
    code: "INVALID_POLICY_LOOKUP",
  });
  const catalog = loadPolicyCatalog(root);
  const policyIds = new Set();
  for (const row of lookup.rows) {
    if (matches(row.persona, persona) && matches(row.workflow, workflow) && matches(row.stage, stage)) {
      for (const policyId of row.policies ?? []) policyIds.add(policyId);
    }
  }
  return [...policyIds].sort().map((policyId) => {
    invariant(catalog.has(policyId), `Policy lookup references missing policy: ${policyId}`, {
      code: "MISSING_POLICY",
    });
    return catalog.get(policyId);
  });
}

# METADATA
# title: Phase 2 scaffold contract for internal/packages/@tesseract/policy
# description: When the Phase 2 scaffold for `internal/packages/@tesseract/policy` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.policy.package_shape
#   tesseract.applies_to: file-path:internal/packages/@tesseract/policy/**
package tesseract.phase2.policy

import rego.v1

required_paths := {
  "internal/packages/@tesseract/policy/package.json",
  "internal/packages/@tesseract/policy/README.md",
  "internal/packages/@tesseract/policy/src/index.ts",
}

description := "When the Phase 2 scaffold for `internal/packages/@tesseract/policy` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

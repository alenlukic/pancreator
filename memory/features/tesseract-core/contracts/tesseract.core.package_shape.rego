# METADATA
# title: Phase 2 scaffold contract for internal/packages/@tesseract/core
# description: When the Phase 2 scaffold for `internal/packages/@tesseract/core` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.core.package_shape
#   tesseract.applies_to: file-path:internal/packages/@tesseract/core/**
package tesseract.phase2.core

import rego.v1

required_paths := {
  "internal/packages/@tesseract/core/package.json",
  "internal/packages/@tesseract/core/README.md",
  "internal/packages/@tesseract/core/src/index.ts",
}

description := "When the Phase 2 scaffold for `internal/packages/@tesseract/core` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

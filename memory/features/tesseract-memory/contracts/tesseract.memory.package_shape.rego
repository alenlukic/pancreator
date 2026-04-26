# METADATA
# title: Phase 2 scaffold contract for packages/@tesseract/memory
# description: When the Phase 2 scaffold for `packages/@tesseract/memory` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.memory.package_shape
#   tesseract.applies_to: file-path:packages/@tesseract/memory/**
package tesseract.phase2.memory

import rego.v1

required_paths := {
  "packages/@tesseract/memory/package.json",
  "packages/@tesseract/memory/README.md",
  "packages/@tesseract/memory/src/index.ts",
}

description := "When the Phase 2 scaffold for `packages/@tesseract/memory` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

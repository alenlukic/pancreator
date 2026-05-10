# METADATA
# title: Phase 2 scaffold contract for src/internal/packages/@tesseract/contract
# description: When the Phase 2 scaffold for `src/internal/packages/@tesseract/contract` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "docs/BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "docs/PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.contract.package_shape
#   tesseract.applies_to: file-path:src/internal/packages/@tesseract/contract/**
package tesseract.phase2.contract

import rego.v1

required_paths := {
  "src/internal/packages/@tesseract/contract/package.json",
  "src/internal/packages/@tesseract/contract/README.md",
  "src/internal/packages/@tesseract/contract/src/index.ts",
}

description := "When the Phase 2 scaffold for `src/internal/packages/@tesseract/contract` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

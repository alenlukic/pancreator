# METADATA
# title: Phase 2 scaffold contract for internal/packages/@tesseract/contract-style
# description: When the Phase 2 scaffold for `internal/packages/@tesseract/contract-style` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.contract_style.package_shape
#   tesseract.applies_to: file-path:internal/packages/@tesseract/contract-style/**
package tesseract.phase2.contract_style

import rego.v1

required_paths := {
  "internal/packages/@tesseract/contract-style/package.json",
  "internal/packages/@tesseract/contract-style/README.md",
  "internal/packages/@tesseract/contract-style/src/index.ts",
}

description := "When the Phase 2 scaffold for `internal/packages/@tesseract/contract-style` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

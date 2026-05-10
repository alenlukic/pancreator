# METADATA
# title: Phase 2 scaffold contract for internal/packages/@tesseract/runner-cursor
# description: When the Phase 2 scaffold for `internal/packages/@tesseract/runner-cursor` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.runner_cursor.package_shape
#   tesseract.applies_to: file-path:internal/packages/@tesseract/runner-cursor/**
package tesseract.phase2.runner_cursor

import rego.v1

required_paths := {
  "internal/packages/@tesseract/runner-cursor/package.json",
  "internal/packages/@tesseract/runner-cursor/README.md",
  "internal/packages/@tesseract/runner-cursor/src/index.ts",
}

description := "When the Phase 2 scaffold for `internal/packages/@tesseract/runner-cursor` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

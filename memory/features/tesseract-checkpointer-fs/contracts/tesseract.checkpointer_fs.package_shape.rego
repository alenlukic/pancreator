# METADATA
# title: Phase 2 scaffold contract for internal/packages/@tesseract/checkpointer-fs
# description: When the Phase 2 scaffold for `internal/packages/@tesseract/checkpointer-fs` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.checkpointer_fs.package_shape
#   tesseract.applies_to: file-path:internal/packages/@tesseract/checkpointer-fs/**
package tesseract.phase2.checkpointer_fs

import rego.v1

required_paths := {
  "internal/packages/@tesseract/checkpointer-fs/package.json",
  "internal/packages/@tesseract/checkpointer-fs/README.md",
  "internal/packages/@tesseract/checkpointer-fs/src/index.ts",
}

description := "When the Phase 2 scaffold for `internal/packages/@tesseract/checkpointer-fs` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

# METADATA
# title: Phase 2 scaffold contract for packages/@tesseract/inbox
# description: When the Phase 2 scaffold for `packages/@tesseract/inbox` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.inbox.package_shape
#   tesseract.applies_to: file-path:packages/@tesseract/inbox/**
package tesseract.phase2.inbox

import rego.v1

required_paths := {
  "packages/@tesseract/inbox/package.json",
  "packages/@tesseract/inbox/README.md",
  "packages/@tesseract/inbox/src/index.ts",
}

description := "When the Phase 2 scaffold for `packages/@tesseract/inbox` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

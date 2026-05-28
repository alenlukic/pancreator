# METADATA
# title: Phase 2 scaffold contract for src/internal/packages/@daedaline/run-logger
# description: When the Phase 2 scaffold for `src/internal/packages/@daedaline/run-logger` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "docs/BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "docs/PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   daedaline.contract_id: daedaline.run_logger.package_shape
#   daedaline.applies_to: file-path:src/internal/packages/@daedaline/run-logger/**
package daedaline.phase2.run_logger

import rego.v1

required_paths := {
  "src/internal/packages/@daedaline/run-logger/package.json",
  "src/internal/packages/@daedaline/run-logger/README.md",
  "src/internal/packages/@daedaline/run-logger/src/index.ts",
}

description := "When the Phase 2 scaffold for `src/internal/packages/@daedaline/run-logger` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

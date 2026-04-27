# METADATA
# title: Phase 2 scaffold contract for packages/@tesseract/contract-runner-llm-judge
# description: When the Phase 2 scaffold for `packages/@tesseract/contract-runner-llm-judge` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory.
# severity: block
# references:
#   - "BOOTSTRAP.md:[122,159]#TBD-on-commit"
#   - "PRD.md:[1116,1126]#TBD-on-commit"
# custom:
#   tesseract.contract_id: tesseract.contract_runner_llm_judge.package_shape
#   tesseract.applies_to: file-path:packages/@tesseract/contract-runner-llm-judge/**
package tesseract.phase2.contract_runner_llm_judge

import rego.v1

required_paths := {
  "packages/@tesseract/contract-runner-llm-judge/package.json",
  "packages/@tesseract/contract-runner-llm-judge/README.md",
  "packages/@tesseract/contract-runner-llm-judge/src/index.ts",
}

description := "When the Phase 2 scaffold for `packages/@tesseract/contract-runner-llm-judge` is evaluated, the contract-runner SHALL report a block-level failure unless `package.json`, `README.md`, and `src/index.ts` exist in that package directory."

deny contains msg if {
  some req in required_paths
  not req in object.keys(input.files)
  msg := description
}

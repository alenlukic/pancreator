# METADATA
# title: Normalize dual-anchor contentHash corpus for governance surfaces
# description: When a governance document or contract artifact carries a `references[]` anchor, the contract-runner SHALL report a block-level failure unless every `contentHash` value is a concrete lowercase SHA-256 digest and no `contentHash` equals `TBD-on-commit`.
# severity: block
# references:
#   - "AGENTS.md:[89,104]#3dd1213204e134b7c6e6091e1a421403cd37be95823196c4ab1353be5cda3e14"
#   - "src/memory/handbook/constitution.md:[108,116]#00874481f8aaaa6618a4b6ab4d3d115ebfffd5dcf61d3d2ef38bb2076ed17432"
#   - "src/memory/handbook/policy-compliance-contract.md:[49,55]#6a7a1e5d27a3c1c0dec59b19c5267e817ea03dcef969b2eba3d6c11cc42a228a"
# custom:
#   pancreator.contract_id: pancreator.governance.normalize-dual-anchor-contenthash-corpus
#   pancreator.applies_to: file-path:{AGENTS.md,src/memory/handbook/**/*.md,src/personas/**/*.md,.cursor/agents/**/*.md,src/memory/features/**/contracts/**/*.{yaml,yml,md}}
package pancreator.governance.dual_anchor_contenthash

import rego.v1

description := "When a governance document or contract artifact carries a `references[]` anchor, the contract-runner SHALL report a block-level failure unless every `contentHash` value is a concrete lowercase SHA-256 digest and no `contentHash` equals `TBD-on-commit`."

is_contract_path(path) if {
  startswith(path, "src/memory/features/")
  contains(path, "/contracts/")
}

is_governance_path(path) if startswith(path, "AGENTS.md")
is_governance_path(path) if startswith(path, "src/memory/handbook/")
is_governance_path(path) if startswith(path, "src/personas/")
is_governance_path(path) if startswith(path, ".cursor/agents/")
is_governance_path(path) if is_contract_path(path)

is_valid_content_hash(value) if {
  is_string(value)
  re_match("^[a-f0-9]{64}$", value)
}

deny contains msg if {
  some entry in input.references_index
  is_governance_path(entry.path)
  some ref in entry.references
  not is_valid_content_hash(ref.contentHash)
  msg := description
}

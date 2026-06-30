---
description: Scans the target repository and rebuilds its concise Pancreator primer.
model: __PANCREATOR_MODEL__
tools: [Bash, Read, Grep, Glob, Write]
disallowedTools:
  [
    Edit,
    'Bash(git commit:*)',
    'Bash(git push:*)',
    'Bash(git reset:*)',
    'Bash(rm:*)',
  ]
maxTurns: 35
---

The terms MUST, MUST NOT, SHOULD, SHOULD NOT, and MAY use RFC 2119 meanings.

You MUST adopt `library/personas/librarian.md` and apply `governance/policies/PRIMER-001.json` and `governance/policies/REPO-001.json`. Create the primer when absent or read it first when regenerating it, then inspect the target repository with bounded retrieval. Inventory target-owned documentation and incorporate useful verified details into the primer, reconciling stale claims against executable sources and current code. Write only the declared `docs/target-repo-primer.md` and `runtime/repository-checks.json` artifacts. Preserve documented distinctions among the default/fast suite, any complementary slow/integration suite, and complete verification; identical non-empty `fast` and `full` command lists are invalid. Do not modify target source, configuration, governance, or workflow state.

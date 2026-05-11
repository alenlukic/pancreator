#!/usr/bin/env bash
set -euo pipefail

input_payload="$(python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)))')"

shell_command="$(python3 - "$input_payload" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
command = (
    payload.get("command")
    or payload.get("tool_input", {}).get("command")
    or payload.get("toolInput", {}).get("command")
    or ""
)
print(command)
PY
)"

if [[ ! "$shell_command" =~ ^git[[:space:]]+commit([[:space:]]|$) ]]; then
  echo '{"permission":"allow"}'
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

staged_files=()
while IFS= read -r line; do
  [[ -n "$line" ]] && staged_files+=("$line")
done < <(git diff --cached --name-only)
if [[ ${#staged_files[@]} -eq 0 ]]; then
  echo '{"permission":"allow"}'
  exit 0
fi

is_docs_metadata_path() {
  local path="$1"
  case "$path" in
    AGENTS.md|docs/PRD.md|docs/BOOTSTRAP.md|CLAUDE.md|.github/copilot-instructions.md)
      return 0
      ;;
    src/memory/*|src/inbox/*|docs/*)
      case "$path" in
        *.md|*.mdc|*.txt|*.yaml|*.yml|*.json)
          return 0
          ;;
      esac
      ;;
  esac
  return 1
}

requires_artifact=0
for path in "${staged_files[@]}"; do
  if [[ "$path" == src/work/* ]]; then
    continue
  fi
  if is_docs_metadata_path "$path"; then
    continue
  fi
  requires_artifact=1
  break
done

if [[ "$requires_artifact" -eq 0 ]]; then
  echo '{"permission":"allow"}'
  exit 0
fi

artifacts=()
for path in "${staged_files[@]}"; do
  # Accept only the timestamp-naming three-level shape
  # `src/work/<day>/<task>/policy-compliance.json`.
  if [[ "$path" =~ ^src/work/[^/]+/[^/]+/policy-compliance\.json$ ]]; then
    artifacts+=("$path")
  fi
done

if [[ ${#artifacts[@]} -eq 0 ]]; then
  cat <<'JSON'
{"permission":"deny","user_message":"Commit blocked: stage at least one src/work/<day>/<task-id>/policy-compliance.json artifact for non-work structural changes.","agent_message":"Policy-compliance gate failed because no staged policy-compliance artifact was found."}
JSON
  exit 0
fi

staged_list_payload="$(printf '%s\n' "${staged_files[@]}" | python3 -c 'import json,sys; print(json.dumps([line.strip() for line in sys.stdin if line.strip()]))')"

validation_result="$(python3 - "$staged_list_payload" "${artifacts[@]}" <<'PY'
import json
import subprocess
import sys

staged_files = set(json.loads(sys.argv[1]))
artifact_paths = sys.argv[2:]
required_sources = {
    "AGENTS.md",
    "src/memory/handbook/constitution.md",
    "docs/PRD.md",
}

doc_prefixes = ("src/memory/", "docs/", "src/inbox/")
doc_root_names = {
    "AGENTS.md",
    "docs/PRD.md",
    "docs/BOOTSTRAP.md",
    "CLAUDE.md",
    ".github/copilot-instructions.md",
}


def staged_blob(path: str) -> str:
    proc = subprocess.run(
        ["git", "show", f":{path}"],
        check=False,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise ValueError(f"staged artifact not readable: {path}")
    return proc.stdout


def normalize_path(value: str) -> str:
    return value.lstrip("./")


def is_doc_surface(path: str) -> bool:
    normalized = normalize_path(path)
    if normalized in doc_root_names:
        return True
    return normalized.startswith(doc_prefixes)


def deferred_has_ids(items) -> bool:
    if not isinstance(items, list) or len(items) == 0:
        return False
    for item in items:
        if isinstance(item, str) and item.strip():
            return True
        if isinstance(item, dict):
            candidate = item.get("id")
            if isinstance(candidate, str) and candidate.strip():
                return True
    return False


def non_empty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def validate_policy_alignment(obj):
    if not isinstance(obj, dict):
        return "policy_alignment must be an object."
    required_text_fields = (
        "agents_md_alignment",
        "constitution_alignment",
        "prd_alignment",
    )
    for field in required_text_fields:
        if not non_empty_string(obj.get(field)):
            return f"policy_alignment.{field} must be a non-empty string."
    required_updates = obj.get("required_updates")
    if not isinstance(required_updates, list):
        return "policy_alignment.required_updates must be an array."
    if not all(isinstance(item, str) for item in required_updates):
        return "policy_alignment.required_updates entries must be strings."
    return None


for artifact_path in artifact_paths:
    try:
        payload = json.loads(staged_blob(artifact_path))
    except json.JSONDecodeError as exc:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"{artifact_path} is not valid JSON: {exc.msg}.",
                }
            )
        )
        sys.exit(0)
    except ValueError as exc:
        print(json.dumps({"ok": False, "reason": str(exc)}))
        sys.exit(0)

    if not non_empty_string(payload.get("task_id")):
        print(
            json.dumps(
                {"ok": False, "reason": f"{artifact_path}: task_id must be non-empty."}
            )
        )
        sys.exit(0)

    checked = payload.get("governing_sources_checked")
    if not isinstance(checked, list):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"{artifact_path}: governing_sources_checked must be an array.",
                }
            )
        )
        sys.exit(0)
    checked_set = {item for item in checked if isinstance(item, str)}
    missing_sources = sorted(required_sources - checked_set)
    if missing_sources:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": (
                        f"{artifact_path}: governing_sources_checked is missing required paths: "
                        + ", ".join(missing_sources)
                    ),
                }
            )
        )
        sys.exit(0)

    doc_impact = payload.get("documentation_impact")
    if not isinstance(doc_impact, dict):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"{artifact_path}: documentation_impact must be an object.",
                }
            )
        )
        sys.exit(0)

    applies = doc_impact.get("applies")
    if not isinstance(applies, bool):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"{artifact_path}: documentation_impact.applies must be boolean.",
                }
            )
        )
        sys.exit(0)
    if not non_empty_string(doc_impact.get("rationale")):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": f"{artifact_path}: documentation_impact.rationale must be non-empty.",
                }
            )
        )
        sys.exit(0)

    changed_surfaces = doc_impact.get("changed_surfaces")
    if not isinstance(changed_surfaces, list):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": (
                        f"{artifact_path}: documentation_impact.changed_surfaces must be an array."
                    ),
                }
            )
        )
        sys.exit(0)
    if not all(isinstance(item, str) for item in changed_surfaces):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": (
                        f"{artifact_path}: documentation_impact.changed_surfaces entries must be strings."
                    ),
                }
            )
        )
        sys.exit(0)

    deferred_items = doc_impact.get("deferred_items")
    if not isinstance(deferred_items, list):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": (
                        f"{artifact_path}: documentation_impact.deferred_items must be an array."
                    ),
                }
            )
        )
        sys.exit(0)

    policy_alignment_error = validate_policy_alignment(payload.get("policy_alignment"))
    if policy_alignment_error:
        print(json.dumps({"ok": False, "reason": f"{artifact_path}: {policy_alignment_error}"}))
        sys.exit(0)

    if applies:
        staged_changed_doc_surface = any(
            normalize_path(surface) in staged_files and is_doc_surface(surface)
            for surface in changed_surfaces
        )
        deferred_with_id = deferred_has_ids(deferred_items)
        if not staged_changed_doc_surface and not deferred_with_id:
            print(
                json.dumps(
                    {
                        "ok": False,
                        "reason": (
                            f"{artifact_path}: documentation_impact.applies=true requires either "
                            "a staged documentation/reference path listed in changed_surfaces or "
                            "at least one deferred_items entry with an id."
                        ),
                    }
                )
            )
            sys.exit(0)

print(json.dumps({"ok": True}))
PY
)"

validation_ok="$(python3 - "$validation_result" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
print("true" if payload.get("ok") else "false")
PY
)"

if [[ "$validation_ok" != "true" ]]; then
  failure_reason="$(python3 - "$validation_result" <<'PY'
import json
import sys

payload = json.loads(sys.argv[1])
print(payload.get("reason", "policy-compliance validation failed"))
PY
)"
  python3 - "$failure_reason" <<'PY'
import json
import sys

reason = sys.argv[1]
print(
    json.dumps(
        {
            "permission": "deny",
            "user_message": f"Commit blocked: {reason}",
            "agent_message": (
                "Policy-compliance gate denied git commit. "
                f"Validation reason: {reason}"
            ),
        }
    )
)
PY
  exit 0
fi

echo '{"permission":"allow"}'

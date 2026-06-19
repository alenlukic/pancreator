#!/usr/bin/env bash
set -euo pipefail

payload="$(cat)"
if [[ -z "${payload//[[:space:]]/}" ]]; then
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

command="$(
  printf '%s' "$payload" | node <<'NODE' 2>/dev/null || true
const fs = require("node:fs");
const raw = fs.readFileSync(0, "utf8");
let command = "";

try {
  const parsed = JSON.parse(raw);
  if (parsed && typeof parsed.command === "string") {
    command = parsed.command;
  } else if (
    parsed &&
    typeof parsed.input === "object" &&
    parsed.input !== null &&
    typeof parsed.input.command === "string"
  ) {
    command = parsed.input.command;
  }
} catch {}

process.stdout.write(command);
NODE
)"

if [[ -z "${command//[[:space:]]/}" ]]; then
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

if [[ "$command" =~ ^[[:space:]]*rtk([[:space:]]|$) ]]; then
  printf '%s\n' '{"permission":"allow"}'
  exit 0
fi

if [[ "$command" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]+[[:space:]]+)*(git[[:space:]]+(status|diff|log)([[:space:]]|$)|rg([[:space:]]|$)|grep([[:space:]]|$)|find([[:space:]]|$)|ls([[:space:]]|$)|cat([[:space:]]|$)|head([[:space:]]|$)|tail([[:space:]]|$)|pytest([[:space:]]|$)|tsc([[:space:]]|$)|pnpm[[:space:]]+test([[:space:]]|$)|npm[[:space:]]+test([[:space:]]|$)|yarn[[:space:]]+test([[:space:]]|$)) ]]; then
  printf '%s\n' '{"permission":"ask","user_message":"Use RTK wrapper for shell inspection when possible (for example `rtk read`, `rtk grep`, `rtk git status`).","agent_message":"Pancreator RTK policy prefers compressed RTK shell output. If raw command output is required, ask for approval with narrow scope."}'
  exit 0
fi

printf '%s\n' '{"permission":"allow"}'

const OUTCOME_EMOJI = { success: "✅", blocked: "⏸️", failure: "❌" };

function fencedJson(value) {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

/**
 * Render an invocation card as an operator- and worker-readable Markdown
 * document. The card leads with the operator view, then the task contract, and
 * keeps machine identifiers in a technical appendix.
 */
export function renderInvocationMarkdown(invocation) {
  const { stage } = invocation;
  const requiredData = Object.entries(invocation.output.required_data ?? {});
  const lines = [
    `# 🚀 ${invocation.$operator.headline}`,
    "",
    `**Run** \`${invocation.run_id}\` · **Stage** ${stage.title} (\`${stage.slug}\`) · **Owner** \`${stage.persona}\` · **Attempt** ${invocation.attempt}`,
    "",
    "## Operator view",
    "",
    invocation.$operator.summary,
    "",
    `**Next action:** ${invocation.$operator.next_action}`,
    "",
    "## 📋 Task",
    "",
    invocation.prompt,
    "",
    "## 📥 Inputs",
    "",
    ...(invocation.inputs.references.length
      ? invocation.inputs.references.map((item) => `- \`${item.path}\` — ${item.description}`)
      : ["- No prior artifacts; start from the request."]),
    "",
    "## 📜 Policies in force",
    "",
    ...(invocation.policies.length
      ? invocation.policies.map((policy) => `- **${policy.id} · ${policy.title}** — ${policy.summary}`)
      : ["- Only global boundaries apply."]),
    "",
    "## 🎯 Rubric",
    "",
    ...invocation.rubric.map(
      (criterion) =>
        `- ${criterion.hard ? "🔴 hard" : "⚪ soft"} **${criterion.id}** (${criterion.type}) — ${criterion.statement}`,
    ),
    "",
    "## 📤 Output contract",
    "",
    `Write JSON to \`${invocation.output.path}\` using \`${invocation.output.template}\` as the base shape (schema \`${invocation.output.schema}\`).`,
    "",
    ...(requiredData.length
      ? ["Required `data` fields:", ...requiredData.map(([key, type]) => `- \`data.${key}\`: ${type}`)]
      : ["No stage-specific `data` fields are required."]),
    "",
    "## 🚧 Boundaries",
    "",
    ...invocation.boundaries.map((item) => `- ${item}`),
    "",
    "## Technical appendix",
    "",
    fencedJson({
      invocation_id: invocation.invocation_id,
      workflow: invocation.workflow,
      workspace_fingerprint: invocation.workspace_before?.fingerprint ?? null,
      model_hint: stage.model_hint,
      workspace_policy: stage.workspace_policy,
      gate: stage.gate,
    }),
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Render the operator-facing execution record for a submitted stage output.
 * Markdown-primary: outcome and summary lead, evidence and risks follow, and
 * machine metadata sits in a technical appendix.
 */
export function renderTaskRecord(record) {
  const emoji = OUTCOME_EMOJI[record.outcome] ?? "•";
  const checks = record.evaluation.deterministic.length
    ? record.evaluation.deterministic.map(
        (item) =>
          `- ${item.passed ? "✅" : "❌"} **${item.id}**` +
          `${item.evidence_path ? ` — \`${item.evidence_path}\`` : ""}` +
          `${item.explanation ? ` — ${item.explanation}` : ""}`,
      )
    : ["- No deterministic checks were declared for this stage."];
  const artifacts = record.artifacts.length
    ? record.artifacts.map((item) => `- \`${item.path}\` — ${item.description}`)
    : ["- No durable artifacts declared."];
  const risks = [
    ...record.risks.map((item) => `- ⚠️ Risk: ${item}`),
    ...record.unknowns.map((item) => `- ❓ Unknown: ${item}`),
  ];

  const sections = [
    `# ${emoji} ${record.stage.title}: ${record.outcome}`,
    "",
    record.summary,
    "",
    `**Next state:** ${record.next_state}`,
    "",
    "## 📦 Work completed",
    "",
    ...artifacts,
    "",
    "## 🔍 Checks",
    "",
    ...checks,
  ];

  if (record.evaluation.validation_errors.length) {
    sections.push(
      "",
      "## ❌ Output validation issues",
      "",
      ...record.evaluation.validation_errors.map((item) => `- ${item}`),
    );
  }

  sections.push(
    "",
    "## ⚠️ Risks and unknowns",
    "",
    ...(risks.length ? risks : ["- None declared."]),
    "",
    "## Technical appendix",
    "",
    fencedJson({
      run_id: record.run_id,
      invocation_id: record.invocation_id,
      persona: record.stage.persona,
      workspace_fingerprint: record.workspace_fingerprint,
      timestamp: record.timestamp,
    }),
  );
  return `${sections.join("\n")}\n`;
}

/** Render a one-screen status summary for `pan status`. */
export function renderStatus(state) {
  const lines = [
    `Run ${state.run_id}`,
    `Status: ${state.status}`,
    `Workflow: ${state.workflow_slug}`,
    `Current stage: ${state.current_stage ?? "none"}`,
    `Pending action: ${state.pending_action?.type ?? "none"}`,
    `Revision: ${state.revision}`,
    `Transitions: ${state.transition_count}/${state.limits.max_total_transitions}`,
  ];
  if (state.pending_action?.path) lines.push(`Card: ${state.pending_action.path}`);
  if (state.pause_reason) lines.push(`Pause reason: ${state.pause_reason}`);
  return `${lines.join("\n")}\n`;
}

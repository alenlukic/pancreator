import { fileExists } from '../io.js'
import { projectionTargetPath } from '../projection/manifest.js'

import {
  type CopilotCliPreflightResult,
  type CopilotCredentialReport,
  type CopilotProvider,
  copilotCliPreflight,
  copilotCredentialReport,
  copilotProviderOf,
  resolveCopilotCredential,
} from './copilot-cli.js'
import { parsePersonaMapping } from './mapping.js'

export interface CopilotPersonaDiagnostic {
  model: string
  provider: CopilotProvider
  agent: string
  agent_projected: boolean
}

/** `pan doctor` readiness for the copilot executor. Never carries a key. */
export interface CopilotDiagnostics {
  cli: CopilotCliPreflightResult
  personas: Record<string, CopilotPersonaDiagnostic>
  credentials: CopilotCredentialReport[]
  workspace_trust: string
  pan_unstick: string
  advisories: string[]
}

/**
 * Report the Copilot CLI binary and flags, the credential source of each
 * provider the active mapping names, and the model each copilot persona runs.
 */
export function copilotDiagnostics(
  root: string,
  personas: Record<string, string>,
): CopilotDiagnostics {
  const advisories: string[] = []
  const copilotPersonas: Record<string, CopilotPersonaDiagnostic> = {}

  for (const [persona, raw] of Object.entries(personas)) {
    const mapping = parsePersonaMapping(raw, persona)

    if (mapping.executor !== 'copilot') {
      continue
    }

    const agent = `.github/agents/pan-${persona}.agent.md`

    copilotPersonas[persona] = {
      model: mapping.model,
      provider: copilotProviderOf(mapping.options),
      agent,
      agent_projected: fileExists(projectionTargetPath(root, agent)),
    }
  }

  const providers = [
    ...new Set(Object.values(copilotPersonas).map((entry) => entry.provider)),
  ].sort()
  const credentials = providers.map((provider) => {
    const resolved = resolveCopilotCredential(root, provider)

    return copilotCredentialReport(
      resolved.ok ? resolved.credential : resolved.report,
    )
  })
  const unprojected = Object.entries(copilotPersonas)
    .filter(([, entry]) => !entry.agent_projected)
    .map(([persona]) => persona)

  if (unprojected.length > 0) {
    advisories.push(
      `No projected custom agent exists for ${unprojected.join(', ')}, so ` +
        'those workers run without their persona body. Add vscode to hosts ' +
        'in config.json and run pan models --sync.',
    )
  }

  if (providers.includes('github')) {
    advisories.push(
      'The github provider uses the stored Copilot CLI login, which doctor ' +
        'cannot verify without spending a request. Run copilot login once ' +
        'on this machine.',
    )
  }

  for (const credential of credentials) {
    if (credential.error) {
      advisories.push(credential.error)
    }
  }

  return {
    cli: copilotCliPreflight(),
    personas: copilotPersonas,
    credentials,
    workspace_trust:
      'Each worker launches with COPILOT_ALLOW_ALL=true, which trusts its ' +
      'working directory, so the CLI loads .github/hooks/pan-hooks.json there.',
    pan_unstick:
      'bin/pan-unstick releases only stalled Cursor shell launchers. A VS ' +
      'Code or Copilot CLI shell has no launcher it can release.',
    advisories,
  }
}

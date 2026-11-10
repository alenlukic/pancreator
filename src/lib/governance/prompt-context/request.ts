/** Presence-guarded reminder assembly for a controlled VS Code OpenAI provider. */

import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { PanError } from '../../errors.js'
import { appendJsonLine, isRecord, sha256 } from '../../io.js'
import {
  canonicalReminder,
  type CanonicalReminderOptions,
} from './canonical.js'

interface ReminderRequestOptions {
  mode?: 'guarded' | 'full'
}

interface ReminderRequestEvent {
  schema_version: 1
  assembled_at: string
  assembly_id: string
  scope_sha256: string
  identity: string
  previous_identity: string | null
  identity_changed: boolean
  delivery: 'full' | 'cue'
  reason:
    | 'session_start'
    | 'identity_changed'
    | 'missing_presence'
    | 'stale_presence'
    | 'verified_presence'
    | 'forced_full'
  instructions_sha256: string
  appended_bytes: number
}

interface ReminderRequestResult {
  request: Record<string, unknown> & { instructions: string }
  event: ReminderRequestEvent
  audit_path: string
}

/**
 * Assemble the final Responses request after all context reduction. Only exact
 * current bytes in the request's trusted `instructions` field permit a cue.
 * Create a new instance for each child or resumed session. History, response IDs,
 * cache keys, and this instance's previous deliveries never prove presence.
 *
 * The caller must send the returned request without further context edits. This
 * adapter does not install itself into VS Code or disable the existing hooks.
 */
export class ReminderRequestAssembler {
  private readonly assemblyId = randomUUID()
  private readonly options: CanonicalReminderOptions
  private previousIdentity: string | null = null

  constructor(
    private readonly root: string,
    options: CanonicalReminderOptions,
  ) {
    this.options = { ...options }
  }

  /**
   * Preserve provider fields and append a full reminder or a bounded cue.
   * Persist metadata before returning; contract, request, or audit failures throw
   * visibly before a caller can send an instruction-free request.
   */
  assemble(
    request: unknown,
    options: ReminderRequestOptions = {},
  ): ReminderRequestResult {
    if (
      !isRecord(request) ||
      (request.instructions != null &&
        typeof request.instructions !== 'string') ||
      (request.truncation !== undefined && request.truncation !== 'disabled') ||
      (options.mode !== undefined &&
        options.mode !== 'guarded' &&
        options.mode !== 'full')
    ) {
      throw new PanError(
        'Reminder assembly requires string instructions, disabled server truncation, and guarded or full mode.',
        {
          code: 'INVALID_REMINDER_REQUEST',
        },
      )
    }

    const reminder = canonicalReminder(this.root, this.options)
    const marker = `[Pancreator reminder ${this.assemblyId} ${reminder.identity}]`
    const full = `${marker}\n${reminder.content}\n\n${reminder.deferred_content}\n[/Pancreator reminder ${this.assemblyId}]`
    const cue = `Apply the full Pancreator reminder ${reminder.identity} above; its deferred clauses retain their triggers.`
    const instructions = request.instructions ?? ''

    const identityChanged =
      this.previousIdentity !== null &&
      this.previousIdentity !== reminder.identity
    let reason: ReminderRequestEvent['reason']

    if (options.mode === 'full') {
      reason = 'forced_full'
    } else if (this.previousIdentity === null) {
      reason = 'session_start'
    } else if (identityChanged) {
      reason = 'identity_changed'
    } else if (instructions.includes(full)) {
      reason = 'verified_presence'
    } else if (instructions.includes(marker)) {
      reason = 'stale_presence'
    } else {
      reason = 'missing_presence'
    }

    const delivery = reason === 'verified_presence' ? 'cue' : 'full'
    const addition = delivery === 'cue' ? cue : full
    const nextInstructions =
      delivery === 'cue' && instructions.endsWith(`\n\n${cue}`)
        ? instructions
        : instructions.length > 0
          ? `${instructions}\n\n${addition}`
          : addition
    const event: ReminderRequestEvent = {
      schema_version: 1,
      assembled_at: new Date().toISOString(),
      assembly_id: this.assemblyId,
      scope_sha256: sha256(reminder.scope),
      identity: reminder.identity,
      previous_identity: this.previousIdentity,
      identity_changed: identityChanged,
      delivery,
      reason,
      instructions_sha256: sha256(nextInstructions),
      appended_bytes:
        Buffer.byteLength(nextInstructions) - Buffer.byteLength(instructions),
    }
    const auditPath = path.join(
      this.root,
      'runtime/logs/reminders',
      `${this.assemblyId}.jsonl`,
    )

    // One synchronous writer owns each instance's unique log. Never read it as
    // evidence of presence, and never persist provider payloads or prompt text.
    appendJsonLine(auditPath, event)
    this.previousIdentity = reminder.identity

    return {
      request: { ...request, instructions: nextInstructions },
      event,
      audit_path: auditPath,
    }
  }
}

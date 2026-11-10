/** Exact, scoped reminder packets for inspection of the final OpenAI request. */

import { randomUUID } from 'node:crypto'

import { PanError } from '../../errors.js'
import { isRecord, sha256 } from '../../io.js'
import {
  canonicalReminder,
  type CanonicalReminder,
  type CanonicalReminderOptions,
} from './canonical.js'

interface Packet {
  id: string
  options: CanonicalReminderOptions
  identity: string
  body: string
}

interface TextSlot {
  lane: string
  text: string
  write: (text: string) => void
}

interface Occurrence {
  slot: TextSlot
  start: number
  end: number
  kind: string
  body: string
  packet: Packet
  current: CanonicalReminder
}

const FRAME =
  /<pancreator-reminder id="([a-f0-9-]{36})" kind="(full|cue)">\n([\s\S]*?)\n<\/pancreator-reminder>/gu
const CUE =
  'Apply the complete current Pancreator reminder retained in this request.'

function frame(
  packet: Packet,
  kind: 'full' | 'cue',
  body = packet.body,
): string {
  return `<pancreator-reminder id="${packet.id}" kind="${kind}">\n${kind === 'full' ? body : CUE}\n</pancreator-reminder>`
}

/** Recover the source hook bytes for validation; cues are never accepted here. */
export function unwrapRelayHookText(value: string): string {
  const match =
    /^<pancreator-reminder id="[a-f0-9-]{36}" kind="full">\n([\s\S]*?)\n<\/pancreator-reminder>/u.exec(
      value,
    )
  return match ? `${match[1] ?? ''}${value.slice(match[0].length)}` : value
}

function textSlots(request: Record<string, unknown>): TextSlot[] {
  const slots: TextSlot[] = []
  const add = (owner: Record<string, unknown>, key: string, lane: string) => {
    const text = owner[key]

    if (typeof text === 'string') {
      slots.push({
        lane,
        text,
        write: (value) => {
          owner[key] = value
        },
      })
    }
  }
  add(request, 'instructions', 'instructions')

  const messages = Array.isArray(request.input)
    ? request.input
    : Array.isArray(request.messages)
      ? request.messages
      : []

  for (const message of messages) {
    if (!isRecord(message)) {
      continue
    }

    if (message.type === 'function_call_output') {
      add(message, 'output', 'tool')
      continue
    }

    if (
      !['system', 'developer', 'user', 'tool'].includes(String(message.role))
    ) {
      continue
    }

    const lane = `message:${String(message.role)}`

    if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (
          isRecord(part) &&
          (part.type === 'input_text' || part.type === 'text')
        ) {
          add(part, 'text', lane)
        }
      }
    } else {
      add(message, 'content', lane)
    }
  }

  return slots
}

/**
 * Issue full packets at the hook, then reduce copies only in the final request.
 * Random packet capabilities and their bodies stay in this process. No receipt,
 * previous request, or server-side history is evidence that a body is present.
 */
export class ReminderRelayPackets {
  private readonly packets = new Map<string, Packet>()
  private readonly identities = new Map<string, string>()

  constructor(private readonly root: string) {}

  /** Wrap a complete native reminder, preserving any fired deferred clauses. */
  issue(options: CanonicalReminderOptions, body: string): string {
    const reminder = canonicalReminder(this.root, options)

    if (
      !body.startsWith(reminder.content) ||
      body.includes('<pancreator-reminder')
    ) {
      return body
    }

    const key = sha256({ identity: reminder.identity, body: reminder.content })
    const known = this.identities.get(key)
    const previous = known ? this.packets.get(known) : undefined

    // At capacity the native full delivery remains usable without a packet.
    if (!previous && this.packets.size >= 1024) {
      return body
    }

    const packet: Packet = previous ?? {
      id: randomUUID(),
      options: { ...options },
      identity: reminder.identity,
      body: reminder.content,
    }
    // Fired clauses and other live context are never part of the removable frame.
    const rendered = `${frame(packet, 'full')}${body.slice(reminder.content.length)}`

    if (Buffer.byteLength(rendered) > 10 * 1024) {
      return body
    }

    this.packets.set(packet.id, packet)
    this.identities.set(key, packet.id)
    return rendered
  }

  /** Preserve request roles and fields; retain one full body per scope and lane. */
  transform(value: unknown, mode: 'guarded' | 'full' = 'guarded') {
    if (!isRecord(value)) {
      throw new PanError('Expected a JSON request object.', {
        code: 'INVALID_REMINDER_REQUEST',
      })
    }

    const request = structuredClone(value)
    const slots = textSlots(request)
    const groups = new Map<string, Occurrence[]>()
    const currentReminders = new Map<string, CanonicalReminder>()

    for (const slot of slots) {
      const matches = [...slot.text.matchAll(FRAME)]
      const stripped = slot.text.replace(FRAME, '')

      for (const header of stripped.matchAll(
        /<pancreator-reminder id="([a-f0-9-]{36})" kind="(full|cue)">/gu,
      )) {
        if (this.packets.has(header[1] ?? '') || header[2] === 'cue') {
          throw new PanError(
            'A reminder packet was truncated; restore full hook context.',
            { code: 'REMINDER_RECOVERY_REQUIRED' },
          )
        }
      }

      for (const match of matches) {
        const id = match[1] ?? ''
        const packet = this.packets.get(id)

        if (!packet) {
          if (match[2] === 'cue') {
            throw new PanError(
              'A cue has no recoverable full reminder; restore full hook context.',
              { code: 'REMINDER_RECOVERY_REQUIRED' },
            )
          }
          continue
        }

        const current =
          currentReminders.get(id) ??
          canonicalReminder(this.root, packet.options)
        currentReminders.set(id, current)

        const key = `${slot.lane}\u0000${current.identity}`
        const group = groups.get(key) ?? []
        group.push({
          slot,
          start: match.index,
          end: match.index + match[0].length,
          kind: match[2] ?? '',
          body: match[3] ?? '',
          packet,
          current,
        })
        groups.set(key, group)
      }
    }

    if (
      groups.size > 0 &&
      request.truncation !== undefined &&
      request.truncation !== 'disabled'
    ) {
      throw new PanError(
        'Disable server truncation before optimizing reminders.',
        { code: 'INVALID_REMINDER_REQUEST' },
      )
    }

    const replacements = new Map<
      TextSlot,
      Array<{ start: number; end: number; text: string }>
    >()
    const identityTransitions: Array<{ previous: string; current: string }> = []
    const stats = {
      full: 0,
      cues: 0,
      recovered: 0,
      identity_changes: 0,
      bytes_saved: 0,
    }

    for (const group of groups.values()) {
      const last = group.at(-1)

      if (!last) {
        continue
      }

      const current = last.current
      const previousIdentities = new Set(
        group
          .map((entry) => entry.packet.identity)
          .filter((identity) => identity !== current.identity),
      )
      const survivor =
        group.find(
          (entry) => entry.kind === 'full' && entry.body === entry.packet.body,
        ) ?? last
      const body =
        previousIdentities.size > 0
          ? `${current.content}\n\n${current.deferred_content}`
          : last.packet.body
      stats.identity_changes += previousIdentities.size

      for (const previous of previousIdentities) {
        identityTransitions.push({ previous, current: current.identity })
      }

      for (const entry of group) {
        const full = mode === 'full' || entry === survivor
        const text = frame(entry.packet, full ? 'full' : 'cue', body)
        const edits = replacements.get(entry.slot) ?? []
        edits.push({ start: entry.start, end: entry.end, text })
        replacements.set(entry.slot, edits)
        stats.full += full ? 1 : 0
        stats.cues += full ? 0 : 1
        stats.recovered +=
          full &&
          (current.identity !== entry.packet.identity ||
            entry.kind !== 'full' ||
            entry.body !== entry.packet.body)
            ? 1
            : 0
      }
    }

    for (const [slot, edits] of replacements) {
      let text = slot.text

      for (const edit of edits.sort(
        (left, right) => right.start - left.start,
      )) {
        text = `${text.slice(0, edit.start)}${edit.text}${text.slice(edit.end)}`
      }

      stats.bytes_saved +=
        Buffer.byteLength(slot.text) - Buffer.byteLength(text)
      slot.write(text)
    }

    return {
      request,
      stats: { ...stats, identity_transitions: identityTransitions },
    }
  }
}

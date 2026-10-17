import { readdirSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '../errors.js'
import {
  custodyAuthorityRoot,
  stageWriteRoots,
} from '../executors/scope-custody.js'
import {
  loadDelegationLiveRecord,
  delegationCustodyDirectory,
  delegationCustodyPreparationPath,
  delegationLivePaths,
  invocationCustodyIdentity,
  type DelegationLiveRecord,
} from '../executors/delegation-live.js'
import { withinWriteRoots } from '../executors/scope-custody.js'
import { parsePersonaMapping } from '../executors/mapping.js'
import { fileExists, readJson, resolveInside, stableStringify } from '../io.js'
import { custodyProtectionAvailable } from '../executors/write-sandbox.js'
import { resolveRunLayout } from '../run-layout.js'
import { resolveStageForAttempt } from '../stage-persona.js'
import type { Invocation, RunState, StageDefinition } from '../types.js'

export interface ScopeCustody {
  own: string[]
  foreign: string[]
  unverified: string[]
  evidence: string[]
  missing: string[]
  invalid: boolean
}

/** Negative attribution needs every launch, not just the final successful retry. */
export function classifyControllerChanges(
  root: string,
  workspace: string,
  state: RunState,
  stage: StageDefinition,
  controllerPaths: string[],
): ScopeCustody {
  const result: ScopeCustody = {
    own: [],
    foreign: [],
    unverified: [],
    evidence: [],
    missing: [],
    invalid: false,
  }
  const records: DelegationLiveRecord[] = []
  const pointer = state.current_invocation
  const expectedRoots = stageWriteRoots(root, workspace, stage)
  const directory = resolveRunLayout(root, state.run_id).evidence('').absolute
  try {
    if (!pointer) {
      result.missing.push('Legacy invocation has no process custody identity.')
    } else {
      const identity = {
        run_id: state.run_id,
        invocation_id: pointer.id,
      }
      const authorityDirectory = delegationCustodyDirectory(root, identity)
      const preparation = delegationCustodyPreparationPath(root, identity)
      const authorityPath = path.join(authorityDirectory, 'invocation.json')
      const deliveredPath = resolveInside(root, pointer.json_path)
      const hasProtectedPreparation =
        fileExists(authorityDirectory) || fileExists(preparation)
      if (!fileExists(authorityPath)) {
        const hasPublicLaunches =
          fileExists(directory) &&
          readdirSync(directory).some(
            (name) =>
              name.startsWith(`${pointer.id}.copilot.`) &&
              name.endsWith('.live.json'),
          )
        if (hasProtectedPreparation || hasPublicLaunches) {
          throw new Error(
            'Prepared invocation has no protected launch inventory; collect custody in a fresh invocation.',
          )
        }
        result.missing.push(
          'Legacy invocation has no protected launch inventory; controller changes remain unverified.',
        )
        result.unverified.push(...controllerPaths)
        return result
      }
      if (!fileExists(deliveredPath)) {
        throw new Error(
          'Prepared invocation is missing its delivered identity.',
        )
      }
      const delivered = readJson(deliveredPath) as Invocation
      const invocation = readJson(authorityPath) as ReturnType<
        typeof invocationCustodyIdentity
      >
      if (
        fileExists(preparation) &&
        stableStringify(readJson(preparation)) !== stableStringify(invocation)
      ) {
        throw new Error(
          'Invocation custody differs from protected preparation.',
        )
      }
      if (!custodyProtectionAvailable()) {
        result.missing.push(
          'Controller custody protection is unavailable on this host.',
        )
      }
      if (
        stableStringify(invocation) !==
        stableStringify(invocationCustodyIdentity(delivered))
      ) {
        result.invalid = true
        result.missing.push(
          'Delivered invocation differs from protected scope authority.',
        )
      }
      if (
        invocation.run_id !== state.run_id ||
        invocation.invocation_id !== pointer.id ||
        invocation.stage.slug !== stage.slug ||
        invocation.stage.persona !==
          resolveStageForAttempt(root, state, stage).persona
      ) {
        throw new Error('Invocation custody does not match the active stage.')
      }
      const roles = new Map([
        ['stage', invocation.stage.persona_executor],
        ...(invocation.evidence_workers ?? []).map(
          (worker) =>
            [worker.role, parsePersonaMapping(worker.model).executor] as const,
        ),
      ])
      const inventory = readdirSync(authorityDirectory)
        .filter((name) => name.endsWith('.live.json'))
        .sort()
      for (const name of fileExists(directory) ? readdirSync(directory) : []) {
        if (
          name.startsWith(`${pointer.id}.copilot.`) &&
          name.endsWith('.live.json') &&
          !inventory.includes(name)
        ) {
          result.invalid = true
          result.missing.push(
            `Launch is absent from protected inventory: ${name}.`,
          )
        }
      }
      for (const name of inventory) {
        if (
          !name.startsWith(`${pointer.id}.copilot.`) ||
          !name.endsWith('.live.json')
        ) {
          continue
        }
        const raw = readJson(
          resolveInside(authorityDirectory, name),
        ) as DelegationLiveRecord
        if (
          raw.run_id !== state.run_id ||
          raw.invocation_id !== pointer.id ||
          !roles.has(raw.role) ||
          raw.attempt !== invocation.attempt
        ) {
          throw new Error(`Wrong run, role, or attempt in ${name}.`)
        }
        const record = loadDelegationLiveRecord(root, raw, true)
        if (
          !record ||
          path.basename(
            `${record.invocation_id}.copilot.${record.role}.attempt-${record.attempt}.${record.launch_id}.live.json`,
          ) !== name
        ) {
          throw new Error(`Custody path identity mismatch: ${name}.`)
        }
        records.push(record)
        result.evidence.push(path.join(authorityDirectory, name))
        const publicPath = delegationLivePaths(root, record).record
        try {
          if (
            !fileExists(publicPath) ||
            stableStringify(readJson(publicPath)) !== stableStringify(record)
          ) {
            throw new Error('Public snapshot is missing or changed.')
          }
        } catch (error) {
          result.invalid = true
          result.missing.push(
            `Public custody record is missing or differs from controller authority: ${name} (${errorMessage(error)}).`,
          )
        }
        if (
          roles.get(record.role) !== record.executor ||
          !record.relay_start_identity?.trim() ||
          !record.child_start_identity?.trim() ||
          !record.child_pid ||
          !record.ended_at ||
          (typeof record.exit_code !== 'number' && !record.signal) ||
          record.error ||
          record.truncated ||
          !record.write_boundary
        ) {
          result.missing.push(`Incomplete process custody: ${name}.`)
        }
        const boundary = record.write_boundary
        if (!boundary || boundary.mode !== 'sandbox-exec') {
          result.missing.push(
            `Write enforcement unavailable: ${boundary?.reason ?? 'no boundary recorded'} (${name}).`,
          )
        } else if (
          boundary.reason !== '' ||
          boundary.write_roots.length !== expectedRoots.length ||
          !expectedRoots.every((expected) =>
            boundary.write_roots.includes(expected),
          ) ||
          !expectedRoots.every((expected) =>
            withinWriteRoots(expected, boundary.effective_write_roots),
          )
        ) {
          result.missing.push(
            `Write roots differ from stage authority: ${name}.`,
          )
          result.invalid = true
        }
        for (const observation of record.write_observations ?? []) {
          if (
            !withinWriteRoots(observation.path, expectedRoots) ||
            withinWriteRoots(observation.path, [custodyAuthorityRoot(root)])
          ) {
            result.own.push(
              `${observation.path} (${observation.outcome}; ${observation.evidence})`,
            )
          }
        }
      }
      for (const role of roles.keys()) {
        if (!records.some((record) => record.role === role)) {
          result.missing.push(
            `No launch custody records exist for the active invocation role '${role}'.`,
          )
        }
      }
    }
  } catch (error) {
    result.invalid = true
    result.missing.push(`Invalid custody evidence: ${errorMessage(error)}`)
  }
  for (const relative of controllerPaths) {
    const target = path.resolve(root, relative)
    const excluded =
      result.missing.length === 0 &&
      records.length > 0 &&
      records.every(
        (record) =>
          !withinWriteRoots(
            target,
            record.write_boundary?.effective_write_roots ?? [],
          ),
      )
    if (excluded) {
      result.foreign.push(relative)
    } else {
      result.unverified.push(relative)
    }
  }
  return result
}

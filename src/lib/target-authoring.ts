/**
 * Target-owned command and persona authoring entry point. The implementation
 * lives in `./target-authoring/`: the manifest and draft shapes, the apply
 * path with its clone-local exclusions, and the repository validation of
 * published extensions. This module re-exports their public surface so the
 * CLI, the handler registry, and the tests keep one import path.
 */

export { readTargetExtensionManifest } from './target-authoring/manifest.js'
export type {
  TargetExtensionKind,
  TargetExtensionManifest,
  TargetAuthoringApplyResult,
  TargetAuthoringValidationResult,
} from './target-authoring/manifest.js'
export { applyTargetAuthoringDraft } from './target-authoring/apply.js'
export { validateTargetAuthoring } from './target-authoring/validate.js'

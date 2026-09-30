/**
 * Standalone governance card entry point. The implementation lives in
 * `./governance-card/`: the standalone mode table, the card renderer, and the
 * card builder. This module re-exports their public surface so the CLI, the
 * prompt hook, and the tests keep one import path.
 */

export { STANDALONE_MODES } from './governance-card/modes.js'
export type { StandaloneMode } from './governance-card/modes.js'
export { renderGovernanceCardMarkdown } from './governance-card/render.js'
export type { GovernanceCardRunBinding } from './governance-card/render.js'
export { buildGovernanceCard } from './governance-card/build.js'
export type {
  GovernanceCard,
  GovernanceCardOptions,
} from './governance-card/build.js'

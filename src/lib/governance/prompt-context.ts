/**
 * Governance turn reminder entry point. The implementation lives in
 * `./prompt-context/`: the profile registry, the active card lookup, reminder
 * rendering, and the prompt hook's role routing. This module re-exports their
 * public surface so the CLI, repository validation, and the tests keep one
 * import path.
 */

export {
  TURN_REMINDER_REGISTRY_PATH,
  TURN_REMINDER_SCHEMA_PATH,
  TURN_REMINDER_STATE_PATH,
  TURN_REMINDER_ROLES,
  TURN_REMINDER_CARD_MODES,
  REFRESH_DIGESTS_COMMAND,
  turnReminderCardPath,
  parseTurnReminderRegistry,
  loadTurnReminderRegistry,
  resolveProfileSelectors,
} from './prompt-context/registry.js'
export type {
  TurnReminderRole,
  PolicySelector,
  TurnReminderCardMode,
  CardSection,
  CardSelector,
  TurnReminderSelector,
  TurnReminderRegistry,
} from './prompt-context/registry.js'
export {
  cardSection,
  installationCardMode,
  resolveTurnReminderLines,
  renderTurnReminder,
  validateTurnReminderProfiles,
} from './prompt-context/reminders.js'
export type {
  ResolvedReminderLine,
  RenderedTurnReminder,
} from './prompt-context/reminders.js'
export { resolvePromptContext } from './prompt-context/routing.js'
export type { PromptContextResponse } from './prompt-context/routing.js'

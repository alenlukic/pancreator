/**
 * Project configuration entry point. The implementation lives in
 * `./project-config/`: the configuration files and worktree defaults, the
 * block validators, and the loaded configuration with its resolvers. This
 * module re-exports their public surface so every importer keeps one import
 * path.
 */

export {
  CURRENT_MANAGED_WORKTREES_ROOT,
  LEGACY_MANAGED_WORKTREES_ROOT,
  DEFAULT_WORKTREE_ROOT,
  LEGACY_DEFAULT_WORKTREE_ROOT,
  bestOfNCandidatePath,
  legacyBestOfNCandidatePath,
  DEFAULT_WORKTREE_BRANCH_PREFIX,
  AWAY_MODE_ACTIONS,
  DEFAULT_RETENTION_DAYS,
  PROJECT_HOSTS,
  DEFAULT_PROJECT_HOSTS,
  type ProjectHost,
  LOCAL_CONFIG_PATH,
  LEGACY_LOCAL_CONFIG_PATH,
  localConfigName,
  mergeConfigValues,
  readHarnessConfig,
  harnessConfigName,
} from './project-config/files.js'
export {
  isLoopbackHostname,
  resolveSpendSyncOrigin,
  DEFAULT_HANDOFF_MODEL,
  DEFAULT_HANDOFF_EFFORT,
} from './project-config/blocks.js'
export {
  configuredWorktreeRoot,
  readProjectConfig,
  loadProjectConfig,
  readInstallationIdentity,
  configuredWorkspaceRoot,
  enabledHosts,
  registeredInstallations,
  resolveRegisteredInstallation,
  worktreesConfig,
  retentionDaysFromConfig,
  resolveRetentionDays,
  resolveAwayModeConfig,
  isSelfDevelopmentInstallation,
  isEmbeddedInstallation,
  isDetachedInstallation,
  isTargetInstallation,
  harnessPathPrefix,
  panCommand,
  HANDOFF_LABEL_MAX_BYTES,
  resolveHandoffConfig,
} from './project-config/resolve.js'

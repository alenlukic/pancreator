/**
 * Workflow definition entry point. The implementation lives in `./workflow/`:
 * stage parsing, workflow assembly, stage and persona lookups, and the
 * imperative validator `pan validate` runs. This module re-exports their
 * public surface so the engine, the CLI, and the tests keep one import path.
 */

export { parseStage } from './workflow/stage.js'
export {
  loadWorkflow,
  loadWorkflowFile,
  listWorkflowSlugs,
} from './workflow/load.js'
export {
  stagePersonaCandidates,
  workflowPersonaNames,
  stageBySlug,
  loadStagePrompt,
} from './workflow/lookup.js'
export { validateWorkflow } from './workflow/validate.js'

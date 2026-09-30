/**
 * Operator brief system entry point. The implementation lives in `./briefs/`:
 * shared shapes, the registry loader, the brief parser, the HTML renderer, and
 * the worker-facing scaffold. This module re-exports their public surface so
 * the CLI and the tests keep one stable import path.
 */

export type {
  BriefBuildResult,
  BriefCard,
  BriefRenderResult,
  BriefSection,
  BriefSystemValidationResult,
  OperatorBrief,
} from './briefs/types.js'
export { buildBriefSystem, validateBriefSystem } from './briefs/registry.js'
export type {
  BriefScaffoldOptions,
  BriefVocabulary,
} from './briefs/scaffold.js'
export {
  resolveBriefVocabulary,
  scaffoldOperatorBrief,
} from './briefs/scaffold.js'
export { writeOperatorBriefSource } from './briefs/parse.js'
export { renderBrief } from './briefs/render.js'

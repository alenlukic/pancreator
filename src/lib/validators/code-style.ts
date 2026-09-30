/**
 * Deterministic code style validator entry point. The implementation lives in
 * `./code-style/`: language detection and non-code masking, the line rules and
 * structural collectors, and the analysis and requirement handler. This module
 * re-exports their public surface so the handler registry, the CLI, and the
 * tests keep one import path.
 */

export {
  MAX_REPORTED_ISSUES,
  CODE_STYLE_EXTENSIONS,
  codeStyleLanguage,
  CODE_STYLE_POLICY_IDS,
  codeStylePolicyId,
  maskScriptNonCode,
  maskPythonNonCode,
} from './code-style/source.js'
export type { CodeStyleLanguage, CodeStyleIssue } from './code-style/source.js'
export { analyzeCodeStyle, validateCodeStyle } from './code-style/analysis.js'

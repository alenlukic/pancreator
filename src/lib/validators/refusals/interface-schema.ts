/** Refusal tables of the prototype-trace interface-schema validator. */

import type { StageRefusal } from './shapes.js'

/** Raised before the handler reaches field checks. */
const SCHEMA_SHAPE: StageRefusal = {
  code: 'schema.shape',
  paths: [],
  unowned_reason:
    'The stage output is not an object, so no field inside it exists to declare.',
}

/**
 * Refusals `validateInterfaceSchema` can raise for the prototype-trace
 * trace stage.
 */
export const TRACE_SCHEMA_REFUSALS: readonly StageRefusal[] = [
  SCHEMA_SHAPE,
  { code: 'schema.skeletons', paths: ['data.skeletons[]'] },
  { code: 'schema.skeleton_name', paths: ['data.skeletons[].name'] },
  {
    code: 'schema.skeleton_signature',
    paths: ['data.skeletons[].signature'],
  },
  { code: 'schema.trace_tests', paths: ['data.trace_tests[]'] },
  { code: 'schema.trace_test_shape', paths: ['data.trace_tests[]'] },
  {
    code: 'schema.trace_test_field',
    paths: ['data.trace_tests[].id', 'data.trace_tests[].path'],
  },
  { code: 'schema.trace_test_kind', paths: ['data.trace_tests[].kind'] },
  { code: 'schema.trace_test_e2e', paths: ['data.trace_tests[].kind'] },
  { code: 'schema.meta_missing', paths: ['data.interface_schema'] },
  { code: 'schema.meta_path', paths: ['data.interface_schema.path'] },
  { code: 'schema.meta_idiom', paths: ['data.interface_schema.idiom'] },
  { code: 'schema.meta_notes', paths: ['data.interface_schema.notes'] },
  { code: 'schema.path', paths: ['data.interface_schema.path'] },
  {
    code: 'schema.missing',
    paths: [],
    unowned_reason:
      'The refusal relates the declared schema path to a file on disk.',
  },
  {
    code: 'schema.file_shape',
    paths: [],
    unowned_reason:
      'The refusal is the shape of the schema file, not a stage-output field.',
  },
  {
    code: 'schema.drift',
    paths: [],
    unowned_reason:
      'The refusal compares claimed skeleton signatures against the schema file.',
  },
]

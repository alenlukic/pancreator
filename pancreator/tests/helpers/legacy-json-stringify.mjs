/**
 * Test-only helper: emit legacy `JSON.stringify(..., null, 2)` text for migration fixtures.
 * Production code MUST NOT import this module.
 */

/** @param {unknown} value @returns {string} */
export function legacyPrettyJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

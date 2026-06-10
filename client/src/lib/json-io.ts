/** Browser-safe compact JSON for fetch bodies and mock responses. */
export function stringifyCompactJson(value: unknown): string {
  return JSON.stringify(value);
}

/** Quote a string as a JSON string literal (YAML scalars, shell-safe tokens). */
export function quoteJsonString(value: string): string {
  return JSON.stringify(value);
}

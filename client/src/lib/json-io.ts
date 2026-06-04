/** Browser-safe compact JSON for fetch bodies and mock responses. */
export function stringifyCompactJson(value: unknown): string {
  return JSON.stringify(value);
}

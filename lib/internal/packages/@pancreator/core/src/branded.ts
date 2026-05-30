declare const taskIdBrand: unique symbol;
declare const featureIdBrand: unique symbol;
declare const contentHashBrand: unique symbol;

/**
 * Opaque string for a pipeline workspace path segment under `work/`.
 */
export type TaskId = string & { readonly [taskIdBrand]: true };

/**
 * Opaque string for a Feature slug under `lib/memory/features/`.
 */
export type FeatureId = string & { readonly [featureIdBrand]: true };

/**
 * Opaque string for a dual-anchor content hash (SHA-256 hex).
 */
export type ContentHash = string & { readonly [contentHashBrand]: true };

export function asTaskId(value: string): TaskId {
  return value as TaskId;
}

export function asFeatureId(value: string): FeatureId {
  return value as FeatureId;
}

export function asContentHash(value: string): ContentHash {
  return value as ContentHash;
}

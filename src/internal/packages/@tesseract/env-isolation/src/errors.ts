/** Base error for port registry operations. */
export class PortRegistryError extends Error {
  override name = "PortRegistryError";
}

/** No contiguous block remains in the configured range. */
export class PortRangeExhaustedError extends PortRegistryError {
  override name = "PortRangeExhaustedError";
}

/** On-disk registry lists the same port for two tasks. */
export class PortRegistryCollisionError extends PortRegistryError {
  override name = "PortRegistryCollisionError";
}

/** Reserved port block leaves the configured inclusive range. */
export class InvalidPortRangeError extends PortRegistryError {
  override name = "InvalidPortRangeError";
}

/** Registry file path is not under `repoRoot/.tess/sandboxes`. */
export class InvalidRegistryPathError extends PortRegistryError {
  override name = "InvalidRegistryPathError";
}

/** Task id contains unsafe segments for registry keys. */
export class InvalidTaskIdError extends PortRegistryError {
  override name = "InvalidTaskIdError";
}

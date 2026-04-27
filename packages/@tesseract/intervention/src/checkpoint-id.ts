/**
 * Opaque checkpoint identifier string aligned with LangGraph `checkpoint_id` usage.
 * This package does not depend on `@tesseract/checkpointer-fs`; callers map envelopes as needed.
 */
export type CheckpointId = string;

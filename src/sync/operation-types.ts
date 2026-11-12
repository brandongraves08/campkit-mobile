export const OPERATION_STATUSES = ['pending', 'conflict', 'needs_attention'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];
export type ConflictResolution = 'keep_server' | 'apply_local';

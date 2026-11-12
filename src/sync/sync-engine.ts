import { ConflictResolution } from './operation-types';
import * as Crypto from 'expo-crypto';
import { NewOperation, OperationErrorCode, OPERATION_ERROR_CODES, PendingOperation } from '../storage/operations-repository';

type Snapshot = { packing: { entryId: string; packed: boolean; version: number }[] };
type Operations = {
  enqueue(input: NewOperation & Partial<Pick<PendingOperation, 'memberId' | 'householdId' | 'status' | 'createdAt' | 'errorCode'>>): Promise<PendingOperation>;
  list(status?: string): Promise<PendingOperation[]>;
  get(id: string): Promise<PendingOperation | null>;
  updateStatus(id: string, status: PendingOperation['status'], errorCode?: OperationErrorCode | null): Promise<void>;
  remove(id: string): Promise<boolean>;
};
type Trips = {
  getSnapshot(tripId: string): Promise<Snapshot | null>;
  setPacked(tripId: string, entryId: string, packed: boolean): Promise<void>;
  updatePacking(tripId: string, entryId: string, packed: boolean, version: number): Promise<void>;
};
type Transport = (operation: PendingOperation) => Promise<{ entryId: string; packed: boolean; version: number; clientOperationId: string }>;
type Options = { memberId: string; householdId: string; operations: Operations; trips: Trips; transport: Transport; id?: () => string; now?: () => Date; sleep?: (milliseconds: number) => Promise<void>; maxAttempts?: number };
export type SyncSummary = { synced: number; conflicts: number; needsAttention: number; paused: boolean };
const RETRYABLE = new Set(['network_error', 'timeout', 'server_unavailable', 'operation_in_progress']);
const AUTH = new Set(['unauthorized', 'membership_revoked']);
const CONFLICT = 'version_conflict';
const ATTENTION = new Set(['invalid_request', 'not_found', 'trip_read_only', 'idempotency_key_reused']);
function errorCode(error: unknown): OperationErrorCode | null {
  if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') return null;
  const code = error.code.toLowerCase();
  return OPERATION_ERROR_CODES.includes(code as OperationErrorCode) ? code as OperationErrorCode : null;
}

/** Durable, account-scoped desired-state queue with bounded foreground retries. */
export class SyncEngine {
  private readonly makeId: () => string;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly maxAttempts: number;
  constructor(private readonly options: Options) {
    this.makeId = options.id ?? (() => Crypto.randomUUID());
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxAttempts = Math.max(1, Math.min(options.maxAttempts ?? 3, 5));
  }
  async setPackedState(tripId: string, entryId: string, packed: boolean): Promise<PendingOperation> {
    if (typeof packed !== 'boolean') throw new Error('Packed state must be boolean');
    const snapshot = await this.options.trips.getSnapshot(tripId);
    const row = snapshot?.packing.find((item) => item.entryId === entryId);
    if (!row) throw new Error('Packing row is not available in a downloaded trip');
    const op = await this.options.operations.enqueue({ id: this.makeId(), memberId: this.options.memberId, householdId: this.options.householdId, tripId, entryId, packed, baseVersion: row.version, status: 'pending', createdAt: this.now().toISOString(), errorCode: null });
    await this.options.trips.setPacked(tripId, entryId, packed);
    return op;
  }
  async syncPendingOperations(): Promise<SyncSummary> {
    const summary: SyncSummary = { synced: 0, conflicts: 0, needsAttention: 0, paused: false };
    const pending = await this.options.operations.list('pending');
    pending.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    for (const op of pending) {
      if (op.memberId !== this.options.memberId || op.householdId !== this.options.householdId) { summary.paused = true; break; }
      let done = false;
      for (let attempt = 0; attempt < this.maxAttempts && !done; attempt++) {
        try {
          const ack = await this.options.transport(op);
          if (ack.clientOperationId !== op.id || ack.entryId !== op.entryId || ack.packed !== op.packed || !Number.isInteger(ack.version) || ack.version < 1) throw new Error('Invalid packing acknowledgement');
          await this.options.trips.updatePacking(op.tripId, op.entryId, op.packed, ack.version);
          await this.options.operations.remove(op.id);
          summary.synced++;
          done = true;
        } catch (error) {
          const code = errorCode(error);
          if (code && AUTH.has(code)) { summary.paused = true; return summary; }
          if (code === CONFLICT) {
            const conflict = error as { packed?: unknown; version?: unknown };
            if (typeof conflict.packed === 'boolean' && Number.isInteger(conflict.version) && (conflict.version as number) >= 1) await this.options.trips.updatePacking(op.tripId, op.entryId, conflict.packed, conflict.version as number);
            await this.options.operations.updateStatus(op.id, 'conflict', code); summary.conflicts++; done = true;
          }
          else if (code && ATTENTION.has(code)) { await this.options.operations.updateStatus(op.id, 'needs_attention', code); summary.needsAttention++; done = true; }
          else if (code && RETRYABLE.has(code) && attempt + 1 < this.maxAttempts) await this.sleep(Math.min(250 * 2 ** attempt, 2000));
          else { done = true; if (!code) summary.paused = true; }
        }
      }
      if (summary.paused) break;
    }
    return summary;
  }
  async resolveConflict(operationId: string, resolution: ConflictResolution): Promise<void> {
    if (resolution !== 'keep_server' && resolution !== 'apply_local') throw new Error('Invalid conflict resolution');
    const op = await this.options.operations.get(operationId);
    if (!op || op.status !== 'conflict' || op.memberId !== this.options.memberId || op.householdId !== this.options.householdId) throw new Error('Conflict is not available in this account');
    const snapshot = await this.options.trips.getSnapshot(op.tripId);
    const row = snapshot?.packing.find((item) => item.entryId === op.entryId);
    if (!row) { await this.options.operations.updateStatus(op.id, 'needs_attention', 'not_found'); return; }
    if (resolution === 'keep_server') {
      await this.options.trips.setPacked(op.tripId, op.entryId, row.packed);
      await this.options.operations.remove(op.id);
      return;
    }
    await this.options.operations.enqueue({ id: this.makeId(), memberId: op.memberId, householdId: op.householdId, tripId: op.tripId, entryId: op.entryId, packed: op.packed, baseVersion: row.version, status: 'pending', createdAt: this.now().toISOString(), errorCode: null });
    await this.options.operations.remove(op.id);
  }
}

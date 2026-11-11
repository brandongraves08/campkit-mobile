import { assertPackingEntryId, assertUuid, CampKitDatabase } from './database';

export const OPERATION_STATUSES = ['pending', 'conflict', 'needs_attention'] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

export interface NewOperation {
  id: string;
  tripId: string;
  entryId: string;
  packed: boolean;
  baseVersion: number;
}

export interface PendingOperation extends NewOperation {
  memberId: string;
  householdId: string;
  status: OperationStatus;
  createdAt: string;
  errorCode: string | null;
}

interface OperationRow {
  id: string;
  member_id: string;
  household_id: string;
  trip_id: string;
  entry_id: string;
  packed: number;
  base_version: number;
  status: string;
  created_at: string;
  error_code: string | null;
}

function assertStatus(value: unknown): OperationStatus {
  if (!OPERATION_STATUSES.includes(value as OperationStatus)) {
    throw new Error(`Invalid operation status: ${String(value)}`);
  }
  return value as OperationStatus;
}

function assertBaseVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Invalid base version for operation');
  }
  return value;
}

function assertPacked(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid packed state for operation');
  return value;
}

function assertErrorCode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 120) {
    throw new Error('Invalid error code for operation');
  }
  return value;
}

function toOperation(row: OperationRow): PendingOperation {
  return {
    id: row.id,
    memberId: row.member_id,
    householdId: row.household_id,
    tripId: row.trip_id,
    entryId: row.entry_id,
    packed: row.packed === 1,
    baseVersion: row.base_version,
    status: assertStatus(row.status),
    createdAt: row.created_at,
    errorCode: row.error_code,
  };
}

const OPERATION_COLUMNS = 'id, member_id, household_id, trip_id, entry_id, packed, base_version, status, created_at, error_code';

/** Durable desired-state queue for one member + household scope. */
export class OperationsRepository {
  constructor(private readonly database: CampKitDatabase) {}

  async enqueue(operation: NewOperation): Promise<PendingOperation> {
    assertUuid(operation.id, 'operation');
    assertUuid(operation.tripId, 'trip');
    assertPackingEntryId(operation.entryId);
    const packed = assertPacked(operation.packed);
    const baseVersion = assertBaseVersion(operation.baseVersion);
    const { memberId, householdId } = this.database;
    const createdAt = new Date().toISOString();

    await this.database.run(
      `INSERT INTO operations (id, member_id, household_id, trip_id, entry_id, packed, base_version, status, created_at, error_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL)`,
      [operation.id, memberId, householdId, operation.tripId, operation.entryId, packed ? 1 : 0, baseVersion, createdAt],
    );

    return {
      id: operation.id,
      memberId,
      householdId,
      tripId: operation.tripId,
      entryId: operation.entryId,
      packed,
      baseVersion,
      status: 'pending',
      createdAt,
      errorCode: null,
    };
  }

  async get(id: string): Promise<PendingOperation | null> {
    assertUuid(id, 'operation');
    const row = await this.database.getFirst<OperationRow>(
      `SELECT ${OPERATION_COLUMNS} FROM operations WHERE member_id = ? AND household_id = ? AND id = ?`,
      [this.database.memberId, this.database.householdId, id],
    );
    return row ? toOperation(row) : null;
  }

  async list(status?: OperationStatus): Promise<PendingOperation[]> {
    const { memberId, householdId } = this.database;
    const rows = status === undefined
      ? await this.database.getAll<OperationRow>(
        `SELECT ${OPERATION_COLUMNS} FROM operations WHERE member_id = ? AND household_id = ?
         ORDER BY created_at, id`,
        [memberId, householdId],
      )
      : await this.database.getAll<OperationRow>(
        `SELECT ${OPERATION_COLUMNS} FROM operations WHERE member_id = ? AND household_id = ? AND status = ?
         ORDER BY created_at, id`,
        [memberId, householdId, assertStatus(status)],
      );
    return rows.map(toOperation);
  }

  async updateStatus(id: string, status: OperationStatus, errorCode: string | null = null): Promise<void> {
    assertUuid(id, 'operation');
    const nextStatus = assertStatus(status);
    const nextErrorCode = assertErrorCode(errorCode);
    const result = await this.database.run(
      'UPDATE operations SET status = ?, error_code = ? WHERE member_id = ? AND household_id = ? AND id = ?',
      [nextStatus, nextErrorCode, this.database.memberId, this.database.householdId, id],
    );
    if (result.changes === 0) throw new Error('Operation not found in this account scope');
  }

  async remove(id: string): Promise<boolean> {
    assertUuid(id, 'operation');
    const result = await this.database.run(
      'DELETE FROM operations WHERE member_id = ? AND household_id = ? AND id = ?',
      [this.database.memberId, this.database.householdId, id],
    );
    return result.changes > 0;
  }
}

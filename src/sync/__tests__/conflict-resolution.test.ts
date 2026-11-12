import { describe, expect, it, jest } from '@jest/globals';
import { SyncEngine } from '../sync-engine';
import { PendingOperation } from '../../storage/operations-repository';

const conflict: PendingOperation = {
  id: '55555555-5555-4555-8555-555555555555', memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111',
  tripId: '33333333-3333-4333-8333-333333333333', entryId: '12', packed: true, baseVersion: 3,
  status: 'conflict', createdAt: '2026-01-01T00:00:00.000Z', errorCode: 'version_conflict',
};
function harness() {
  let rows = [conflict];
  const operations = {
    get: jest.fn(async (id: string) => rows.find((row) => row.id === id) ?? null),
    enqueue: jest.fn(async (row: PendingOperation) => { rows.push(row); return row; }),
    remove: jest.fn(async (id: string) => { rows = rows.filter((row) => row.id !== id); return true; }),
    updateStatus: jest.fn(async () => {}), list: jest.fn(async () => rows),
  };
  const trips = { getSnapshot: jest.fn(async () => ({ packing: [{ entryId: '12', packed: false, version: 7 }] })), setPacked: jest.fn(async (_tripId: string, _entryId: string, _packed: boolean) => {}), updatePacking: jest.fn(async (_tripId: string, _entryId: string, _packed: boolean, _version: number) => {}) };
  const transport = jest.fn<(item: PendingOperation) => Promise<{ entryId: string; packed: boolean; version: number; clientOperationId: string }>>(async () => { throw new Error('unused'); });
  const engine = new SyncEngine({ memberId: 'member-a', householdId: conflict.householdId, operations: operations as never, trips: trips as never, transport, id: () => '66666666-6666-4666-8666-666666666666', now: () => new Date('2026-01-02T00:00:00.000Z'), sleep: async () => {}, maxAttempts: 3 });
  return { engine, operations, trips, rows: () => rows };
}

describe('explicit conflict resolution', () => {
  it('keeps the server value and removes the unresolved operation without a write', async () => {
    const { engine, operations, trips, rows } = harness();
    await engine.resolveConflict(conflict.id, 'keep_server');
    expect(operations.remove).toHaveBeenCalledWith(conflict.id);
    expect(trips.setPacked).toHaveBeenCalledWith(conflict.tripId, conflict.entryId, false);
    expect(operations.enqueue).not.toHaveBeenCalled();
    expect(rows()).toHaveLength(0);
  });
  it('applies local intent as a fresh operation based on the current server version', async () => {
    const { engine, operations, rows } = harness();
    await engine.resolveConflict(conflict.id, 'apply_local');
    expect(operations.remove).toHaveBeenCalledWith(conflict.id);
    expect(operations.enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: '66666666-6666-4666-8666-666666666666', packed: true, baseVersion: 7, status: 'pending' }));
    expect(operations.enqueue.mock.invocationCallOrder[0]).toBeLessThan(operations.remove.mock.invocationCallOrder[0]);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ id: '66666666-6666-4666-8666-666666666666', status: 'pending', baseVersion: 7 });
  });
  it('rejects unsupported conflict resolutions', async () => {
    const { engine } = harness();
    await expect(engine.resolveConflict(conflict.id, 'overwrite' as never)).rejects.toThrow('Invalid conflict resolution');
  });
});

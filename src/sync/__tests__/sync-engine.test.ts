import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { SyncEngine } from '../sync-engine';
import { OperationErrorCode, PendingOperation } from '../../storage/operations-repository';

const op = (overrides: Partial<PendingOperation> = {}): PendingOperation => ({
  id: '55555555-5555-4555-8555-555555555555', memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111',
  tripId: '33333333-3333-4333-8333-333333333333', entryId: '12', packed: true, baseVersion: 3,
  status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', errorCode: null, ...overrides,
});

function setup(initial: PendingOperation[] = []) {
  let queue = [...initial];
  const operations = {
    enqueue: jest.fn(async (input: PendingOperation) => { queue.push(input); return input; }),
    list: jest.fn(async (status?: string) => queue.filter((item) => !status || item.status === status)),
    get: jest.fn(async (id: string) => queue.find((item) => item.id === id) ?? null),
    updateStatus: jest.fn(async (id: string, status: PendingOperation['status'], errorCode: OperationErrorCode | null = null) => { queue = queue.map((item) => item.id === id ? { ...item, status, errorCode } : item); }),
    remove: jest.fn(async (id: string) => { queue = queue.filter((item) => item.id !== id); return true; }),
  };
  const trips = {
    getSnapshot: jest.fn(async () => ({ packing: [{ entryId: '12', packed: false, version: 3 }] })),
    setPacked: jest.fn(async (_tripId: string, _entryId: string, _packed: boolean) => {}), updatePacking: jest.fn(async (_tripId: string, _entryId: string, _packed: boolean, _version: number) => {}),
  };
  const transport = jest.fn<(item: PendingOperation) => Promise<{ entryId: string; packed: boolean; version: number; clientOperationId: string }>>(async (item: PendingOperation) => ({ entryId: item.entryId, packed: item.packed, version: item.baseVersion + 1, clientOperationId: item.id }));
  const engine = new SyncEngine({ memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111', operations: operations as never, trips: trips as never, transport, id: () => op().id, now: () => new Date('2026-01-02T00:00:00.000Z'), sleep: async () => {}, maxAttempts: 3 });
  return { engine, operations, trips, transport, getQueue: () => queue };
}

describe('durable desired-state sync engine', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('persists desired packed value before resolving pending success', async () => {
    const { engine, operations, trips } = setup();
    const pending = await engine.setPackedState('33333333-3333-4333-8333-333333333333', '12', true);
    expect(operations.enqueue.mock.invocationCallOrder[0]).toBeLessThan(trips.setPacked.mock.invocationCallOrder[0]);
    expect(pending).toMatchObject({ packed: true, status: 'pending' });
    expect(trips.setPacked).toHaveBeenCalledWith(expect.anything(), '12', true);
  });

  it('queues false as a durable desired value rather than a toggle instruction', async () => {
    const { engine, operations } = setup();
    const pending = await engine.setPackedState('33333333-3333-4333-8333-333333333333', '12', false);
    expect(operations.enqueue).toHaveBeenCalledWith(expect.objectContaining({ packed: false, baseVersion: 3, status: 'pending' }));
    expect(pending.packed).toBe(false);
  });

  it('never reports an optimistic pending change when durable enqueue fails', async () => {
    const { engine, operations, trips } = setup();
    operations.enqueue.mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(engine.setPackedState('33333333-3333-4333-8333-333333333333', '12', true)).rejects.toThrow('disk unavailable');
    expect(trips.setPacked).not.toHaveBeenCalled();
  });

  it('retries a transient failure at most three times using the exact same operation UUID', async () => {
    const { engine, transport } = setup([op()]);
    transport.mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'network_error' })).mockRejectedValueOnce(Object.assign(new Error('network'), { code: 'network_error' }));
    const summary = await engine.syncPendingOperations();
    expect(transport).toHaveBeenCalledTimes(3);
    expect(transport.mock.calls.map(([item]) => item.id)).toEqual([op().id, op().id, op().id]);
    expect(summary).toMatchObject({ synced: 1, paused: false });
  });

  it('syncs in created order and updates acknowledged row version without crossing rows', async () => {
    const first = op(); const second = op({ id: '55555555-5555-4555-8555-555555555556', entryId: '13', baseVersion: 8 });
    const { engine, transport, trips, operations } = setup([second, first]);
    await engine.syncPendingOperations();
    expect(transport.mock.calls.map(([item]) => item.id)).toEqual([first.id, second.id]);
    expect(trips.updatePacking).toHaveBeenCalledWith(first.tripId, first.entryId, first.packed, 4);
    expect(trips.updatePacking).toHaveBeenCalledWith(second.tripId, second.entryId, second.packed, 9);
    expect(operations.remove).toHaveBeenCalledWith(first.id);
    expect(operations.remove).toHaveBeenCalledWith(second.id);
  });

  it('does not retry stale row versions and stores the server value from the conflict envelope', async () => {
    const { engine, transport, getQueue, trips } = setup([op()]);
    transport.mockRejectedValue(Object.assign(new Error('stale'), { status: 409, code: 'version_conflict', packed: false, version: 7 }));
    await engine.syncPendingOperations();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(getQueue()[0]).toMatchObject({ status: 'conflict', errorCode: 'version_conflict' });
    expect(trips.updatePacking).toHaveBeenCalledWith(op().tripId, op().entryId, false, 7);
  });

  it.each(['not_found', 'trip_read_only', 'idempotency_key_reused'] as const)('parks backend %s in Needs attention without retry', async (code) => {
    const { engine, transport, getQueue } = setup([op()]);
    transport.mockRejectedValue(Object.assign(new Error(code), { status: code === 'not_found' ? 404 : 409, code }));
    await engine.syncPendingOperations();
    expect(transport).toHaveBeenCalledTimes(1);
    expect(getQueue()[0]).toMatchObject({ status: 'needs_attention', errorCode: code });
  });

  it('retries operation_in_progress with the same operation UUID', async () => {
    const { engine, transport } = setup([op()]);
    transport.mockRejectedValueOnce(Object.assign(new Error('busy'), { status: 409, code: 'operation_in_progress' }));
    const summary = await engine.syncPendingOperations();
    expect(transport).toHaveBeenCalledTimes(2);
    expect(transport.mock.calls.map(([item]) => item.id)).toEqual([op().id, op().id]);
    expect(summary.synced).toBe(1);
  });

  it.each(['Unauthorized', 'membership_revoked'] as const)('pauses on %s without deleting queued work or replaying it to another account', async (code) => {
    const { engine, transport, getQueue } = setup([op()]);
    transport.mockRejectedValue(Object.assign(new Error(code), { status: code === 'Unauthorized' ? 401 : 403, code }));
    const summary = await engine.syncPendingOperations();
    expect(summary.paused).toBe(true);
    expect(getQueue()).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([{ memberId: 'member-b' }, { householdId: '22222222-2222-4222-8222-222222222222' }])('rejects attempts to sync work from a different account scope', async (scope) => {
    const { engine, transport, operations } = setup([op(scope)]);
    const summary = await engine.syncPendingOperations();
    expect(summary.paused).toBe(true);
    expect(transport).not.toHaveBeenCalled();
    expect(operations.remove).not.toHaveBeenCalled();
  });
});

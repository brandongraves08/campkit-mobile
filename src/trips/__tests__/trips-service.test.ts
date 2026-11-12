import { describe, expect, it, jest } from '@jest/globals';
import { TripSnapshot } from '../../storage/trips-repository';
import { TripsService } from '../trips-service';

const tripId = '22222222-2222-4222-8222-222222222222';
const entryId = '12';
const trip = { id: tripId, name: 'Synthetic ridge trip', destination: 'North Loop', start_date: '2026-07-01', end_date: '2026-07-03', status: 'planned' };
const snapshot = { trip: { id: tripId, name: trip.name }, packing: [{ id: 12, packed: false, quantity: 1, version: 3, gear: { id: 'gear-1', name: 'Synthetic stove', category: 'Cooking' } }] };
const stored: TripSnapshot = { tripId, name: trip.name, destination: 'North Loop', startsOn: '2026-07-01', endsOn: '2026-07-03', snapshotAt: '2026-06-30T12:00:00.000Z', version: 3, packing: [{ entryId, label: 'Synthetic stove', quantity: 1, packed: false, version: 3 }], downloadedAt: '2026-06-30T12:00:00.000Z' };

function setup() {
  const repository = {
    saveSnapshot: jest.fn<(input: any) => Promise<TripSnapshot>>(async () => stored),
    listSnapshots: jest.fn<() => Promise<any[]>>(async () => []),
    getSnapshot: jest.fn<(id: string) => Promise<TripSnapshot | null>>(async () => stored),
    setPacked: jest.fn<(trip: string, entry: string, packed: boolean) => Promise<void>>(async () => {}),
    updatePacking: jest.fn<(trip: string, entry: string, packed: boolean, version: number) => Promise<void>>(async () => {}),
  };
  const queue: any[] = [];
  const operations = {
    enqueue: jest.fn(async (input: any) => { const value = { ...input, memberId: 'member-a', householdId: '11111111-1111-4111-8111-111111111111', createdAt: '2026-06-30T12:00:00.000Z', errorCode: null }; queue.push(value); return value; }),
    list: jest.fn(async () => queue), get: jest.fn(async (id: string) => queue.find((item) => item.id === id) ?? null),
    updateStatus: jest.fn(async () => {}), remove: jest.fn(async (id: string) => { const at = queue.findIndex((item) => item.id === id); if (at >= 0) queue.splice(at, 1); return at >= 0; }),
  };
  const api = { listTrips: jest.fn<() => Promise<any[]>>(async () => [trip]), getPackingSnapshot: jest.fn<(id: string) => Promise<any>>(async () => snapshot), setPackedState: jest.fn(async (_trip: string, entry: string, input: any) => ({ entryId: entry, packed: input.packed, version: input.baseVersion + 1, clientOperationId: input.clientOperationId })) };
  const service = new TripsService({ api, memberId: 'member-a', householdId: async () => '11111111-1111-4111-8111-111111111111', repository: async () => repository, operations: async () => operations as any });
  return { service, api, repository, operations, queue };
}

describe('TripsService', () => {
  it('refreshes the online trip list without requiring local downloads', async () => {
    const { service, api } = setup();
    await expect(service.refreshTrips()).resolves.toEqual([{ tripId, name: trip.name, destination: trip.destination, startsOn: trip.start_date, endsOn: trip.end_date, status: 'planned' }]);
    expect(api.listTrips).toHaveBeenCalledTimes(1);
  });
  it('preserves gear.category as intentionally free text, including backend-defined labels', async () => {
    const { service, api, repository } = setup();
    api.getPackingSnapshot.mockResolvedValueOnce({ ...snapshot, packing: [{ ...snapshot.packing[0], gear: { ...snapshot.packing[0].gear, category: 'Locally defined / seasonal' } }] });
    await service.downloadTrip(tripId);
    expect(repository.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ packing: [{ entryId, label: 'Synthetic stove', quantity: 1, packed: false, version: 3 }] }));
  });

  it('rejects a non-text gear.category before writing a downloaded snapshot', async () => {
    const { service, api, repository } = setup();
    api.getPackingSnapshot.mockResolvedValueOnce({ ...snapshot, packing: [{ ...snapshot.packing[0], gear: { ...snapshot.packing[0].gear, category: null } }] });
    await expect(service.downloadTrip(tripId)).rejects.toThrow(/packing snapshot row/i);
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('marks a trip downloaded only after the complete server snapshot is persisted', async () => {
    const { service, api, repository } = setup();
    await expect(service.downloadTrip(tripId)).resolves.toEqual(stored);
    expect(api.getPackingSnapshot).toHaveBeenCalledWith(tripId);
    expect(repository.saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ tripId, packing: [{ entryId, label: 'Synthetic stove', quantity: 1, packed: false, version: 3 }] }));
  });
  it('leaves no offline-ready marker if fetching or atomic persistence fails', async () => {
    const { service, api, repository } = setup();
    api.getPackingSnapshot.mockRejectedValueOnce(new Error('offline'));
    await expect(service.downloadTrip(tripId)).rejects.toThrow('offline');
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
    repository.saveSnapshot.mockRejectedValueOnce(new Error('disk full'));
    await expect(service.downloadTrip(tripId)).rejects.toThrow('disk full');
  });
  it('refuses malformed snapshots before writing an offline-ready marker', async () => {
    const { service, api, repository } = setup();
    api.getPackingSnapshot.mockResolvedValueOnce({ ...snapshot, packing: [{ ...snapshot.packing[0], id: 0 }] });
    await expect(service.downloadTrip(tripId)).rejects.toThrow(/packing snapshot row/i);
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });

  it('serves downloaded snapshots without calling online trip listing', async () => {
    const { service, api, repository } = setup();
    repository.getSnapshot.mockResolvedValue(stored);
    await expect(service.getPackingSnapshot(tripId)).resolves.toEqual(stored);
    expect(api.listTrips).not.toHaveBeenCalled();
    expect(api.getPackingSnapshot).not.toHaveBeenCalled();
  });
  it('rejects downloads of a trip not present in the authorized online list', async () => {
    const { service, api, repository } = setup();
    await expect(service.downloadTrip('33333333-3333-4333-8333-333333333333')).rejects.toThrow(/not available/i);
    expect(api.getPackingSnapshot).not.toHaveBeenCalled();
    expect(repository.saveSnapshot).not.toHaveBeenCalled();
  });
  it('rejects statuses outside the backend vocabulary', async () => {
    const { service, api } = setup();
    api.listTrips.mockResolvedValueOnce([{ ...trip, status: 'archived' }]);
    await expect(service.refreshTrips()).rejects.toThrow(/trip status/i);
  });
});

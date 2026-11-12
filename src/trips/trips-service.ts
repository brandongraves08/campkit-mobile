import { ApiClient } from '../api/http';
import { AccountVault } from '../storage/account-vault';
import { TripSnapshot, TripSnapshotSummary, TripsRepository } from '../storage/trips-repository';
import { OperationsRepository } from '../storage/operations-repository';
import { SyncEngine } from '../sync/sync-engine';
import { ConflictResolution } from '../sync/operation-types';

export const TRIP_STATUSES = ['planned', 'confirmed', 'completed', 'cancelled'] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];
export interface TripSummary {
  tripId: string; name: string; destination: string | null; startsOn: string | null; endsOn: string | null; status: TripStatus;
}
/** Backend-defined classification label; intentionally free text (not a mobile-owned enum). */
export type GearCategory = string;
export interface PackingSnapshotResponse {
  trip: { id: string; name: string };
  packing: { id: number; packed: boolean; quantity: number; version: number; gear: { id: string; name: string; category: GearCategory } }[];
}
interface TripsApi {
  listTrips(): Promise<unknown[]>;
  getPackingSnapshot(tripId: string): Promise<PackingSnapshotResponse>;
}
interface TripsRepositoryContract extends Pick<TripsRepository, 'saveSnapshot' | 'listSnapshots' | 'getSnapshot' | 'setPacked' | 'updatePacking'> {}
interface TripsServiceOptions {
  api: Pick<TripsApi, 'listTrips' | 'getPackingSnapshot'> & Pick<ApiClient, 'setPackedState'>;
  householdId: () => Promise<string | null>;
  repository: (householdId: string) => Promise<TripsRepositoryContract>;
  operations: (householdId: string) => Promise<OperationsRepository>;
  memberId: string;
  now?: () => Date;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid trip response');
  return value as Record<string, unknown>;
}
function nullableText(value: unknown, name: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error(`Invalid ${name} in trip response`);
  return value;
}
function tripStatus(value: unknown): TripStatus {
  if (!TRIP_STATUSES.includes(value as TripStatus)) throw new Error('Invalid trip status in trip response');
  return value as TripStatus;
}
function parseTrip(value: unknown): TripSummary {
  const trip = record(value);
  if (typeof trip.id !== 'string' || !UUID.test(trip.id) || typeof trip.name !== 'string' || !trip.name.trim()) throw new Error('Invalid trip response');
  return { tripId: trip.id, name: trip.name, destination: nullableText(trip.destination, 'destination'), startsOn: nullableText(trip.start_date, 'start date'), endsOn: nullableText(trip.end_date, 'end date'), status: tripStatus(trip.status) };
}
function parseSnapshot(value: unknown, summary: TripSummary, snapshotAt: string) {
  const body = record(value);
  const header = record(body.trip);
  if (header.id !== summary.tripId || header.name !== summary.name || !Array.isArray(body.packing)) throw new Error('Invalid packing snapshot');
  const packing = body.packing.map((value) => {
    const row = record(value); const gear = record(row.gear);
    if (typeof row.id !== 'number' || !Number.isSafeInteger(row.id) || row.id <= 0 || typeof row.packed !== 'boolean' || typeof row.quantity !== 'number' || !Number.isInteger(row.quantity) || row.quantity <= 0 || typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1 || typeof gear.name !== 'string' || typeof gear.category !== 'string') throw new Error('Invalid packing snapshot row');
    return { entryId: String(row.id), label: gear.name, quantity: row.quantity, packed: row.packed, version: row.version };
  });
  return { tripId: summary.tripId, name: summary.name, destination: summary.destination, startsOn: summary.startsOn ?? 'Date not set', endsOn: summary.endsOn ?? 'Date not set', snapshotAt, version: packing.reduce((max, row) => Math.max(max, row.version), 0), packing };
}

/** Coordinates online trip reads with atomically persisted offline snapshots. */
export class TripsService {
  constructor(private readonly options: TripsServiceOptions) {}
  private async getHouseholdId() {
    const householdId = await this.options.householdId();
    if (!householdId) throw new Error('Select a household before opening trips');
    return householdId;
  }
  private async getRepository() { return this.options.repository(await this.getHouseholdId()); }
  private async getSyncEngine() {
    const householdId = await this.getHouseholdId();
    const operations = await this.options.operations(householdId);
    const trips = await this.options.repository(householdId);
    return new SyncEngine({ memberId: this.options.memberId, householdId, operations, trips, transport: (op) => this.options.api.setPackedState(op.tripId, op.entryId, { packed: op.packed, baseVersion: op.baseVersion, clientOperationId: op.id }) });
  }
  async refreshTrips(): Promise<TripSummary[]> {
    const rows = await this.options.api.listTrips();
    if (!Array.isArray(rows)) throw new Error('Invalid trip list response');
    return rows.map(parseTrip);
  }
  async downloadTrip(tripId: string): Promise<TripSnapshot> {
    if (!UUID.test(tripId)) throw new Error('Invalid trip ID');
    const [trips, repository] = await Promise.all([this.refreshTrips(), this.getRepository()]);
    const trip = trips.find((item) => item.tripId === tripId);
    if (!trip) throw new Error('Trip is not available in the authorized online list');
    const data = await this.options.api.getPackingSnapshot(tripId);
    const timestamp = (this.options.now ?? (() => new Date()))().toISOString();
    const input = parseSnapshot(data, trip, timestamp);
    return repository.saveSnapshot(input);
  }
  async getDownloadedTrips() { return (await this.getRepository()).listSnapshots(); }
  async getPackingSnapshot(tripId: string) { return (await this.getRepository()).getSnapshot(tripId); }
  async setPacked(tripId: string, entryId: string, packed: boolean) {
    if (typeof packed !== 'boolean') throw new Error('Packed state must be boolean');
    return (await this.getSyncEngine()).setPackedState(tripId, entryId, packed);
  }
  async syncPendingOperations() { return (await this.getSyncEngine()).syncPendingOperations(); }
  async listOperations() { return (await this.options.operations(await this.getHouseholdId())).list(); }
  async resolveConflict(operationId: string, resolution: ConflictResolution) { return (await this.getSyncEngine()).resolveConflict(operationId, resolution); }
  async discardOperation(operationId: string) {
    const operation = await (await this.options.operations(await this.getHouseholdId())).get(operationId);
    if (!operation || operation.memberId !== this.options.memberId) throw new Error('Operation is not available in this account');
    if (operation.status !== 'needs_attention') throw new Error('Only operations needing attention can be discarded');
    await (await this.options.operations(await this.getHouseholdId())).remove(operationId);
  }
}

const vault = new AccountVault();
export function createTripsService(api: ApiClient, memberId: string, householdId: () => Promise<string | null>): TripsService {
  return new TripsService({ api, memberId, householdId, repository: async (household) => (await vault.openAccount(memberId, household)).trips, operations: async (household) => (await vault.openAccount(memberId, household)).operations });
}
export async function clearTripsForSignOut(memberId: string) { await vault.clearAccount(memberId); }

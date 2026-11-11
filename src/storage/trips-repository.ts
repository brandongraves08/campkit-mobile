import { assertUuid, CampKitDatabase } from './database';

export interface PackingRowSnapshot {
  entryId: string;
  label: string;
  quantity: number | null;
  packed: boolean;
  version: number;
}

export interface TripSnapshotInput {
  tripId: string;
  name: string;
  destination?: string | null;
  startsOn: string;
  endsOn: string;
  snapshotAt: string;
  version: number;
  packing: PackingRowSnapshot[];
}

export interface TripSnapshot extends TripSnapshotInput {
  downloadedAt: string;
}

export interface TripSnapshotSummary {
  tripId: string;
  name: string;
  destination: string | null;
  startsOn: string;
  endsOn: string;
  snapshotAt: string;
  downloadedAt: string;
  version: number;
}

interface TripRow {
  trip_id: string;
  name: string;
  destination: string | null;
  starts_on: string;
  ends_on: string;
  snapshot_at: string;
  downloaded_at: string;
  version: number;
}

interface PackingRow {
  entry_id: string;
  label: string;
  quantity: number | null;
  packed: number;
  version: number;
}

function assertText(value: unknown, label: string, maxLength = 200): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new Error(`Invalid ${label} for stored trip`);
  }
  return value;
}

function assertVersion(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid ${label} version for stored trip`);
  }
  return value;
}

function assertPacked(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('Invalid packed state for stored trip');
  return value;
}

function assertQuantity(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new Error('Invalid quantity for stored packing row');
  }
  return value;
}

function assertPackingRow(row: PackingRowSnapshot): PackingRowSnapshot {
  assertUuid(row.entryId, 'packing entry');
  return {
    entryId: row.entryId,
    label: assertText(row.label, 'label'),
    quantity: assertQuantity(row.quantity),
    packed: assertPacked(row.packed),
    version: assertVersion(row.version, 'packing row'),
  };
}

function assertSnapshot(input: TripSnapshotInput): TripSnapshotInput {
  assertUuid(input.tripId, 'trip');
  if (!Array.isArray(input.packing)) throw new Error('Invalid packing rows for stored trip');
  return {
    tripId: input.tripId,
    name: assertText(input.name, 'name'),
    destination: input.destination === null || input.destination === undefined
      ? null
      : assertText(input.destination, 'destination'),
    startsOn: assertText(input.startsOn, 'start date', 40),
    endsOn: assertText(input.endsOn, 'end date', 40),
    snapshotAt: assertText(input.snapshotAt, 'snapshot time', 40),
    version: assertVersion(input.version, 'trip'),
    packing: input.packing.map(assertPackingRow),
  };
}

function toSnapshot(trip: TripRow, packing: PackingRow[]): TripSnapshot {
  return {
    tripId: trip.trip_id,
    name: trip.name,
    destination: trip.destination,
    startsOn: trip.starts_on,
    endsOn: trip.ends_on,
    snapshotAt: trip.snapshot_at,
    version: trip.version,
    downloadedAt: trip.downloaded_at,
    packing: packing.map((row) => ({
      entryId: row.entry_id,
      label: row.label,
      quantity: row.quantity,
      packed: row.packed === 1,
      version: row.version,
    })),
  };
}

const TRIP_COLUMNS = 'trip_id, name, destination, starts_on, ends_on, snapshot_at, downloaded_at, version';

/** Stores downloaded trip snapshots for one member + household scope. */
export class TripsRepository {
  constructor(private readonly database: CampKitDatabase) {}

  /** Replaces the whole snapshot atomically so a failed sync never leaves half a trip. */
  async saveSnapshot(input: TripSnapshotInput): Promise<TripSnapshot> {
    const snapshot = assertSnapshot(input);
    const downloadedAt = new Date().toISOString();
    const { memberId, householdId } = this.database;

    await this.database.transaction(async (statement) => {
      await statement.run(
        `INSERT INTO trips (trip_id, member_id, household_id, name, destination, starts_on, ends_on, snapshot_at, version, downloaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (member_id, household_id, trip_id) DO UPDATE SET
           name = excluded.name,
           destination = excluded.destination,
           starts_on = excluded.starts_on,
           ends_on = excluded.ends_on,
           snapshot_at = excluded.snapshot_at,
           version = excluded.version,
           downloaded_at = excluded.downloaded_at`,
        [snapshot.tripId, memberId, householdId, snapshot.name, snapshot.destination ?? null,
          snapshot.startsOn, snapshot.endsOn, snapshot.snapshotAt, snapshot.version, downloadedAt],
      );
      await statement.run(
        'DELETE FROM packing_entries WHERE member_id = ? AND household_id = ? AND trip_id = ?',
        [memberId, householdId, snapshot.tripId],
      );
      for (const [position, row] of snapshot.packing.entries()) {
        await statement.run(
          `INSERT INTO packing_entries (member_id, household_id, trip_id, entry_id, position, label, quantity, packed, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [memberId, householdId, snapshot.tripId, row.entryId, position, row.label, row.quantity,
            row.packed ? 1 : 0, row.version],
        );
      }
    });

    return { ...snapshot, destination: snapshot.destination ?? null, downloadedAt };
  }

  async getSnapshot(tripId: string): Promise<TripSnapshot | null> {
    assertUuid(tripId, 'trip');
    const { memberId, householdId } = this.database;
    const trip = await this.database.getFirst<TripRow>(
      `SELECT ${TRIP_COLUMNS} FROM trips WHERE member_id = ? AND household_id = ? AND trip_id = ?`,
      [memberId, householdId, tripId],
    );
    if (!trip) return null;
    const packing = await this.database.getAll<PackingRow>(
      `SELECT entry_id, label, quantity, packed, version FROM packing_entries
       WHERE member_id = ? AND household_id = ? AND trip_id = ? ORDER BY position`,
      [memberId, householdId, tripId],
    );
    return toSnapshot(trip, packing);
  }

  async listSnapshots(): Promise<TripSnapshotSummary[]> {
    const { memberId, householdId } = this.database;
    const trips = await this.database.getAll<TripRow>(
      `SELECT ${TRIP_COLUMNS} FROM trips WHERE member_id = ? AND household_id = ?
       ORDER BY downloaded_at DESC, trip_id`,
      [memberId, householdId],
    );
    return trips.map((trip) => ({
      tripId: trip.trip_id,
      name: trip.name,
      destination: trip.destination,
      startsOn: trip.starts_on,
      endsOn: trip.ends_on,
      snapshotAt: trip.snapshot_at,
      downloadedAt: trip.downloaded_at,
      version: trip.version,
    }));
  }

  async deleteSnapshot(tripId: string): Promise<boolean> {
    assertUuid(tripId, 'trip');
    const { memberId, householdId } = this.database;
    let removed = false;
    await this.database.transaction(async (statement) => {
      await statement.run(
        'DELETE FROM packing_entries WHERE member_id = ? AND household_id = ? AND trip_id = ?',
        [memberId, householdId, tripId],
      );
      const result = await statement.run(
        'DELETE FROM trips WHERE member_id = ? AND household_id = ? AND trip_id = ?',
        [memberId, householdId, tripId],
      );
      removed = result.changes > 0;
    });
    return removed;
  }
}

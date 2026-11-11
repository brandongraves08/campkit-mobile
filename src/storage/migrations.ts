/**
 * Versioned schema for a single member's encrypted CampKit database.
 *
 * Every table carries `member_id` and `household_id` so a query can never cross
 * an account or household boundary, even though one file holds all households
 * a member has opened on this device.
 */
export const SCHEMA_VERSION = 1;

export interface MigrationTarget {
  execute(sql: string): Promise<void>;
  getFirst<T>(sql: string): Promise<T | null>;
}

const INITIAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS trips (
  trip_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  name TEXT NOT NULL,
  destination TEXT,
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  snapshot_at TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 0),
  downloaded_at TEXT NOT NULL,
  PRIMARY KEY (member_id, household_id, trip_id)
);
CREATE TABLE IF NOT EXISTS packing_entries (
  member_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT NOT NULL,
  quantity INTEGER CHECK (quantity IS NULL OR quantity > 0),
  packed INTEGER NOT NULL CHECK (packed IN (0, 1)),
  version INTEGER NOT NULL CHECK (version >= 0),
  PRIMARY KEY (member_id, household_id, trip_id, entry_id)
);
CREATE TABLE IF NOT EXISTS operations (
  id TEXT NOT NULL PRIMARY KEY,
  member_id TEXT NOT NULL,
  household_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  packed INTEGER NOT NULL CHECK (packed IN (0, 1)),
  base_version INTEGER NOT NULL CHECK (base_version >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'conflict', 'needs_attention')),
  created_at TEXT NOT NULL,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS operations_scope_status
  ON operations (member_id, household_id, status, created_at);
CREATE INDEX IF NOT EXISTS packing_entries_scope_trip
  ON packing_entries (member_id, household_id, trip_id, position);
`;

export const MIGRATIONS: readonly { version: number; sql: string }[] = [
  { version: 1, sql: INITIAL_SCHEMA },
];

function readVersion(value: unknown): number {
  const version = value as { user_version?: unknown } | null;
  const raw = version?.user_version ?? 0;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
    throw new Error('Account database has an invalid schema version');
  }
  return raw;
}

/**
 * Applies pending migrations in order. Fails closed instead of touching a
 * database written by a newer build, which could destroy data the app cannot read.
 */
export async function migrateDatabase(target: MigrationTarget): Promise<void> {
  const current = readVersion(await target.getFirst<{ user_version: number }>('PRAGMA user_version'));
  if (current > SCHEMA_VERSION) {
    throw new Error(`Account database schema version ${current} is newer than this app supports (${SCHEMA_VERSION})`);
  }
  for (const migration of MIGRATIONS) {
    if (migration.version <= current) continue;
    await target.execute(migration.sql);
    // PRAGMA values cannot be bound; versions come from this module's constants.
    await target.execute(`PRAGMA user_version = ${migration.version}`);
  }
}

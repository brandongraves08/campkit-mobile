import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
}));
jest.mock('expo-crypto', () => {
  let calls = 0;
  return {
    getRandomValues: jest.fn((target: Uint8Array) => {
      calls += 1;
      for (let index = 0; index < target.length; index += 1) {
        target[index] = (calls * 97 + index * 13) % 256;
      }
      return target;
    }),
  };
});

declare const require: (name: string) => any;
declare const __dirname: string;

import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { TestSqliteDatabase } from './sqlite-test-harness';
import { SCHEMA_VERSION } from '../migrations';
import { clearAccountDatabase, openAccountDatabase, StorageValue } from '../database';
import { TripsRepository } from '../trips-repository';
import { OperationsRepository } from '../operations-repository';
import { AccountVault } from '../account-vault';

const fs = require('fs');
const os = require('os');
const path = require('path');

const MEMBER_A = 'account-abc123';
const MEMBER_B = 'account-def456';
const HOUSEHOLD_A = '11111111-1111-4111-8111-111111111111';
const HOUSEHOLD_B = '22222222-2222-4222-8222-222222222222';
const TRIP = '33333333-3333-4333-8333-333333333333';
const TRIP_B = '33333333-3333-4333-8333-333333333334';
const ENTRY_1 = '44444444-4444-4444-8444-444444444441';
const ENTRY_2 = '44444444-4444-4444-8444-444444444442';
const OPERATION = '55555555-5555-4555-8555-555555555555';
const OPERATION_B = '55555555-5555-4555-8555-555555555556';

const secure = SecureStore as unknown as {
  getItemAsync: jest.Mock<(key: string) => Promise<string | null>>;
  setItemAsync: jest.Mock<(key: string, value: string) => Promise<void>>;
  deleteItemAsync: jest.Mock<(key: string) => Promise<void>>;
};
const sqlite = SQLite as unknown as {
  openDatabaseAsync: jest.Mock<(name: string) => Promise<unknown>>;
  deleteDatabaseAsync: jest.Mock<(name: string) => Promise<void>>;
};

let directory: string;
let secureValues: Map<string, string>;
let handles: TestSqliteDatabase[];

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    tripId: TRIP,
    name: 'Synthetic Boundary Waters Trip',
    destination: 'Synthetic Lake',
    startsOn: '2026-06-01',
    endsOn: '2026-06-04',
    snapshotAt: '2026-05-20T12:00:00.000Z',
    version: 1,
    packing: [
      { entryId: ENTRY_1, label: 'Tent', quantity: 1, packed: false, version: 3 },
      { entryId: ENTRY_2, label: 'Stove', quantity: 1, packed: true, version: 2 },
    ],
    ...overrides,
  };
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: OPERATION,
    tripId: TRIP,
    entryId: ENTRY_1,
    packed: true,
    baseVersion: 3,
    ...overrides,
  };
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campkit-storage-'));
  secureValues = new Map();
  handles = [];
  secure.getItemAsync.mockImplementation(async (key: string) => secureValues.get(key) ?? null);
  secure.setItemAsync.mockImplementation(async (key: string, value: string) => { secureValues.set(key, value); });
  secure.deleteItemAsync.mockImplementation(async (key: string) => { secureValues.delete(key); });
  sqlite.openDatabaseAsync.mockReset();
  sqlite.openDatabaseAsync.mockImplementation(async (name: string) => {
    const handle = new TestSqliteDatabase(path.join(directory, name), { cipherVersion: '4.17.0 community' });
    handles.push(handle);
    return handle;
  });
  sqlite.deleteDatabaseAsync.mockReset();
  sqlite.deleteDatabaseAsync.mockImplementation(async (name: string) => {
    fs.rmSync(path.join(directory, name), { force: true });
  });
});

afterEach(async () => {
  for (const handle of handles) await handle.closeAsync().catch(() => undefined);
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('trip snapshots', () => {
  it('persists a downloaded snapshot with its packing rows', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const trips = new TripsRepository(database);

    await trips.saveSnapshot(snapshot());
    const stored = await trips.getSnapshot(TRIP);

    expect(stored).toMatchObject({
      tripId: TRIP,
      name: 'Synthetic Boundary Waters Trip',
      destination: 'Synthetic Lake',
      startsOn: '2026-06-01',
      endsOn: '2026-06-04',
      snapshotAt: '2026-05-20T12:00:00.000Z',
      version: 1,
    });
    expect(stored?.downloadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored?.packing).toEqual([
      { entryId: ENTRY_1, label: 'Tent', quantity: 1, packed: false, version: 3 },
      { entryId: ENTRY_2, label: 'Stove', quantity: 1, packed: true, version: 2 },
    ]);
    expect(await trips.listSnapshots()).toEqual([
      expect.objectContaining({ tripId: TRIP, name: 'Synthetic Boundary Waters Trip', version: 1 }),
    ]);
  });

  it('persists backend integer packing IDs and edits only rows in a downloaded trip', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const trips = new TripsRepository(database);
    await trips.saveSnapshot(snapshot({ packing: [{ entryId: '12', label: 'Synthetic stove', quantity: 1, packed: false, version: 3 }] }));
    await expect(trips.setPacked(TRIP, '12', true)).resolves.toBeUndefined();
    expect((await trips.getSnapshot(TRIP))?.packing).toEqual([{ entryId: '12', label: 'Synthetic stove', quantity: 1, packed: true, version: 3 }]);
    await expect(trips.updatePacking(TRIP, '12', false, 4)).resolves.toBeUndefined();
    expect((await trips.getSnapshot(TRIP))?.packing[0]).toMatchObject({ packed: false, version: 4 });
    await expect(trips.updatePacking(TRIP, '12', true, 0)).rejects.toThrow(/version/i);
    await expect(trips.setPacked(TRIP_B, '12', false)).rejects.toThrow(/downloaded trip/i);
    await expect(trips.setPacked(TRIP, '0', false)).rejects.toThrow(/entry/i);
  });

  it('replaces a snapshot atomically and drops packing rows that no longer exist', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const trips = new TripsRepository(database);
    await trips.saveSnapshot(snapshot());

    await trips.saveSnapshot(snapshot({
      version: 2,
      packing: [{ entryId: ENTRY_2, label: 'Stove', quantity: 1, packed: false, version: 4 }],
    }));
    const stored = await trips.getSnapshot(TRIP);

    expect(stored?.version).toBe(2);
    expect(stored?.packing).toEqual([{ entryId: ENTRY_2, label: 'Stove', quantity: 1, packed: false, version: 4 }]);
  });

  it('keeps the previous snapshot intact when a replacement fails mid-transaction', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const trips = new TripsRepository(database);
    await trips.saveSnapshot(snapshot());

    // A duplicate entry id passes input validation but violates the primary key
    // after the stale rows have already been deleted inside the transaction.
    await expect(trips.saveSnapshot(snapshot({
      version: 9,
      packing: [
        { entryId: ENTRY_1, label: 'Tent', quantity: 1, packed: false, version: 9 },
        { entryId: ENTRY_1, label: 'Duplicate Tent', quantity: 1, packed: true, version: 9 },
      ],
    }))).rejects.toThrow(/constraint|CHECK/i);

    const stored = await trips.getSnapshot(TRIP);
    expect(stored?.version).toBe(1);
    expect(stored?.packing).toHaveLength(2);
  });

  it('never returns another household or member snapshot', async () => {
    const aHouseholdA = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const aHouseholdB = await openAccountDatabase(MEMBER_A, HOUSEHOLD_B);
    const bHouseholdA = await openAccountDatabase(MEMBER_B, HOUSEHOLD_A);
    await new TripsRepository(aHouseholdA).saveSnapshot(snapshot());

    expect(await new TripsRepository(aHouseholdB).getSnapshot(TRIP)).toBeNull();
    expect(await new TripsRepository(aHouseholdB).listSnapshots()).toEqual([]);
    expect(await new TripsRepository(bHouseholdA).getSnapshot(TRIP)).toBeNull();
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith(`campkit-${MEMBER_A}.db`);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith(`campkit-${MEMBER_B}.db`);

    const rows = await aHouseholdA.getAll<{ member_id: string; household_id: string }>('SELECT member_id, household_id FROM trips');
    expect(rows).toEqual([{ member_id: MEMBER_A, household_id: HOUSEHOLD_A }]);
  });

  it('applies migrations once and keeps snapshots across a cold reopen', async () => {
    const first = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    await new TripsRepository(first).saveSnapshot(snapshot());
    expect(await first.getFirst<{ user_version: number }>('PRAGMA user_version')).toEqual({ user_version: SCHEMA_VERSION });
    await first.close();

    const reopened = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    expect((await reopened.getFirst<{ user_version: number }>('PRAGMA user_version'))?.user_version).toBe(SCHEMA_VERSION);
    expect((await new TripsRepository(reopened).getSnapshot(TRIP))?.name).toBe('Synthetic Boundary Waters Trip');
  });
});

describe('pending operations', () => {
  it('retains a pending operation across a process restart', async () => {
    const first = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    await new OperationsRepository(first).enqueue(operation());
    await first.close();

    const reopened = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const pending = await new OperationsRepository(reopened).list();

    expect(pending).toEqual([
      {
        id: OPERATION,
        memberId: MEMBER_A,
        householdId: HOUSEHOLD_A,
        tripId: TRIP,
        entryId: ENTRY_1,
        packed: true,
        baseVersion: 3,
        status: 'pending',
        createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        errorCode: null,
      },
    ]);
  });

  it('scopes queued operations to the member and household that created them', async () => {
    const aHouseholdA = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const aHouseholdB = await openAccountDatabase(MEMBER_A, HOUSEHOLD_B);
    const bHouseholdA = await openAccountDatabase(MEMBER_B, HOUSEHOLD_A);
    await new OperationsRepository(aHouseholdA).enqueue(operation());

    expect(await new OperationsRepository(aHouseholdB).list()).toEqual([]);
    expect(await new OperationsRepository(bHouseholdA).list()).toEqual([]);
    expect(await new OperationsRepository(aHouseholdB).get(OPERATION)).toBeNull();
    expect(await new OperationsRepository(aHouseholdA).get(OPERATION)).toMatchObject({ id: OPERATION, memberId: MEMBER_A });
  });

  it('ignores caller-supplied scope fields', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const operations = new OperationsRepository(database);

    await operations.enqueue(operation({ memberId: MEMBER_B, householdId: HOUSEHOLD_B }) as never);

    const rows = await database.getAll<{ member_id: string; household_id: string }>('SELECT member_id, household_id FROM operations');
    expect(rows).toEqual([{ member_id: MEMBER_A, household_id: HOUSEHOLD_A }]);
  });

  it('enforces the operation status vocabulary on writes and reads', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const operations = new OperationsRepository(database);
    await operations.enqueue(operation());

    await expect(operations.updateStatus(OPERATION, 'sent' as never)).rejects.toThrow(/status/i);
    await expect(operations.updateStatus(OPERATION, 'needs_attention', 'unknown_backend_code' as never)).rejects.toThrow(/error code/i);
    expect(await operations.get(OPERATION)).toMatchObject({ status: 'pending' });

    await operations.updateStatus(OPERATION, 'conflict');
    expect(await operations.get(OPERATION)).toMatchObject({ status: 'conflict', errorCode: null });
    expect(await operations.list('pending')).toEqual([]);

    await expect(database.run(
      `INSERT INTO operations (id, member_id, household_id, trip_id, entry_id, packed, base_version, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [OPERATION_B, MEMBER_A, HOUSEHOLD_A, TRIP, ENTRY_2, 1, 1, 'archived', '2026-05-20T12:00:00.000Z'],
    )).rejects.toThrow(/constraint|CHECK/i);
  });

  it('rejects invalid identifiers and out-of-contract operation values', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const operations = new OperationsRepository(database);
    const trips = new TripsRepository(database);

    await expect(operations.enqueue(operation({ id: 'not-a-uuid' }))).rejects.toThrow(/operation/i);
    await expect(operations.enqueue(operation({ tripId: 'x OR 1=1' }))).rejects.toThrow(/trip/i);
    await expect(operations.enqueue(operation({ entryId: 'not-a-uuid' }))).rejects.toThrow(/entry/i);
    await expect(operations.enqueue(operation({ baseVersion: -1 }))).rejects.toThrow(/version/i);
    await expect(operations.enqueue(operation({ baseVersion: 1.5 }))).rejects.toThrow(/version/i);
    await expect(operations.enqueue(operation({ packed: 'yes' }))).rejects.toThrow(/packed/i);
    await expect(trips.saveSnapshot(snapshot({ tripId: 'x OR 1=1' }))).rejects.toThrow(/trip/i);
    await expect(trips.saveSnapshot(snapshot({ name: '' }))).rejects.toThrow(/name/i);
    await expect(trips.saveSnapshot(snapshot({ version: -2 }))).rejects.toThrow(/version/i);
    await expect(trips.saveSnapshot(snapshot({
      packing: [{ entryId: 'not-a-uuid', label: 'Tent', quantity: 1, packed: false, version: 1 }],
    }))).rejects.toThrow(/entry/i);

    expect(await operations.list()).toEqual([]);
    expect(await trips.listSnapshots()).toEqual([]);
  });

  it('refuses repository access after the account database is closed', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const trips = new TripsRepository(database);
    const operations = new OperationsRepository(database);
    await database.close();

    await expect(trips.listSnapshots()).rejects.toThrow(/closed/i);
    await expect(operations.list()).rejects.toThrow(/closed/i);
  });
});

describe('account vault', () => {
  it('clears account data, file and key so a later open starts empty', async () => {
    const vault = new AccountVault();
    const workspace = await vault.openAccount(MEMBER_A, HOUSEHOLD_A);
    await workspace.trips.saveSnapshot(snapshot());
    const databaseName = `campkit-${MEMBER_A}.db`;
    const keyName = `campkit.db-key.v1.${MEMBER_A}`;
    expect(fs.existsSync(path.join(directory, databaseName))).toBe(true);
    expect(secureValues.has(keyName)).toBe(true);

    await vault.clearAccount(MEMBER_A);
    await vault.clearAccount(MEMBER_A);

    expect(fs.existsSync(path.join(directory, databaseName))).toBe(false);
    expect(secureValues.has(keyName)).toBe(false);
    expect(secureValues.has(`campkit.db-state.v1.${MEMBER_A}`)).toBe(false);
    await expect(workspace.trips.listSnapshots()).rejects.toThrow(/closed/i);

    const reopened = await vault.openAccount(MEMBER_A, HOUSEHOLD_A);
    expect(await reopened.trips.listSnapshots()).toEqual([]);
    await vault.closeAll();
  });

  it('closes the previous handle when the selected household changes', async () => {
    const vault = new AccountVault();
    const householdA = await vault.openAccount(MEMBER_A, HOUSEHOLD_A);
    await householdA.trips.saveSnapshot(snapshot());

    const householdB = await vault.openAccount(MEMBER_A, HOUSEHOLD_B);

    await expect(householdA.trips.listSnapshots()).rejects.toThrow(/closed/i);
    expect(await householdB.trips.listSnapshots()).toEqual([]);
    await vault.closeAll();
  });

  it('returns the same workspace for a repeated open of the same scope', async () => {
    const vault = new AccountVault();
    const first = await vault.openAccount(MEMBER_A, HOUSEHOLD_A);
    const second = await vault.openAccount(MEMBER_A, HOUSEHOLD_A);

    expect(second).toBe(first);
    await vault.closeAll();
  });
});

describe('storage isolation guards', () => {
  it('does not write account data or keys outside the encrypted database and SecureStore', () => {
    const storageRoot = path.resolve(__dirname, '../');
    const sources = fs.readdirSync(storageRoot)
      .filter((name: string) => name.endsWith('.ts') && !name.includes('.test.') && name !== 'sqlite-test-harness.ts')
      .map((name: string) => ({ name, source: fs.readFileSync(path.join(storageRoot, name), 'utf8') }));

    for (const { name, source } of sources) {
      expect({ name, importsAuth: /from '\.\.\/auth/.test(source) }).toEqual({ name, importsAuth: false });
      expect({ name, importsAsyncStorage: /AsyncStorage/.test(source) }).toEqual({ name, importsAsyncStorage: false });
    }
  });

  it('keeps trip and operation data scoped by member and household in every statement', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    const queries: string[] = [];
    const original = database.getAll.bind(database);
    database.getAll = (async (sql: string, params?: StorageValue[]) => {
      queries.push(sql);
      return original(sql, params);
    }) as typeof database.getAll;

    const trips = new TripsRepository(database);
    const operations = new OperationsRepository(database);
    await trips.saveSnapshot(snapshot());
    await trips.getSnapshot(TRIP);
    await trips.listSnapshots();
    await operations.enqueue(operation({ id: OPERATION_B }));
    await operations.list();
    await operations.get(OPERATION_B);

    const reads = queries.filter((sql) => /^\s*SELECT/i.test(sql));
    expect(reads.length).toBeGreaterThan(0);
    for (const sql of reads) {
      expect({ sql, scoped: /member_id = \?/.test(sql) && /household_id = \?/.test(sql) }).toEqual({ sql, scoped: true });
    }
  });
});

describe('clearing without a key', () => {
  it('removes an orphaned database file when both SecureStore entries are missing', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    await new TripsRepository(database).saveSnapshot(snapshot());
    await database.close();

    const databasePath = path.join(directory, `campkit-${MEMBER_A}.db`);
    expect(fs.existsSync(databasePath)).toBe(true);
    secureValues.delete(`campkit.db-key.v1.${MEMBER_A}`);
    secureValues.delete(`campkit.db-state.v1.${MEMBER_A}`);

    await clearAccountDatabase(MEMBER_A);
    expect(fs.existsSync(databasePath)).toBe(false);

    await expect(clearAccountDatabase(MEMBER_A)).resolves.toBeUndefined();
    expect(fs.existsSync(databasePath)).toBe(false);
  });

  it('removes the encrypted file even when only the marker survived', async () => {
    const database = await openAccountDatabase(MEMBER_A, HOUSEHOLD_A);
    await new TripsRepository(database).saveSnapshot(snapshot());
    await database.close();
    secureValues.delete(`campkit.db-key.v1.${MEMBER_A}`);

    await clearAccountDatabase(MEMBER_A);

    expect(fs.existsSync(path.join(directory, `campkit-${MEMBER_A}.db`))).toBe(false);
    expect(secureValues.has(`campkit.db-state.v1.${MEMBER_A}`)).toBe(false);
  });
});

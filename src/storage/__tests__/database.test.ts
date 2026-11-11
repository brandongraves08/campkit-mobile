import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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
jest.mock('expo-crypto', () => ({
  getRandomValues: jest.fn((target: Uint8Array) => {
    for (let index = 0; index < target.length; index += 1) target[index] = index;
    return target;
  }),
}));

import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { SCHEMA_VERSION } from '../migrations';
import { clearAccountDatabase, openAccountDatabase } from '../database';

declare const require: (name: string) => any;
declare const __dirname: string;

const MEMBER = 'account-abc123';
const HOUSEHOLD = '11111111-1111-4111-8111-111111111111';
const KEY_NAME = `campkit.db-key.v1.${MEMBER}`;
const MARKER_NAME = `campkit.db-state.v1.${MEMBER}`;
const DATABASE_NAME = `campkit-${MEMBER}.db`;
const VALID_KEY = 'a'.repeat(64);

const secure = SecureStore as unknown as {
  getItemAsync: jest.Mock<(key: string) => Promise<string | null>>;
  setItemAsync: jest.Mock<(key: string, value: string, options?: unknown) => Promise<void>>;
  deleteItemAsync: jest.Mock<(key: string) => Promise<void>>;
};
const sqlite = SQLite as unknown as {
  openDatabaseAsync: jest.Mock<(name: string) => Promise<FakeDatabase>>;
  deleteDatabaseAsync: jest.Mock<(name: string) => Promise<void>>;
};

interface FakeDatabase {
  execAsync: jest.Mock<(sql: string) => Promise<void>>;
  getAllAsync: jest.Mock<(sql: string) => Promise<unknown[]>>;
  getFirstAsync: jest.Mock<(sql: string) => Promise<unknown>>;
  runAsync: jest.Mock<(sql: string, params?: unknown) => Promise<{ changes: number; lastInsertRowId: number }>>;
  withExclusiveTransactionAsync: jest.Mock<(task: (txn: FakeDatabase) => Promise<void>) => Promise<void>>;
  closeAsync: jest.Mock<() => Promise<void>>;
}

function createFakeDatabase(): FakeDatabase {
  const database: FakeDatabase = {
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async (sql: string) => (/cipher_version/i.test(sql) ? [{ cipher_version: '4.17.0 community' }] : [])),
    getFirstAsync: jest.fn(async (sql: string) => {
      if (/sqlite_master/i.test(sql)) return { count: 0 };
      if (/user_version/i.test(sql)) return { user_version: 0 };
      return null;
    }),
    runAsync: jest.fn(async () => ({ changes: 1, lastInsertRowId: 1 })),
    closeAsync: jest.fn(async () => undefined),
    withExclusiveTransactionAsync: jest.fn(async (task: (txn: FakeDatabase) => Promise<void>) => { await task(database); }),
  };
  return database;
}

function createSecureStore(initial: Record<string, string> = {}): Map<string, string> {
  const values = new Map<string, string>(Object.entries(initial));
  secure.getItemAsync.mockImplementation(async (key: string) => values.get(key) ?? null);
  secure.setItemAsync.mockImplementation(async (key: string, value: string) => { values.set(key, value); });
  secure.deleteItemAsync.mockImplementation(async (key: string) => { values.delete(key); });
  return values;
}

let database: FakeDatabase;

beforeEach(() => {
  database = createFakeDatabase();
  sqlite.openDatabaseAsync.mockReset();
  sqlite.openDatabaseAsync.mockResolvedValue(database);
  sqlite.deleteDatabaseAsync.mockReset();
  sqlite.deleteDatabaseAsync.mockResolvedValue(undefined);
});

describe('openAccountDatabase', () => {
  it('enables SQLCipher with the SecureStore key before reading or writing app data', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    await openAccountDatabase(MEMBER, HOUSEHOLD);

    expect(secure.getItemAsync).toHaveBeenCalledWith(KEY_NAME);
    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(database.execAsync.mock.calls[0][0]).toMatch(/^PRAGMA key = "x'[0-9a-f]{64}'"$/);
    expect(database.execAsync.mock.calls[0][0]).toContain(VALID_KEY);
    expect(database.getAllAsync).toHaveBeenCalledWith('PRAGMA cipher_version');
    expect(database.getFirstAsync).toHaveBeenCalledWith(expect.stringMatching(/sqlite_master/i));
    // The key is only persisted for a freshly created account, never rewritten.
    expect(secure.setItemAsync).not.toHaveBeenCalledWith(KEY_NAME, expect.anything(), expect.anything());
    expect(secure.setItemAsync).toHaveBeenCalledWith(MARKER_NAME, HOUSEHOLD, expect.any(Object));
  });

  it('migrates a fresh account database from an empty schema', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    await openAccountDatabase(MEMBER, HOUSEHOLD);

    const schema = database.execAsync.mock.calls.map(([sql]) => sql).join('\n');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS trips');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS packing_entries');
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS operations');
    expect(schema).toContain(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  });

  it('generates and protects a new key for a first-time account', async () => {
    const values = createSecureStore();

    await openAccountDatabase(MEMBER, HOUSEHOLD);

    const written = values.get(KEY_NAME) as string;
    expect(written).toMatch(/^[0-9a-f]{64}$/);
    expect(secure.setItemAsync).toHaveBeenCalledWith(
      KEY_NAME,
      written,
      expect.objectContaining({ keychainAccessible: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY' }),
    );
    expect(database.execAsync.mock.calls[0][0]).toContain(written);
  });

  it('re-applies the SQLCipher key on the exclusive transaction connection', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    const db = await openAccountDatabase(MEMBER, HOUSEHOLD);
    const transactionDatabase = createFakeDatabase();
    database.withExclusiveTransactionAsync.mockImplementationOnce(async (task) => { await task(transactionDatabase); });

    await db.transaction(async (tx: { execute(sql: string): Promise<void> }) => { await tx.execute('DELETE FROM operations'); });

    expect(transactionDatabase.execAsync.mock.calls[0][0]).toMatch(/^PRAGMA key = /);
    expect(transactionDatabase.execAsync.mock.calls[1][0]).toBe('DELETE FROM operations');
  });

  it('refuses to run statements after the account database is closed', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    const db = await openAccountDatabase(MEMBER, HOUSEHOLD);
    await db.close();

    expect(database.closeAsync).toHaveBeenCalled();
    await expect(db.getAll('SELECT trip_id FROM trips')).rejects.toThrow(/closed/i);
    await expect(db.execute('DELETE FROM trips')).rejects.toThrow(/closed/i);
  });

  it('fails closed when the native build has no SQLCipher support', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });
    database.getAllAsync.mockResolvedValue([]);

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/SQLCipher/i);

    expect(database.closeAsync).toHaveBeenCalled();
    expect(database.getFirstAsync).not.toHaveBeenCalled();
    expect(database.execAsync).toHaveBeenCalledTimes(1);
    expect(database.execAsync.mock.calls[0][0]).toMatch(/^PRAGMA key = /);
  });

  it('fails closed when cipher_version is present but empty', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });
    database.getAllAsync.mockResolvedValue([{ cipher_version: '   ' }]);

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/SQLCipher/i);
    expect(database.getFirstAsync).not.toHaveBeenCalled();
  });

  it('refuses to open an existing account database whose SecureStore key is gone', async () => {
    createSecureStore({ [MARKER_NAME]: HOUSEHOLD });

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/key/i);

    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
    expect(secure.setItemAsync).not.toHaveBeenCalledWith(KEY_NAME, expect.anything(), expect.anything());
  });

  it('fails closed and does not persist a fresh key when the existing file cannot be decrypted', async () => {
    const values = createSecureStore();
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (/sqlite_master/i.test(sql)) throw new Error('file is not a database');
      return { user_version: 0 };
    });

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/encrypt|key/i);

    expect(database.closeAsync).toHaveBeenCalled();
    expect(values.has(KEY_NAME)).toBe(false);
    expect(database.execAsync.mock.calls.some(([sql]) => /CREATE TABLE/.test(sql))).toBe(false);
  });

  it('rolls back a fresh account database when migration fails', async () => {
    const values = createSecureStore();
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (/sqlite_master/i.test(sql)) return { count: 0 };
      return { user_version: -1 };
    });

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/schema version/i);

    expect(database.closeAsync).toHaveBeenCalled();
    expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(values.has(KEY_NAME)).toBe(false);
    expect(values.has(MARKER_NAME)).toBe(false);
  });

  it('rejects account scopes that could escape the database directory', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    for (const memberId of ['', '../escape', 'a/b', 'a..b', 'name with space', 'x'.repeat(129)]) {
      await expect(openAccountDatabase(memberId, HOUSEHOLD)).rejects.toThrow(/member/i);
    }
    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('rejects a malformed household scope', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    await expect(openAccountDatabase(MEMBER, 'not-a-household')).rejects.toThrow(/household/i);
    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('rejects a corrupted stored key instead of opening the database', async () => {
    createSecureStore({ [KEY_NAME]: 'not-a-hex-key' });

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/key/i);
    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
  });

  it('refuses to open a database written by a newer schema version', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });
    database.getFirstAsync.mockImplementation(async (sql: string) => {
      if (/sqlite_master/i.test(sql)) return { count: 3 };
      return { user_version: SCHEMA_VERSION + 1 };
    });

    await expect(openAccountDatabase(MEMBER, HOUSEHOLD)).rejects.toThrow(/newer/i);
    expect(database.closeAsync).toHaveBeenCalled();
  });
});

describe('clearAccountDatabase', () => {
  it('clears rows transactionally, removes the encrypted file and deletes the key and marker', async () => {
    const values = createSecureStore({ [KEY_NAME]: VALID_KEY, [MARKER_NAME]: HOUSEHOLD });

    await clearAccountDatabase(MEMBER);

    expect(sqlite.openDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(database.withExclusiveTransactionAsync).toHaveBeenCalledTimes(1);
    const statements = database.execAsync.mock.calls.map(([sql]) => sql);
    expect(statements).toContain('DELETE FROM packing_entries');
    expect(statements).toContain('DELETE FROM operations');
    expect(statements).toContain('DELETE FROM trips');
    expect(database.closeAsync).toHaveBeenCalled();
    expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(values.has(KEY_NAME)).toBe(false);
    expect(values.has(MARKER_NAME)).toBe(false);
  });

  it('is idempotent when the account has no database, key or marker', async () => {
    const values = createSecureStore();

    await expect(clearAccountDatabase(MEMBER)).resolves.toBeUndefined();
    await expect(clearAccountDatabase(MEMBER)).resolves.toBeUndefined();

    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
    // Deleting a missing database is harmless and keeps orphan cleanup idempotent.
    expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(values.size).toBe(0);
  });

  it('deletes an orphaned encrypted database when both SecureStore entries are missing', async () => {
    createSecureStore();
    // The file may outlive both SecureStore entries, for example after key loss.

    await expect(clearAccountDatabase(MEMBER)).resolves.toBeUndefined();
    await expect(clearAccountDatabase(MEMBER)).resolves.toBeUndefined();

    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
    expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(sqlite.deleteDatabaseAsync).toHaveBeenNthCalledWith(1, DATABASE_NAME);
    expect(sqlite.deleteDatabaseAsync).toHaveBeenNthCalledWith(2, DATABASE_NAME);
  });

  it('fails closed and retains the key when account rows cannot be cleared', async () => {
    const values = createSecureStore({ [KEY_NAME]: VALID_KEY, [MARKER_NAME]: HOUSEHOLD });
    database.withExclusiveTransactionAsync.mockRejectedValueOnce(new Error('disk failure'));

    await expect(clearAccountDatabase(MEMBER)).rejects.toThrow('disk failure');

    expect(sqlite.deleteDatabaseAsync).not.toHaveBeenCalled();
    expect(values.has(KEY_NAME)).toBe(true);
    expect(values.has(MARKER_NAME)).toBe(true);
  });

  it('still removes the encrypted file when only the account marker survived', async () => {
    const values = createSecureStore({ [MARKER_NAME]: HOUSEHOLD });

    await clearAccountDatabase(MEMBER);

    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
    expect(sqlite.deleteDatabaseAsync).toHaveBeenCalledWith(DATABASE_NAME);
    expect(values.has(MARKER_NAME)).toBe(false);
  });

  it('rejects an invalid member id before touching storage', async () => {
    createSecureStore({ [KEY_NAME]: VALID_KEY });

    await expect(clearAccountDatabase('../escape')).rejects.toThrow(/member/i);
    expect(sqlite.openDatabaseAsync).not.toHaveBeenCalled();
    expect(secure.deleteItemAsync).not.toHaveBeenCalled();
  });
});

describe('storage source guards', () => {
  it('never falls back to plaintext, file, or token persistence', () => {
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '../');
    const sources: Array<{ name: string; source: string }> = fs.readdirSync(root)
      .filter((name: string) => name.endsWith('.ts') && !name.includes('.test.'))
      .map((name: string) => ({ name, source: String(fs.readFileSync(path.join(root, name), 'utf8')) }));

    expect(sources.map(({ name }) => name).sort()).toEqual(
      expect.arrayContaining(['database.ts', 'migrations.ts', 'trips-repository.ts', 'operations-repository.ts', 'account-vault.ts']),
    );
    for (const { name, source } of sources) {
      expect({ name, plaintextFallback: /AsyncStorage|expo-file-system|writeAsStringAsync/.test(source) }).toEqual({ name, plaintextFallback: false });
      expect({ name, logs: /console\s*\./.test(source) }).toEqual({ name, logs: false });
      expect({ name, tokens: /accessToken|refreshToken|access_token|refresh_token/.test(source) }).toEqual({ name, tokens: false });
      expect({ name, weakRandom: /Math\.random/.test(source) }).toEqual({ name, weakRandom: false });
    }
  });
});

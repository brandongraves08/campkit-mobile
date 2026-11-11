import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { migrateDatabase } from './migrations';

export type StorageValue = string | number | null;

export interface StorageResult {
  changes: number;
  lastInsertRowId: number;
}

export interface StorageStatement {
  execute(sql: string): Promise<void>;
  run(sql: string, params?: StorageValue[]): Promise<StorageResult>;
  getAll<T>(sql: string, params?: StorageValue[]): Promise<T[]>;
  getFirst<T>(sql: string, params?: StorageValue[]): Promise<T | null>;
}

export interface CampKitDatabase extends StorageStatement {
  readonly memberId: string;
  readonly householdId: string;
  readonly databaseName: string;
  transaction<T>(task: (statement: StorageStatement) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const MEMBER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORED_KEY = /^[0-9a-f]{64}$/;
const SECURE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export function assertMemberId(memberId: string): void {
  if (typeof memberId !== 'string' || !MEMBER_ID.test(memberId) || memberId.includes('..')) {
    throw new Error('Invalid member ID for account storage');
  }
}

export function assertHouseholdId(householdId: string): void {
  if (typeof householdId !== 'string' || !UUID.test(householdId)) {
    throw new Error('Invalid household ID for account storage');
  }
}

export function assertUuid(value: string, label: string): void {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error(`Invalid ${label} ID for account storage`);
  }
}

export function accountDatabaseName(memberId: string): string {
  assertMemberId(memberId);
  return `campkit-${memberId}.db`;
}

function accountKeyName(memberId: string): string {
  return `campkit.db-key.v1.${memberId}`;
}

function accountMarkerName(memberId: string): string {
  return `campkit.db-state.v1.${memberId}`;
}

function keyPragma(key: string): string {
  if (!STORED_KEY.test(key)) throw new Error('Account storage key is corrupted');
  return `PRAGMA key = "x'${key}'"`;
}

/** 256-bit key from the platform CSPRNG, hex encoded for the SQLCipher raw-key form. */
function generateAccountKey(): string {
  const bytes = Crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function statementFor(target: SQLite.SQLiteDatabase): StorageStatement {
  return {
    execute: (sql) => target.execAsync(sql),
    async run(sql, params = []) {
      const result = await target.runAsync(sql, params);
      return { changes: result.changes, lastInsertRowId: result.lastInsertRowId };
    },
    getAll: <T>(sql: string, params: StorageValue[] = []) => target.getAllAsync<T>(sql, params),
    getFirst: <T>(sql: string, params: StorageValue[] = []) => target.getFirstAsync<T>(sql, params),
  };
}

class AccountDatabase implements CampKitDatabase {
  private closed = false;

  constructor(
    private readonly native: SQLite.SQLiteDatabase,
    readonly memberId: string,
    readonly householdId: string,
    readonly databaseName: string,
    private readonly encryptionPragma: string,
  ) {}

  private ensureOpen(): void {
    if (this.closed) throw new Error('Account database is closed');
  }

  async execute(sql: string): Promise<void> {
    this.ensureOpen();
    await this.native.execAsync(sql);
  }

  async run(sql: string, params: StorageValue[] = []): Promise<StorageResult> {
    this.ensureOpen();
    return statementFor(this.native).run(sql, params);
  }

  async getAll<T>(sql: string, params: StorageValue[] = []): Promise<T[]> {
    this.ensureOpen();
    return statementFor(this.native).getAll<T>(sql, params);
  }

  async getFirst<T>(sql: string, params: StorageValue[] = []): Promise<T | null> {
    this.ensureOpen();
    return statementFor(this.native).getFirst<T>(sql, params);
  }

  async transaction<T>(task: (statement: StorageStatement) => Promise<T>): Promise<T> {
    this.ensureOpen();
    let result: T | undefined;
    await this.native.withExclusiveTransactionAsync(async (transaction) => {
      // SQLCipher keys are per connection; the exclusive transaction opens a new one.
      await transaction.execAsync(this.encryptionPragma);
      result = await task(statementFor(transaction));
    });
    return result as T;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.native.closeAsync();
  }
}

/**
 * Opens the member's encrypted database scoped to a household.
 *
 * Fails closed: no key, no SQLCipher, or a key that cannot decrypt the existing
 * file all reject instead of creating a plaintext or replacement database.
 */
export async function openAccountDatabase(memberId: string, householdId: string): Promise<CampKitDatabase> {
  assertMemberId(memberId);
  assertHouseholdId(householdId);

  const databaseName = accountDatabaseName(memberId);
  const storedKey = await SecureStore.getItemAsync(accountKeyName(memberId));
  const marker = await SecureStore.getItemAsync(accountMarkerName(memberId));

  if (storedKey === null && marker !== null) {
    throw new Error('Refusing to open account database: its storage key is missing');
  }
  const createdKey = storedKey === null;
  const key = storedKey ?? generateAccountKey();
  const encryptionPragma = keyPragma(key);

  const native = await SQLite.openDatabaseAsync(databaseName);
  let decryptedNewFile = false;
  try {
    await native.execAsync(encryptionPragma);
    const cipher = await native.getAllAsync<{ cipher_version?: unknown }>('PRAGMA cipher_version');
    const cipherVersion = cipher[0]?.cipher_version;
    if (typeof cipherVersion !== 'string' || cipherVersion.trim().length === 0) {
      throw new Error('Encrypted storage unavailable: SQLCipher is not enabled in this build');
    }
    try {
      await native.getFirstAsync('SELECT count(*) AS table_count FROM sqlite_master');
    } catch {
      throw new Error('Refusing to open account database: the encryption key does not match its contents');
    }
    // A key we just generated belongs to a file we just created (or to a file
    // whose original key is already gone); only the migration can fail from here.
    decryptedNewFile = createdKey;

    // Only persist a generated key after it has been proven to open the file.
    if (createdKey) await SecureStore.setItemAsync(accountKeyName(memberId), key, SECURE_OPTIONS);
    await SecureStore.setItemAsync(accountMarkerName(memberId), householdId, SECURE_OPTIONS);

    const database = new AccountDatabase(native, memberId, householdId, databaseName, encryptionPragma);
    await database.transaction((statement) => migrateDatabase(statement));
    return database;
  } catch (error) {
    await native.closeAsync().catch(() => undefined);
    if (createdKey) {
      // Roll back the whole fresh-account setup so the scope is usable next time
      // instead of holding rows encrypted with a key we are about to discard.
      if (decryptedNewFile) await SQLite.deleteDatabaseAsync(databaseName).catch(() => undefined);
      await SecureStore.deleteItemAsync(accountKeyName(memberId)).catch(() => undefined);
      await SecureStore.deleteItemAsync(accountMarkerName(memberId)).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Removes this member's rows, encrypted file, key and marker.
 *
 * Transactional in the rows, then closes before deleting the file (a cached
 * connection blocks the native delete). Any failure before the file removal
 * throws while keeping the key and marker so a retry can finish the job.
 */
export async function clearAccountDatabase(memberId: string): Promise<void> {
  assertMemberId(memberId);

  const databaseName = accountDatabaseName(memberId);
  const key = await SecureStore.getItemAsync(accountKeyName(memberId));
  const marker = await SecureStore.getItemAsync(accountMarkerName(memberId));
  if (key === null && marker === null) {
    // SecureStore state may be lost while an encrypted database file remains.
    // No key means rows cannot be read safely, but deleting the orphaned file is safe.
    await SQLite.deleteDatabaseAsync(databaseName);
    return;
  }

  if (key !== null && STORED_KEY.test(key)) {
    const encryptionPragma = keyPragma(key);
    const native = await SQLite.openDatabaseAsync(databaseName);
    try {
      await native.execAsync(encryptionPragma);
      await native.withExclusiveTransactionAsync(async (transaction) => {
        await transaction.execAsync(encryptionPragma);
        await transaction.execAsync('DELETE FROM packing_entries');
        await transaction.execAsync('DELETE FROM operations');
        await transaction.execAsync('DELETE FROM trips');
      });
    } finally {
      await native.closeAsync();
    }
  }

  await SQLite.deleteDatabaseAsync(databaseName);
  await SecureStore.deleteItemAsync(accountKeyName(memberId));
  await SecureStore.deleteItemAsync(accountMarkerName(memberId));
}

import * as SQLite from 'expo-sqlite';
import type { LifecycleMarkerStore } from './account-lifecycle';

const DATABASE_NAME = 'campkit-lifecycle-recovery.db';
const TABLE = 'lifecycle_recovery';

/**
 * Durable, non-keychain record of an interrupted account cleanup.
 *
 * The primary marker lives in the platform secure store; if that write fails
 * while a vault cannot be cleared, a restarted process would have no evidence
 * of the unfinished teardown. This store keeps the same barrier in a separate
 * SQLite file so the two mechanisms do not share a single failure mode. It
 * stores only an opaque member identifier (the same value already used in
 * account database file names), never credentials or household data.
 */
export class SqliteRecoveryStore implements LifecycleMarkerStore {
  private database: Promise<SQLite.SQLiteDatabase> | null = null;
  private closed = false;

  private open(): Promise<SQLite.SQLiteDatabase> {
    if (this.closed) return Promise.reject(new Error('Lifecycle recovery store is closed'));
    this.database ??= this.initialize();
    return this.database;
  }

  private async initialize(): Promise<SQLite.SQLiteDatabase> {
    const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await database.execAsync(`CREATE TABLE IF NOT EXISTS ${TABLE} (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`);
    return database;
  }

  async getItemAsync(key: string): Promise<string | null> {
    const database = await this.open();
    const row = await database.getFirstAsync<{ value: string }>(`SELECT value FROM ${TABLE} WHERE key = ?`, [key]);
    return row?.value ?? null;
  }

  async setItemAsync(key: string, value: string): Promise<void> {
    const database = await this.open();
    await database.runAsync(`INSERT INTO ${TABLE} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  }

  async deleteItemAsync(key: string): Promise<void> {
    const database = await this.open();
    await database.runAsync(`DELETE FROM ${TABLE} WHERE key = ?`, [key]);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.database) return;
    const database = await this.database.catch(() => null);
    await database?.closeAsync();
  }
}

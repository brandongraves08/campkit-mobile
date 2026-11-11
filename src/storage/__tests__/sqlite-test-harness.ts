/**
 * Test-only adapter that maps the small expo-sqlite surface used by the storage
 * layer onto Node's built-in `node:sqlite`. It lets the repository and migration
 * tests run real SQL (isolation, constraints, restart persistence) in Jest.
 *
 * It is NOT a SQLCipher implementation. `PRAGMA cipher_version` is shimmed so
 * the production guard can be exercised, and each connection tracks whether
 * `PRAGMA key` was applied first to model SQLCipher's per-connection keying.
 * Real SQLCipher behavior is verified separately on an Android build.
 */
declare const require: (name: string) => any;

export type HarnessValue = string | number | null;

interface HarnessOptions {
  /** `null` models a build without SQLCipher (no cipher_version row). */
  cipherVersion?: string | null;
}

const KEY_STATEMENT = /^\s*PRAGMA\s+key\s*=/i;
const CIPHER_STATEMENT = /^\s*PRAGMA\s+cipher_version\s*;?\s*$/i;

function bindable(params?: HarnessValue | HarnessValue[]): HarnessValue[] {
  if (params === undefined) return [];
  return Array.isArray(params) ? params : [params];
}

class HarnessConnection {
  protected keyApplied = false;

  constructor(protected readonly handle: any, protected readonly options: HarnessOptions) {}

  protected guard(sql: string): void {
    if (KEY_STATEMENT.test(sql) || CIPHER_STATEMENT.test(sql)) return;
    if (!this.keyApplied) throw new Error('storage harness: statement attempted before PRAGMA key');
  }

  async execAsync(sql: string): Promise<void> {
    this.guard(sql);
    if (KEY_STATEMENT.test(sql)) this.keyApplied = true;
    this.handle.exec(sql);
  }

  async runAsync(sql: string, params?: HarnessValue | HarnessValue[]): Promise<{ changes: number; lastInsertRowId: number }> {
    this.guard(sql);
    const result = this.handle.prepare(sql).run(...bindable(params));
    return { changes: Number(result.changes), lastInsertRowId: Number(result.lastInsertRowid) };
  }

  async getAllAsync<T>(sql: string, params?: HarnessValue | HarnessValue[]): Promise<T[]> {
    if (CIPHER_STATEMENT.test(sql)) {
      const { cipherVersion = '4.17.0 community' } = this.options;
      return (cipherVersion === null ? [] : [{ cipher_version: cipherVersion }]) as T[];
    }
    this.guard(sql);
    return this.handle.prepare(sql).all(...bindable(params)) as T[];
  }

  async getFirstAsync<T>(sql: string, params?: HarnessValue | HarnessValue[]): Promise<T | null> {
    this.guard(sql);
    return (this.handle.prepare(sql).get(...bindable(params)) ?? null) as T | null;
  }
}

class HarnessTransaction extends HarnessConnection {
  constructor(handle: any, options: HarnessOptions) {
    super(handle, options);
  }
}

export class TestSqliteDatabase extends HarnessConnection {
  private closed = false;

  constructor(readonly databasePath: string, options: HarnessOptions = {}) {
    const { DatabaseSync } = require('node:sqlite');
    super(new DatabaseSync(databasePath), options);
  }

  get isClosed(): boolean { return this.closed; }

  async withExclusiveTransactionAsync(task: (txn: HarnessTransaction) => Promise<void>): Promise<void> {
    this.handle.exec('BEGIN IMMEDIATE');
    // A new native connection is opened for an exclusive transaction, so the
    // SQLCipher key has to be re-applied there. The transaction guard enforces it.
    const transaction = new HarnessTransaction(this.handle, this.options);
    try {
      await task(transaction);
      this.handle.exec('COMMIT');
    } catch (error) {
      this.handle.exec('ROLLBACK');
      throw error;
    }
  }

  async closeAsync(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.handle.close();
  }
}

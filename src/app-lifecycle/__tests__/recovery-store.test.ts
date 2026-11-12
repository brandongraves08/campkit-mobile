import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));

declare const require: (name: string) => any;
declare const __dirname: string;

import * as SQLite from 'expo-sqlite';
import { TestSqliteDatabase } from '../../storage/__tests__/sqlite-test-harness';
import { SqliteRecoveryStore } from '../recovery-store';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sqlite = SQLite as unknown as {
  openDatabaseAsync: jest.Mock<(name: string) => Promise<unknown>>;
  deleteDatabaseAsync: jest.Mock<(name: string) => Promise<void>>;
};

let directory: string;
let handles: TestSqliteDatabase[];

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campkit-recovery-'));
  handles = [];
  sqlite.openDatabaseAsync.mockReset();
  sqlite.openDatabaseAsync.mockImplementation(async (name: string) => {
    const handle = new TestSqliteDatabase(path.join(directory, name), { requiresKey: false });
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

describe('sqlite lifecycle recovery store', () => {
  it('persists a barrier record so a freshly opened store still sees it', async () => {
    const first = new SqliteRecoveryStore();
    await first.setItemAsync('campkit.lifecycle.recovery.v1', 'member-synthetic');
    await first.close();

    // A new process opens the same file through a brand-new native handle.
    const restarted = new SqliteRecoveryStore();
    expect(await restarted.getItemAsync('campkit.lifecycle.recovery.v1')).toBe('member-synthetic');
    await restarted.close();
  });

  it('reports a missing key as null and removes a deleted key durably', async () => {
    const first = new SqliteRecoveryStore();
    expect(await first.getItemAsync('campkit.lifecycle.recovery.v1')).toBeNull();
    await first.setItemAsync('campkit.lifecycle.recovery.v1', 'member-synthetic');
    await first.deleteItemAsync('campkit.lifecycle.recovery.v1');
    await first.close();

    const restarted = new SqliteRecoveryStore();
    expect(await restarted.getItemAsync('campkit.lifecycle.recovery.v1')).toBeNull();
    await restarted.close();
  });

  it('overwrites a previous barrier record with the latest member', async () => {
    const store = new SqliteRecoveryStore();
    await store.setItemAsync('campkit.lifecycle.recovery.v1', 'member-old');
    await store.setItemAsync('campkit.lifecycle.recovery.v1', 'member-new');
    expect(await store.getItemAsync('campkit.lifecycle.recovery.v1')).toBe('member-new');
    await store.close();
  });

  it('does not silently drop a write when the storage works', async () => {
    const store = new SqliteRecoveryStore();
    await store.setItemAsync('campkit.lifecycle.recovery.v1', 'member-synthetic');
    expect(await store.getItemAsync('campkit.lifecycle.recovery.v1')).toBe('member-synthetic');
    await store.close();
  });
});

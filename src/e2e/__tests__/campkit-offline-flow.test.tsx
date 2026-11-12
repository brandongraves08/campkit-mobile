import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(),
  deleteDatabaseAsync: jest.fn(),
}));
jest.mock('expo-secure-store', () => {
  const values = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    __values: values,
    getItemAsync: jest.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => { values.set(key, value); }),
    deleteItemAsync: jest.fn(async (key: string) => { values.delete(key); }),
  };
});
jest.mock('expo-crypto', () => {
  let count = 0;
  return {
    randomUUID: jest.fn(() => {
      count += 1;
      return `00000000-0000-4000-8000-${String(count).padStart(12, '0')}`;
    }),
    getRandomValues: jest.fn((target: Uint8Array) => {
      for (let index = 0; index < target.length; index += 1) target[index] = (index * 7 + 11) % 256;
      return target;
    }),
  };
});
const reconnectListeners: (() => void)[] = [];
jest.mock('../../sync/connectivity', () => ({
  onForeground: () => ({ remove: jest.fn() }),
  onConnectionRestored: (callback: () => void) => { reconnectListeners.push(callback); return { remove: jest.fn() }; },
}));
jest.mock('../../trips/trips-context', () => ({
  useTrips: () => (globalThis as unknown as { __campkitService: unknown }).__campkitService,
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => ({ tripId: '22222222-2222-4222-8222-222222222222' }) }));

declare const require: (name: string) => any;
declare const __dirname: string;

import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { ApiClient } from '../../api/http';
import { AuthClient } from '../../auth/auth-client';
import { TokenStore } from '../../auth/token-store';
import { AccountVault } from '../../storage/account-vault';
import { TripsService } from '../../trips/trips-service';
import { TestSqliteDatabase } from '../../storage/__tests__/sqlite-test-harness';
import TripScreen from '../../../app/trips/[tripId]';

const fs = require('fs');
const os = require('os');
const path = require('path');

const sqlite = SQLite as unknown as {
  openDatabaseAsync: jest.Mock<(name: string) => Promise<unknown>>;
  deleteDatabaseAsync: jest.Mock<(name: string) => Promise<void>>;
};
const secure = SecureStore as unknown as { __values: Map<string, string> };

const memberId = 'member-synthetic';
const householdId = '11111111-1111-4111-8111-111111111111';
const tripId = '22222222-2222-4222-8222-222222222222';
const databaseName = `campkit-${memberId}.db`;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let directory: string;
let handles: TestSqliteDatabase[];

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'campkit-e2e-'));
  handles = [];
  reconnectListeners.length = 0;
  secure.__values.clear();
  sqlite.openDatabaseAsync.mockReset();
  sqlite.openDatabaseAsync.mockImplementation(async (name: string) => {
    const handle = new TestSqliteDatabase(path.join(directory, name));
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

describe('mocked offline account-to-sync flow', () => {
  it('signs in, downloads, packs offline, restarts, reconnects and shows the synced state', async () => {
    let online = true;
    const requests: string[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(`${init?.method ?? 'GET'} ${url.pathname}`);
      if (url.pathname === '/o/token/') return json({ access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', expires_in: 3600, member_id: memberId });
      if (!online) throw new Error('synthetic network unavailable');
      if (url.pathname === '/api/mobile/v1/households/') return json({ households: [{ id: householdId, name: 'Synthetic Household' }] });
      if (url.pathname === `/api/mobile/v1/households/${householdId}/trips/`) return json({ trips: [{ id: tripId, name: 'Synthetic Camp', destination: 'Demo Lake', start_date: null, end_date: null, status: 'planned' }] });
      if (url.pathname === `/api/mobile/v1/households/${householdId}/trips/${tripId}/packing/`) return json({ trip: { id: tripId, name: 'Synthetic Camp' }, packing: [{ id: 12, packed: false, quantity: 1, version: 1, gear: { id: 'tent', name: 'Tent', category: 'shelter' } }] });
      if (url.pathname === `/api/mobile/v1/households/${householdId}/trips/${tripId}/packing/12/` && init?.method === 'PUT') {
        const body = JSON.parse(String(init.body));
        return json({ entry_id: '12', packed: body.packed, version: 2, client_operation_id: body.client_operation_id });
      }
      return json({ error: { code: 'not_found' } }, 404);
    };

    // --- Sign in through the mocked OAuth browser exchange, persisting the
    //     synthetic tokens in the (mocked) platform keychain.
    const tokens = new TokenStore(SecureStore);
    const auth = new AuthClient({
      baseUrl: 'https://campkit.synthetic.invalid', clientId: 'synthetic-client', tokens,
      browser: { async open() { return { type: 'success', url: 'com.graveystudios.campkit://oauth/callback?state=state&code=synthetic-code' }; } },
      crypto: { random: () => 'synthetic-verifier', challenge: async () => 'synthetic-challenge' }, fetcher, makeState: () => 'state', now: () => 1_000,
    });
    expect((await auth.signIn()).memberId).toBe(memberId);

    const api = new ApiClient({ baseUrl: 'https://campkit.synthetic.invalid', sessionStore: tokens, refresh: () => auth.refreshSession(), fetcher });
    const households = await api.listHouseholds();
    await api.selectHousehold(households[0].id);
    expect(await api.selectedHousehold()).toBe(householdId);

    // --- Real encrypted-database adapters behind the trip service.
    const serviceFor = (vault: AccountVault) => new TripsService({
      api, memberId, householdId: () => api.selectedHousehold(),
      repository: async (household) => (await vault.openAccount(memberId, household)).trips,
      operations: async (household) => (await vault.openAccount(memberId, household)).operations,
      now: () => new Date('2026-06-01T00:00:00.000Z'),
    });
    const vault = new AccountVault();
    await serviceFor(vault).downloadTrip(tripId);

    online = false;
    await serviceFor(vault).setPacked(tripId, '12', true);
    const firstVault = vault;
    await firstVault.closeAll();

    // --- Cold restart: a brand-new vault opens the same encrypted files again.
    const restartedVault = new AccountVault();
    const restartedService = serviceFor(restartedVault);
    const restored = await restartedService.getPackingSnapshot(tripId);
    expect(restored?.packing[0]).toMatchObject({ entryId: '12', packed: true, version: 1 });
    expect(await restartedService.listOperations()).toMatchObject([
      { memberId, householdId, tripId, entryId: '12', packed: true, status: 'pending', baseVersion: 1 },
    ]);
    expect(await api.selectedHousehold()).toBe(householdId);
    expect((await tokens.load())?.memberId).toBe(memberId);
    // The data really came back from a second native handle on the same file.
    expect(sqlite.openDatabaseAsync.mock.calls.filter(([name]) => name === databaseName)).toHaveLength(2);

    // --- Reconnect through the app's own connectivity hook and render the
    //     user-visible screen over the restarted service.
    (globalThis as unknown as { __campkitService: unknown }).__campkitService = restartedService;
    await render(<TripScreen />);
    expect(await screen.findByText('Tent')).toBeTruthy();
    expect(await screen.findByText('Pending sync · Packed')).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Tent', checked: true })).toBeTruthy();
    expect(screen.queryByText('All packing changes synced')).toBeNull();

    // Wait for the offline mount-time sync to exhaust its bounded retries so the
    // reconnection attempt below is the only in-flight sync.
    await waitFor(() => expect(requests.filter((line) => line.startsWith('PUT'))).toHaveLength(3), { timeout: 5000 });
    expect(screen.getByRole('switch', { name: 'Tent', checked: true })).toBeTruthy();

    online = true;
    expect(reconnectListeners).toHaveLength(1);
    // The screen only resumes sync while the app is foregrounded.
    AppState.currentState = 'active';
    await act(async () => { reconnectListeners.at(-1)?.(); });
    expect(requests.filter((line) => line.startsWith('PUT'))).toHaveLength(4);
    expect(await screen.findByText('All packing changes synced')).toBeTruthy();
    expect(screen.queryByText(/Pending sync/)).toBeNull();
    expect(screen.getByRole('switch', { name: 'Tent', checked: true })).toBeTruthy();
    expect(requests).toContain(`PUT /api/mobile/v1/households/${householdId}/trips/${tripId}/packing/12/`);

    // --- The acknowledgement is durable: a third cold start shows version 2
    //     and no queued operation.
    await restartedVault.closeAll();
    const finalService = serviceFor(new AccountVault());
    expect((await finalService.getPackingSnapshot(tripId))?.packing[0]).toMatchObject({ packed: true, version: 2 });
    expect(await finalService.listOperations()).toHaveLength(0);
  });
});

import { describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../../api/http';
import { AuthClient } from '../../auth/auth-client';
import { MemberSession } from '../../auth/token-store';
import { TripsService } from '../../trips/trips-service';
import { PendingOperation } from '../../storage/operations-repository';

jest.mock('expo-crypto', () => ({ randomUUID: () => '33333333-3333-4333-8333-333333333333' }));

const memberId = 'member-synthetic';
const householdId = '11111111-1111-4111-8111-111111111111';
const tripId = '22222222-2222-4222-8222-222222222222';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('mocked offline account-to-sync flow', () => {
  it('signs in, selects a household, downloads, packs offline, restarts, reconnects and displays synced state', async () => {
    let storedSession: MemberSession | null = null;
    let selectedHousehold: string | null = null;
    let online = true;
    const requests: string[] = [];
    let snapshot: any = null;
    const queued: PendingOperation[] = [];
    const sessionStore = {
      async save(session: MemberSession) { storedSession = session; },
      async load() { return storedSession; },
      async clear() { storedSession = null; },
    };
    const selectionStore = {
      async getItemAsync() { return selectedHousehold; },
      async setItemAsync(_key: string, value: string) { selectedHousehold = value; },
      async deleteItemAsync() { selectedHousehold = null; },
    };
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
    const auth = new AuthClient({
      baseUrl: 'https://campkit.synthetic.invalid', clientId: 'synthetic-client', tokens: sessionStore,
      browser: { async open() { return { type: 'success', url: 'com.graveystudios.campkit://oauth/callback?state=state&code=synthetic-code' }; } },
      crypto: { random: () => 'synthetic-verifier', challenge: async () => 'synthetic-challenge' }, fetcher, makeState: () => 'state', now: () => 1_000,
    });
    const signedIn = await auth.signIn();
    expect(signedIn.memberId).toBe(memberId);
    const api = new ApiClient({ baseUrl: 'https://campkit.synthetic.invalid', sessionStore, selectionStore, refresh: () => auth.refreshSession(), fetcher });
    const households = await api.listHouseholds();
    await api.selectHousehold(households[0].id);
    expect(await api.selectedHousehold()).toBe(householdId);

    const tripsRepository = {
      async saveSnapshot(value: any) { snapshot = value; return snapshot; },
      async listSnapshots() { return snapshot ? [snapshot] : []; },
      async getSnapshot(id: string) { return id === snapshot?.tripId ? snapshot : null; },
      async setPacked(_trip: string, entry: string, packed: boolean) { snapshot.packing.find((row: any) => row.entryId === entry).packed = packed; },
      async updatePacking(_trip: string, entry: string, packed: boolean, version: number) { Object.assign(snapshot.packing.find((row: any) => row.entryId === entry), { packed, version }); },
    };
    const operationsRepository = {
      async enqueue(input: any) { const op = { ...input, memberId, householdId, status: 'pending', createdAt: '2026-06-01T00:00:00.000Z', errorCode: null }; queued.push(op); return op; },
      async list(status?: string) { return queued.filter((op) => status === undefined || op.status === status); },
      async get(id: string) { return queued.find((op) => op.id === id) ?? null; },
      async updateStatus(id: string, status: any, errorCode: any = null) { Object.assign(queued.find((op) => op.id === id)!, { status, errorCode }); },
      async remove(id: string) { const index = queued.findIndex((op) => op.id === id); if (index < 0) return false; queued.splice(index, 1); return true; },
    };
    const service = () => new TripsService({ api, memberId, householdId: () => api.selectedHousehold(), repository: async () => tripsRepository as any, operations: async () => operationsRepository as any, now: () => new Date('2026-06-01T00:00:00.000Z') });

    await service().downloadTrip(tripId);
    online = false;
    await service().setPacked(tripId, '12', true);
    expect(snapshot.packing[0]).toMatchObject({ packed: true, version: 1 });
    expect(queued).toHaveLength(1);

    // Cold restart: reconstruct the service while retaining durable local repositories.
    const restartedService = service();
    expect(queued[0]).toMatchObject({ memberId, householdId, tripId, entryId: '12', status: 'pending' });
    expect((await restartedService.getPackingSnapshot(tripId))?.packing[0].packed).toBe(true);
    online = true;
    expect(await api.selectedHousehold()).toBe(householdId);
    const result = await restartedService.syncPendingOperations();
    expect(requests).toContain(`PUT /api/mobile/v1/households/${householdId}/trips/${tripId}/packing/12/`);
    expect(result).toMatchObject({ synced: 1, paused: false });
    expect(queued).toHaveLength(0);
    expect((await restartedService.getPackingSnapshot(tripId))?.packing[0]).toMatchObject({ packed: true, version: 2 });
    expect((await sessionStore.load())?.memberId).toBe(memberId);
  });
});

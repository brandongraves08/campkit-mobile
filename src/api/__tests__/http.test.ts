import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../http';

const sessionStore = { load: jest.fn<() => Promise<any>>(), save: jest.fn<(value: any) => Promise<void>>(), clear: jest.fn<() => Promise<void>>() };
const selectionValues = new Map<string, string>();
const selectionStore = {
  getItemAsync: jest.fn<(key: string) => Promise<string | null>>(async (key) => selectionValues.get(key) ?? null),
  setItemAsync: jest.fn<(key: string, value: string, options?: Record<string, unknown>) => Promise<void>>(async (key, value) => { selectionValues.set(key, value); }),
  deleteItemAsync: jest.fn<(key: string) => Promise<void>>(async (key) => { selectionValues.delete(key); }),
};
const fetcher = jest.fn<typeof fetch>();
const memberA = { memberId: 'member-a', accessToken: 'old', refreshToken: 'refresh', expiresAt: 0 };

describe('ApiClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sessionStore.load.mockResolvedValue(memberA);
    sessionStore.save.mockResolvedValue(undefined);
    selectionValues.clear();
    fetcher.mockResolvedValue({ status: 200, ok: true, json: async () => ({ households: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Home' }] }) } as Response);
  });

  it('refreshes one time after 401 and retries a GET with rotated credentials', async () => {
    fetcher.mockResolvedValueOnce({ status: 401, ok: false } as Response).mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ households: [] }) } as Response);
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => ({ memberId: 'member-a', accessToken: 'new', refreshToken: 'rotated', expiresAt: 9999 }) });
    await expect(api.listHouseholds()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get('Authorization')).toBe('Bearer new');
    expect(sessionStore.save).toHaveBeenCalledWith(expect.objectContaining({ refreshToken: 'rotated' }));
  });

  it('does not retry an unsafe mutation after 401', async () => {
    fetcher.mockResolvedValue({ status: 401, ok: false } as Response);
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    await expect(api.request('/households/11111111-1111-4111-8111-111111111111/x/', { method: 'PUT', body: '{}' })).rejects.toThrow(/unauthorized/i);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('lists trips and retrieves a packing snapshot only through the selected household routes', async () => {
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    await expect(api.listTrips()).rejects.toThrow(/select a household/i);
    expect(fetcher).not.toHaveBeenCalled();
    const householdId = '11111111-1111-4111-8111-111111111111';
    const tripId = '22222222-2222-4222-8222-222222222222';
    await api.selectHousehold(householdId);
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ trips: [{ id: tripId, name: 'Synthetic trip' }] }) } as Response);
    await expect(api.listTrips()).resolves.toEqual([{ id: tripId, name: 'Synthetic trip' }]);
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(`https://campkit.lan/api/mobile/v1/households/${householdId}/trips/`);
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ trip: { id: tripId, name: 'Synthetic trip' }, packing: [] }) } as Response);
    await expect(api.getPackingSnapshot(tripId)).resolves.toEqual({ trip: { id: tripId, name: 'Synthetic trip' }, packing: [] });
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(`https://campkit.lan/api/mobile/v1/households/${householdId}/trips/${tripId}/packing/`);
  });

  it('rejects malformed trip identifiers and malformed list/snapshot envelopes', async () => {
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    await api.selectHousehold('11111111-1111-4111-8111-111111111111');
    await expect(api.getPackingSnapshot('bad')).rejects.toThrow(/trip ID/i);
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ trips: {} }) } as Response);
    await expect(api.listTrips()).rejects.toThrow(/trip list response/i);
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ trip: null, packing: [] }) } as Response);
    await expect(api.getPackingSnapshot('22222222-2222-4222-8222-222222222222')).rejects.toThrow(/packing snapshot response/i);
  });

  it('writes packing with the exact versioned idempotency request and exposes stable backend errors', async () => {
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    const householdId = '11111111-1111-4111-8111-111111111111';
    const tripId = '22222222-2222-4222-8222-222222222222';
    await api.selectHousehold(householdId);
    fetcher.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ entry_id: '12', packed: true, version: 4, client_operation_id: '55555555-5555-4555-8555-555555555555' }) } as Response);
    await expect(api.setPackedState(tripId, '12', { packed: true, baseVersion: 3, clientOperationId: '55555555-5555-4555-8555-555555555555' })).resolves.toEqual({ entryId: '12', packed: true, version: 4, clientOperationId: '55555555-5555-4555-8555-555555555555' });
    expect(String(fetcher.mock.calls.at(-1)?.[0])).toBe(`https://campkit.lan/api/mobile/v1/households/${householdId}/trips/${tripId}/packing/12/`);
    expect(fetcher.mock.calls.at(-1)?.[1]).toMatchObject({ method: 'PUT', body: JSON.stringify({ packed: true, client_operation_id: '55555555-5555-4555-8555-555555555555', base_version: 3 }) });
    fetcher.mockResolvedValueOnce({ status: 404, ok: false, json: async () => ({ error: { code: 'not_found', message: 'missing' } }) } as Response);
    await expect(api.setPackedState(tripId, '12', { packed: true, baseVersion: 3, clientOperationId: '55555555-5555-4555-8555-555555555555' })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    fetcher.mockResolvedValueOnce({ status: 409, ok: false, json: async () => ({ error: { code: 'unlisted_backend_detail', message: 'internal detail' } }) } as Response);
    await expect(api.setPackedState(tripId, '12', { packed: true, baseVersion: 3, clientOperationId: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow('CampKit API request failed (409)');
    fetcher.mockRejectedValueOnce(new TypeError('offline'));
    await expect(api.setPackedState(tripId, '12', { packed: true, baseVersion: 3, clientOperationId: '55555555-5555-4555-8555-555555555555' })).rejects.toMatchObject({ code: 'network_error' });
    await expect(api.setPackedState(tripId, '12', { packed: 'yes' as never, baseVersion: 3, clientOperationId: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow(/invalid packing operation/i);
    await expect(api.setPackedState(tripId, '12', { packed: false, baseVersion: 0, clientOperationId: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow(/invalid packing operation/i);
    await expect(api.setPackedState(tripId, 'x', { packed: false, baseVersion: 1, clientOperationId: '55555555-5555-4555-8555-555555555555' })).rejects.toThrow(/entry ID/i);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it('keeps household selection scoped to the signed-in member', async () => {
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    await api.selectHousehold('11111111-1111-4111-8111-111111111111');
    expect(selectionStore.setItemAsync).toHaveBeenCalledWith('campkit.selected-household.v1.member-a', '11111111-1111-4111-8111-111111111111', expect.any(Object));
    await expect(api.selectedHousehold()).resolves.toBe('11111111-1111-4111-8111-111111111111');
    sessionStore.load.mockResolvedValue({ ...memberA, memberId: 'member-b' });
    await expect(api.selectedHousehold()).resolves.toBeNull();
  });

  it('rejects invalid household identifiers on selection and malformed API records', async () => {
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    await expect(api.selectHousehold('not-a-uuid')).rejects.toThrow(/household ID/i);
    expect(selectionStore.setItemAsync).not.toHaveBeenCalled();
    fetcher.mockResolvedValue({ status: 200, ok: true, json: async () => ({ households: [{ id: 'not-a-uuid', name: 'Not valid' }] }) } as Response);
    await expect(api.listHouseholds()).rejects.toThrow(/invalid household response/i);
  });

  it('rejects non-HTTPS origins and does not retry when the single GET retry is still unauthorized', async () => {
    expect(() => new ApiClient({ baseUrl: 'http://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA })).toThrow(/HTTPS/);
    expect(() => new ApiClient({ baseUrl: 'https://campkit.lan/api/mobile/v1', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA })).toThrow(/origin/);
    fetcher.mockResolvedValue({ status: 401, ok: false } as Response);
    const api = new ApiClient({ baseUrl: 'https://campkit.lan', sessionStore, selectionStore, fetcher: fetcher as typeof fetch, refresh: async () => memberA });
    await expect(api.listHouseholds()).rejects.toThrow(/unauthorized/i);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

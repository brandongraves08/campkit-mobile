import * as SecureStore from 'expo-secure-store';
import { MemberSession, TokenStore } from '../auth/token-store';

interface ApiOptions {
  baseUrl: string; sessionStore?: Pick<TokenStore, 'load' | 'save' | 'clear'>;
  selectionStore?: { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>; deleteItemAsync(key: string): Promise<void> };
  fetcher?: typeof fetch; refresh: () => Promise<MemberSession>;
}
export interface Household { id: string; name: string }
const STABLE_ERROR_CODES = ['invalid_request', 'unauthorized', 'not_found', 'version_conflict', 'trip_read_only', 'idempotency_key_reused', 'operation_in_progress'] as const;
export type StableApiErrorCode = (typeof STABLE_ERROR_CODES)[number];
export type ApiErrorCode = StableApiErrorCode | 'network_error';
export class ApiError extends Error { constructor(message: string, readonly code: ApiErrorCode, readonly status: number, readonly details: Record<string, unknown> = {}) { super(message); this.name = 'ApiError'; } }
const secureTokens = new TokenStore(SecureStore);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function origin(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('API base URL must use HTTPS origin');
  return parsed;
}
export class ApiClient {
  private readonly base: URL;
  private readonly sessionStore: NonNullable<ApiOptions['sessionStore']>;
  private readonly selectionStore: NonNullable<ApiOptions['selectionStore']>;
  private readonly fetcher: typeof fetch;
  constructor(private readonly options: ApiOptions) {
    this.base = origin(options.baseUrl);
    this.sessionStore = options.sessionStore ?? secureTokens;
    this.selectionStore = options.selectionStore ?? SecureStore;
    this.fetcher = options.fetcher ?? fetch;
  }
  async request(path: string, init: RequestInit = {}): Promise<Response> {
    const session = await this.sessionStore.load();
    if (!session) throw new Error('Unauthorized: sign in required');
    const method = (init.method ?? 'GET').toUpperCase();
    const url = new URL(`/api/mobile/v1${path.startsWith('/') ? path : `/${path}`}`, this.base);
    const send = async (accessToken: string) => {
      try { return await this.fetcher(url, { ...init, method, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${accessToken}` } }); }
      catch (cause) { throw new ApiError(cause instanceof Error ? cause.message : 'Network request failed', 'network_error', 0); }
    };
    let response = await send(session.accessToken);
    if (response.status === 401 && method === 'GET') {
      const updated = await this.options.refresh();
      if (updated.memberId !== session.memberId) throw new Error('Unauthorized: refreshed account changed');
      await this.sessionStore.save(updated);
      response = await send(updated.accessToken);
    }
    if (response.status === 401) throw new ApiError('Unauthorized', 'unauthorized', 401);
    if (!response.ok) {
      let body: unknown = null;
      try { body = await response.json(); } catch { /* non-JSON framework errors stay unmapped */ }
      const envelope = body && typeof body === 'object' ? (body as { error?: unknown }).error : null;
      if (envelope && typeof envelope === 'object') {
        const error = envelope as Record<string, unknown>;
        if (typeof error.code === 'string' && STABLE_ERROR_CODES.includes(error.code as StableApiErrorCode)) throw new ApiError(typeof error.message === 'string' ? error.message : 'CampKit API request failed', error.code as StableApiErrorCode, response.status, error);
      }
      throw new Error(`CampKit API request failed (${response.status})`);
    }
    return response;
  }
  async setPackedState(tripId: string, entryId: string, input: { packed: boolean; baseVersion: number; clientOperationId: string }): Promise<{ entryId: string; packed: boolean; version: number; clientOperationId: string }> {
    const householdId = await this.selectedHousehold();
    if (!householdId || !UUID.test(householdId)) throw new Error('Select a household before syncing packing');
    if (!UUID.test(tripId)) throw new Error('Invalid trip ID');
    if (!/^([1-9][0-9]*)$/.test(entryId)) throw new Error('Invalid packing entry ID');
    if (typeof input.packed !== 'boolean' || !Number.isInteger(input.baseVersion) || input.baseVersion < 1 || !UUID.test(input.clientOperationId)) throw new Error('Invalid packing operation');
    const response = await this.request(`/households/${householdId}/trips/${tripId}/packing/${entryId}/`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ packed: input.packed, client_operation_id: input.clientOperationId, base_version: input.baseVersion }) });
    const body = await response.json() as Record<string, unknown>;
    if (body.entry_id !== entryId || body.packed !== input.packed || !Number.isInteger(body.version) || (body.version as number) < 1 || body.client_operation_id !== input.clientOperationId) throw new Error('Invalid packing acknowledgement');
    return { entryId, packed: input.packed, version: body.version as number, clientOperationId: input.clientOperationId };
  }
  async listHouseholds(): Promise<Household[]> {
    const response = await this.request('/households/');
    const body = await response.json() as { households?: unknown };
    if (!Array.isArray(body.households) || body.households.some((h) => !h || typeof h !== 'object' || !UUID.test(String((h as Household).id)) || typeof (h as Household).name !== 'string')) throw new Error('Invalid household response');
    return body.households as Household[];
  }
  async listTrips(): Promise<unknown[]> {
    const householdId = await this.selectedHousehold();
    if (!householdId || !UUID.test(householdId)) throw new Error('Select a household before listing trips');
    const response = await this.request(`/households/${householdId}/trips/`);
    const body = await response.json() as { trips?: unknown };
    if (!Array.isArray(body.trips)) throw new Error('Invalid trip list response');
    return body.trips;
  }
  async getPackingSnapshot(tripId: string): Promise<{ trip: { id: string; name: string }; packing: { id: number; packed: boolean; quantity: number; version: number; gear: { id: string; name: string; category: string } }[] }> {
    const householdId = await this.selectedHousehold();
    if (!householdId || !UUID.test(householdId)) throw new Error('Select a household before downloading a trip');
    if (!UUID.test(tripId)) throw new Error('Invalid trip ID');
    const response = await this.request(`/households/${householdId}/trips/${tripId}/packing/`);
    const body = await response.json() as { trip?: unknown; packing?: unknown };
    if (!body.trip || typeof body.trip !== 'object' || !Array.isArray(body.packing)) throw new Error('Invalid packing snapshot response');
    return body as { trip: { id: string; name: string }; packing: { id: number; packed: boolean; quantity: number; version: number; gear: { id: string; name: string; category: string } }[] };
  }
  async selectHousehold(id: string): Promise<void> {
    if (!UUID.test(id)) throw new Error('Invalid household ID');
    const session = await this.sessionStore.load();
    if (!session) throw new Error('Unauthorized: sign in required');
    await this.selectionStore.setItemAsync(this.selectionKey(session.memberId), id, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  }
  async selectedHousehold(): Promise<string | null> {
    const session = await this.sessionStore.load();
    if (!session) return null;
    return this.selectionStore.getItemAsync(this.selectionKey(session.memberId));
  }
  async clearHouseholdSelection(memberId: string): Promise<void> { await this.selectionStore.deleteItemAsync(this.selectionKey(memberId)); }
  private selectionKey(memberId: string): string { return `campkit.selected-household.v1.${encodeURIComponent(memberId)}`; }
}

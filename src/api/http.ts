import * as SecureStore from 'expo-secure-store';
import { MemberSession, TokenStore } from '../auth/token-store';

interface ApiOptions {
  baseUrl: string; sessionStore?: Pick<TokenStore, 'load' | 'save' | 'clear'>;
  selectionStore?: { getItemAsync(key: string): Promise<string | null>; setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>; deleteItemAsync(key: string): Promise<void> };
  fetcher?: typeof fetch; refresh: () => Promise<MemberSession>;
}
export interface Household { id: string; name: string }
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
    const send = (accessToken: string) => this.fetcher(url, { ...init, method, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), Authorization: `Bearer ${accessToken}` } });
    let response = await send(session.accessToken);
    if (response.status === 401 && method === 'GET') {
      const updated = await this.options.refresh();
      if (updated.memberId !== session.memberId) throw new Error('Unauthorized: refreshed account changed');
      await this.sessionStore.save(updated);
      response = await send(updated.accessToken);
    }
    if (response.status === 401) throw new Error('Unauthorized');
    if (!response.ok) throw new Error(`CampKit API request failed (${response.status})`);
    return response;
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

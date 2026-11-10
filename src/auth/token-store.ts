import * as SecureStore from 'expo-secure-store';

export interface MemberSession {
  memberId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface SecureStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string, options?: Record<string, unknown>): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const SESSION_KEY = 'campkit.member-session.v1';
const SECURE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

function isSession(value: unknown): value is MemberSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return typeof session.memberId === 'string' && session.memberId.length > 0 &&
    typeof session.accessToken === 'string' && session.accessToken.length > 0 &&
    typeof session.refreshToken === 'string' && session.refreshToken.length > 0 &&
    typeof session.expiresAt === 'number' && Number.isFinite(session.expiresAt);
}

export class TokenStore {
  constructor(private readonly secureStore: SecureStorage) {}
  async save(session: MemberSession): Promise<void> {
    if (!isSession(session)) throw new Error('Invalid member session');
    await this.secureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), SECURE_OPTIONS);
  }
  async load(): Promise<MemberSession | null> {
    const raw = await this.secureStore.getItemAsync(SESSION_KEY);
    if (raw === null) return null;
    let decoded: unknown;
    try { decoded = JSON.parse(raw); } catch { throw new Error('Invalid secure session data'); }
    if (!isSession(decoded)) throw new Error('Invalid secure session data');
    return decoded;
  }
  async clear(): Promise<void> { await this.secureStore.deleteItemAsync(SESSION_KEY); }
}

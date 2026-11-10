import { expect, it, jest } from '@jest/globals';
import { TokenStore, SecureStorage } from '../token-store';

it('persists only the token record through SecureStore and validates token shape on load', async () => {
  const secure: SecureStorage = {
    getItemAsync: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
    setItemAsync: jest.fn<(key: string, value: string, options?: Record<string, unknown>) => Promise<void>>().mockResolvedValue(undefined),
    deleteItemAsync: jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined),
  };
  const store = new TokenStore(secure);
  const session = { memberId: 'member-1', accessToken: 'opaque-access', refreshToken: 'opaque-refresh', expiresAt: 1234 };
  await store.save(session);
  expect(secure.setItemAsync).toHaveBeenCalledWith('campkit.member-session.v1', JSON.stringify(session), expect.any(Object));
  (secure.getItemAsync as jest.Mock<() => Promise<string | null>>).mockResolvedValue(JSON.stringify(session));
  expect(await store.load()).toEqual(session);
  (secure.getItemAsync as jest.Mock<() => Promise<string | null>>).mockResolvedValue(JSON.stringify({ ...session, memberId: 42 }));
  await expect(store.load()).rejects.toThrow(/invalid/i);
});

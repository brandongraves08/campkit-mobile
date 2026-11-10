import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AuthClient } from '../auth-client';
import { AUTH_REDIRECT_URI } from '../redirect';

describe('AuthClient', () => {
  const tokens = { save: jest.fn<(value: any) => Promise<void>>(), load: jest.fn<() => Promise<any>>(), clear: jest.fn<() => Promise<void>>() };
  const browser = { open: jest.fn<(url: string, redirectUri: string) => Promise<{ type: string; url?: string }>>() };
  const crypto = { random: jest.fn<() => Promise<string>>(), challenge: jest.fn<(verifier: string) => Promise<string>>() };
  const fetcher = jest.fn<typeof fetch>();
  let client: AuthClient;

  beforeEach(() => {
    jest.clearAllMocks();
    crypto.random.mockResolvedValue('verifier-value');
    crypto.challenge.mockResolvedValue('challenge-value');
    browser.open.mockImplementation(async () => ({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=auth-code&state=state-value` }));
    fetcher.mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 900, token_type: 'Bearer', scope: 'mobile:packing' }) } as Response);
    client = new AuthClient({ baseUrl: 'https://campkit.lan', clientId: 'native-client', tokens, browser, crypto, fetcher: fetcher as typeof fetch, makeState: () => 'state-value' });
  });

  it('uses system browser authorization code PKCE S256 with exact scope and callback', async () => {
    await client.signIn();
    const url = new URL(String(browser.open.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://campkit.lan/o/authorize/');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('native-client');
    expect(url.searchParams.get('redirect_uri')).toBe(AUTH_REDIRECT_URI);
    expect(url.searchParams.get('scope')).toBe('mobile:packing');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-value');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe('state-value');
    const body = String(fetcher.mock.calls[0]?.[1]?.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(new URLSearchParams(body).get('code_verifier')).toBe('verifier-value');
    expect(body).not.toContain('client_secret');
  });

  it('rejects mismatched state and OAuth error callback without exchanging a code', async () => {
    browser.open.mockResolvedValueOnce({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=x&state=wrong` });
    await expect(client.signIn()).rejects.toThrow(/state/i);
    browser.open.mockResolvedValueOnce({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=x&state=state-value&state=state-value` });
    await expect(client.signIn()).rejects.toThrow(/state/i);
    browser.open.mockResolvedValueOnce({ type: 'success', url: `${AUTH_REDIRECT_URI}?error=access_denied&state=state-value` });
    await expect(client.signIn()).rejects.toThrow(/access_denied/);
    browser.open.mockResolvedValueOnce({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=x&error=access_denied&state=state-value` });
    await expect(client.signIn()).rejects.toThrow(/callback parameters/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects callbacks with a different scheme, host, or path', async () => {
    browser.open.mockResolvedValue({ type: 'success', url: 'https://attacker.invalid/oauth/callback?code=x&state=state-value' });
    await expect(client.signIn()).rejects.toThrow(/callback/i);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rotates and securely stores refresh credentials without leaking response data in errors', async () => {
    tokens.load.mockResolvedValue({ memberId: 'member-1', accessToken: 'old', refreshToken: 'refresh-old', expiresAt: 1 });
    fetcher.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 900 }) } as Response);
    const renewed = await client.refreshSession();
    expect(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).get('grant_type')).toBe('refresh_token');
    expect(new URLSearchParams(String(fetcher.mock.calls[0]?.[1]?.body)).get('refresh_token')).toBe('refresh-old');
    expect(renewed).toEqual({ memberId: 'member-1', accessToken: 'new-access', refreshToken: 'new-refresh', expiresAt: expect.any(Number) });
    expect(tokens.save).toHaveBeenCalledWith(renewed);
    fetcher.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ access_token: 'secret-leak' }) } as Response);
    await expect(client.refreshSession()).rejects.toThrow('OAuth token request failed (401)');
    expect(tokens.save).toHaveBeenCalledTimes(1);
  });

  it('rejects plaintext API origins', () => {
    expect(() => new AuthClient({ baseUrl: 'http://campkit.lan', clientId: 'native-client', tokens, browser, crypto, fetcher: fetcher as typeof fetch })).toThrow(/HTTPS/);
    expect(() => new AuthClient({ baseUrl: 'https://campkit.lan/api/v1', clientId: 'native-client', tokens, browser, crypto, fetcher: fetcher as typeof fetch })).toThrow(/origin/);
  });
});

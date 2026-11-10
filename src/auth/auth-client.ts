import * as SecureStore from 'expo-secure-store';
import { deriveChallengeAsync, generateRandom } from 'expo-auth-session/build/PKCE';
import * as WebBrowser from 'expo-web-browser';
import { AUTH_REDIRECT_URI } from './redirect';
import { MemberSession, TokenStore } from './token-store';

export { MemberSession } from './token-store';

interface OAuthTokens { access_token: string; refresh_token: string; expires_in: number; token_type?: string; scope?: string }
interface BrowserResult { type: string; url?: string }
interface AuthOptions {
  baseUrl: string; clientId: string; tokens?: Pick<TokenStore, 'save' | 'load' | 'clear'>;
  browser?: { open(url: string, redirectUri: string): Promise<BrowserResult> };
  crypto?: { random(): string | Promise<string>; challenge(verifier: string): Promise<string> };
  fetcher?: typeof fetch; makeState?: () => string; now?: () => number;
}
const secureStore = new TokenStore(SecureStore);
const systemBrowser = { open: (url: string, redirectUri: string) => WebBrowser.openAuthSessionAsync(url, redirectUri) };
const pkce = { random: () => generateRandom(64), challenge: deriveChallengeAsync };

function secureBaseUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('API base URL must be a trusted HTTPS origin');
  return url;
}
function callbackParams(raw: string): URLSearchParams {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('Invalid OAuth callback'); }
  const expected = new URL(AUTH_REDIRECT_URI);
  if (url.protocol !== expected.protocol || url.hostname !== expected.hostname || url.pathname !== expected.pathname || url.username || url.password) throw new Error('Invalid OAuth callback');
  return url.searchParams;
}

export class AuthClient {
  private readonly base: URL;
  private readonly tokens: Pick<TokenStore, 'save' | 'load' | 'clear'>;
  private readonly browser: NonNullable<AuthOptions['browser']>;
  private readonly crypto: NonNullable<AuthOptions['crypto']>;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  constructor(private readonly options: AuthOptions) {
    this.base = secureBaseUrl(options.baseUrl);
    this.tokens = options.tokens ?? secureStore;
    this.browser = options.browser ?? systemBrowser;
    this.crypto = options.crypto ?? pkce;
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
  }
  async signIn(): Promise<MemberSession> {
    const state = this.options.makeState?.() ?? await this.crypto.random();
    const verifier = await this.crypto.random();
    const challenge = await this.crypto.challenge(verifier);
    const authorize = new URL('/o/authorize/', this.base);
    authorize.search = new URLSearchParams({ response_type: 'code', client_id: this.options.clientId, redirect_uri: AUTH_REDIRECT_URI, scope: 'mobile:packing', state, code_challenge: challenge, code_challenge_method: 'S256' }).toString();
    const result = await this.browser.open(authorize.toString(), AUTH_REDIRECT_URI);
    if (result.type !== 'success' || !result.url) throw new Error('Sign-in cancelled');
    const params = callbackParams(result.url);
    if (params.getAll('state').length !== 1 || params.get('state') !== state) throw new Error('OAuth state verification failed');
    if (params.getAll('error').length > 1 || params.getAll('code').length > 1 || (params.has('error') && params.has('code'))) throw new Error('Invalid OAuth callback parameters');
    const oauthError = params.get('error');
    if (oauthError) throw new Error(`OAuth authorization failed: ${oauthError}`);
    const code = params.get('code');
    if (!code) throw new Error('OAuth callback is missing authorization code');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: AUTH_REDIRECT_URI, client_id: this.options.clientId, code_verifier: verifier });
    const response = await this.fetcher(new URL('/o/token/', this.base), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const data = await this.readTokens(response);
    const serverMember = (data as OAuthTokens & { member_id?: unknown }).member_id;
    const memberId = typeof serverMember === 'string' ? serverMember : `account-${await this.crypto.random()}`;
    const session: MemberSession = { memberId, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: this.now() + data.expires_in * 1000 };
    await this.tokens.save(session);
    return session;
  }
  async refreshSession(): Promise<MemberSession> {
    const current = await this.tokens.load();
    if (!current) throw new Error('No active session');
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: this.options.clientId });
    const response = await this.fetcher(new URL('/o/token/', this.base), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const data = await this.readTokens(response);
    const session = { ...current, accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: this.now() + data.expires_in * 1000 };
    await this.tokens.save(session);
    return session;
  }
  async signOut(): Promise<void> { await this.tokens.clear(); }
  private async readTokens(response: Response): Promise<OAuthTokens> {
    if (!response.ok) throw new Error(`OAuth token request failed (${response.status})`);
    const data = await response.json() as Partial<OAuthTokens>;
    if (typeof data.access_token !== 'string' || !data.access_token || typeof data.refresh_token !== 'string' || !data.refresh_token || typeof data.expires_in !== 'number' || data.expires_in <= 0) throw new Error('Invalid OAuth token response');
    return data as OAuthTokens;
  }
}

declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');
const os = require('os');
import { expect, it, jest } from '@jest/globals';
import { AuthClient } from '../auth-client';
import { SecureStorage, TokenStore } from '../token-store';
import { AUTH_REDIRECT_URI } from '../redirect';

const repoRoot = path.resolve(__dirname, '../../..');

const productionFiles = [
  'src/auth/auth-client.ts',
  'src/auth/token-store.ts',
  'src/auth/session-context.tsx',
  'src/api/http.ts',
];
// The test sources that exercise real access/refresh token values. A snapshot
// assertion here would serialize a live token into a checked-in `.snap` file.
const tokenTestSources = ['src/auth/__tests__/auth-client.test.ts', 'src/auth/__tests__/token-store.test.ts'];
const snapshotRoots = ['src', 'app'];

const forbiddenSinkPatterns = [
  /@react-native-async-storage\/async-storage|\bAsyncStorage\b/i,
  /expo-sqlite|\bSQLite\b|\bopenDatabase\b/i,
  /\bconsole\s*\.\s*(?:log|info|warn|error|debug)\s*\(/,
  /\.(?:toMatchSnapshot|toMatchInlineSnapshot)\s*\(/,
];

const snapshotApiPattern = /\.(?:toMatchSnapshot|toMatchInlineSnapshot)\s*\(/;
const tokenLiteralPattern = /["']?(?:accessToken|refreshToken|access_token|refresh_token)["']?\s*[:=]\s*["'][^"']{8,}["']/i;

function expectNoForbiddenTokenSinks(source: string) {
  for (const pattern of forbiddenSinkPatterns) expect(source).not.toMatch(pattern);
}

function listFiles(directory: string, accept: (name: string) => boolean): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry: any) => {
    const fullPath = path.resolve(directory, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath, accept);
    return entry.isFile() && accept(entry.name) ? [fullPath] : [];
  });
}

function findSnapshotApiUses(sources: Array<{ file: string; source: string }>): string[] {
  return sources.filter(({ source }) => snapshotApiPattern.test(source)).map(({ file }) => file);
}

function findTokenSnapshotArtifacts(files: string[]): string[] {
  return files.filter((file) => tokenLiteralPattern.test(fs.readFileSync(file, 'utf8')));
}

it('rejects representative AsyncStorage, local-database, logging, and snapshot leakage code', () => {
  const injectedLeaks = [
    "import AsyncStorage from '@react-native-async-storage/async-storage'; AsyncStorage.setItem('token', accessToken);",
    "import * as SQLite from 'expo-sqlite'; SQLite.openDatabaseAsync('tokens.db');",
    'console.error(`access token: ${accessToken}`);',
    'expect(session).toMatchSnapshot();',
  ];
  for (const injectedLeak of injectedLeaks) {
    expect(() => expectNoForbiddenTokenSinks(injectedLeak)).toThrow();
  }
});

it('keeps the real auth/token path on SecureStore, emits no token logs, and sanitizes errors', async () => {
  const accessToken = 'sentinel-access-token-never-log';
  const refreshToken = 'sentinel-refresh-token-never-log';
  const storedValues: string[] = [];
  let persisted: string | null = null;
  const secure: SecureStorage = {
    getItemAsync: jest.fn<(key: string) => Promise<string | null>>().mockImplementation(async () => persisted),
    setItemAsync: jest.fn<(key: string, value: string) => Promise<void>>().mockImplementation(async (_key, value) => { persisted = value; storedValues.push(value); }),
    deleteItemAsync: jest.fn<(key: string) => Promise<void>>().mockResolvedValue(undefined),
  };
  const tokenStore = new TokenStore(secure);
  const browser = { open: jest.fn(async () => ({ type: 'success', url: `${AUTH_REDIRECT_URI}?code=auth-code&state=state` })) };
  const fetcher = jest.fn<typeof fetch>().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ access_token: accessToken, refresh_token: refreshToken, expires_in: 900 }),
  } as Response);
  const auth = new AuthClient({
    baseUrl: 'https://campkit.lan', clientId: 'public-native-client', tokens: tokenStore,
    browser, crypto: { random: async () => 'verifier', challenge: async () => 'challenge' },
    fetcher: fetcher as typeof fetch, makeState: () => 'state',
  });
  const logSpies = [jest.spyOn(console, 'log'), jest.spyOn(console, 'info'), jest.spyOn(console, 'warn'), jest.spyOn(console, 'error')];

  try {
    const session = await auth.signIn();
    expect(session.accessToken).toBe(accessToken);
    expect(session.refreshToken).toBe(refreshToken);
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
    expect(secure.setItemAsync).toHaveBeenCalledWith('campkit.member-session.v1', expect.any(String), expect.any(Object));
    expect(storedValues).toHaveLength(1);
    expect(JSON.parse(storedValues[0])).toEqual(session);

    fetcher.mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ error: 'invalid_grant', access_token: accessToken, refresh_token: refreshToken }),
    } as Response);
    let surfacedError = '';
    try { await auth.refreshSession(); } catch (error) { surfacedError = String(error); }
    expect(surfacedError).toBe('Error: OAuth token request failed (400)');
    expect(surfacedError).not.toContain(accessToken);
    expect(surfacedError).not.toContain(refreshToken);
    expect(logSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ')).not.toContain(accessToken);
    expect(logSpies.flatMap((spy) => spy.mock.calls.flat()).join(' ')).not.toContain(refreshToken);
  } finally {
    for (const spy of logSpies) spy.mockRestore();
  }
});

it('keeps token-handling production modules free of prohibited persistence/log/snapshot sinks', () => {
  for (const file of productionFiles) {
    expectNoForbiddenTokenSinks(fs.readFileSync(path.resolve(repoRoot, file), 'utf8'));
  }
});

it('flags a token-bearing snapshot assertion added to the real auth/token test sources', () => {
  const sources = tokenTestSources.map((file) => ({
    file,
    source: fs.readFileSync(path.resolve(repoRoot, file), 'utf8'),
  }));
  expect(findSnapshotApiUses(sources)).toEqual([]);

  const mutant = sources.map(({ file, source }) =>
    file === 'src/auth/__tests__/auth-client.test.ts'
      ? { file, source: `${source}\nit('leak', () => expect(session).toMatchSnapshot());\n` }
      : { file, source },
  );
  expect(findSnapshotApiUses(mutant)).toEqual(['src/auth/__tests__/auth-client.test.ts']);
});

it('flags a token-bearing snapshot artifact under the app source trees', () => {
  const snapshotFiles = snapshotRoots.flatMap((directory) =>
    listFiles(path.resolve(repoRoot, directory), (name: string) => name.endsWith('.snap')),
  );
  expect(findTokenSnapshotArtifacts(snapshotFiles)).toEqual([]);

  const mutantDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'campkit-snapshot-guard-'));
  const mutantFile = path.join(mutantDirectory, 'auth-client.test.ts.snap');
  fs.writeFileSync(mutantFile, 'exports[`session`] = `\n{"accessToken": "sentinel-access-token-leak"}\n`;\n');
  try {
    expect(findTokenSnapshotArtifacts([...snapshotFiles, mutantFile])).toEqual([mutantFile]);
  } finally {
    fs.rmSync(mutantDirectory, { recursive: true, force: true });
  }
});

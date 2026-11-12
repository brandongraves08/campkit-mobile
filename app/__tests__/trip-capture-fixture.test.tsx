import React from 'react';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import TripCaptureFixture from '../trip-capture-fixture';

declare const require: (id: string) => { readFileSync(path: string, encoding: string): string };
const fs = require('fs');

const validStates = ['online', 'progress', 'downloaded', 'error', 'empty', 'loading', 'packing', 'pending', 'conflict', 'attention'] as const;
let mockRouteState = 'online';

jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ state: mockRouteState }) }));

function setEnvironment(dev: boolean, state: string) {
  mockRouteState = state;
  Object.defineProperty(globalThis, '__DEV__', { configurable: true, value: dev });
}

afterEach(() => {
  setEnvironment(true, 'online');
});

describe('synthetic trip capture fixture route', () => {
  it.each(validStates)('renders the actual route for allowlisted state %s in development', async (state) => {
    setEnvironment(true, state);
    const screen = await render(<TripCaptureFixture />);
    expect(screen.getByText(new RegExp(`Development capture fixture.*${state}`))).toBeTruthy();
  });

  it('falls back to the online state for an unknown route state', async () => {
    setEnvironment(true, 'unexpected');
    const screen = await render(<TripCaptureFixture />);
    expect(screen.getByText('Online trips')).toBeTruthy();
    expect(screen.getByText(/Development capture fixture.*online/)).toBeTruthy();
  });

  it('renders nothing when the actual route is loaded in production mode', async () => {
    setEnvironment(false, 'online');
    const screen = await render(<TripCaptureFixture />);
    expect(screen.toJSON()).toBeNull();
  });

  it('keeps the actual route isolated from auth, API, and storage boundaries', () => {
    const source = fs.readFileSync('app/trip-capture-fixture.tsx', 'utf8');
    const imports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

    expect(imports).toEqual(expect.arrayContaining([
      'react-native',
      'expo-router',
      '../src/components/PackingRow',
      '../src/components/SyncStatus',
      '../src/components/TripCard',
    ]));
    expect(imports.join('\n')).not.toMatch(/auth|api|storage/i);
    expect(source).not.toMatch(/\b(fetch|useTrips|useSession|database|SecureStore)\b/);
    expect(source).toContain("'22222222-2222-4222-8222-222222222222'");
    expect(source).toContain("'Synthetic stove'");
  });
});

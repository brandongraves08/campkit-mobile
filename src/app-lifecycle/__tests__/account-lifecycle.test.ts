import { describe, expect, it } from '@jest/globals';
import { AccountLifecycle } from '../account-lifecycle';

function makeLifecycle() {
  const values = new Map<string, string>();
  const events: string[] = [];
  let failVault = false;
  let failMarker = false;
  const markerStore = {
    async getItemAsync(key: string) { return values.get(key) ?? null; },
    async setItemAsync(key: string, value: string) { if (failMarker) throw new Error('secure marker unavailable'); values.set(key, value); },
    async deleteItemAsync(key: string) { values.delete(key); },
  };
  const lifecycle = new AccountLifecycle({
    markerStore,
    clearCredentials: async () => { events.push('credentials'); },
    clearSelection: async (memberId: string) => { events.push(`selection:${memberId}`); },
    clearVault: async (memberId: string) => { events.push(`vault:${memberId}`); if (failVault) throw new Error('vault unavailable'); },
  });
  return {
    lifecycle, values, events,
    setFailVault(value: boolean) { failVault = value; },
    setFailMarker(value: boolean) { failMarker = value; },
  };
}

describe('account lifecycle', () => {
  it('clears credentials, account selection, encrypted vault and completion marker in order', async () => {
    const { lifecycle, values, events } = makeLifecycle();
    await lifecycle.signOut('member-a');
    expect(events).toEqual(['credentials', 'selection:member-a', 'vault:member-a']);
    expect(values.size).toBe(0);
    await expect(lifecycle.prepareForSignIn()).resolves.toBeUndefined();
  });

  it('blocks sign-in and retries cleanup if the prior vault could not be cleared', async () => {
    const { lifecycle, values, setFailVault } = makeLifecycle();
    setFailVault(true);
    await expect(lifecycle.signOut('member-a')).rejects.toThrow(/clear/i);
    expect(values.get('campkit.lifecycle.pending-clear.v1')).toBe('member-a');
    await expect(lifecycle.prepareForSignIn()).rejects.toThrow(/clear/i);
    setFailVault(false);
    await expect(lifecycle.prepareForSignIn()).resolves.toBeUndefined();
    expect(values.has('campkit.lifecycle.pending-clear.v1')).toBe(false);
  });

  it('keeps the current process blocked when the marker cannot be written and cleanup fails', async () => {
    const { lifecycle, values, setFailMarker, setFailVault } = makeLifecycle();
    setFailMarker(true);
    setFailVault(true);
    await expect(lifecycle.signOut('member-a')).rejects.toThrow(/clear/i);
    expect(values.has('campkit.lifecycle.pending-clear.v1')).toBe(false);
    setFailMarker(false);
    await expect(lifecycle.prepareForSignIn()).rejects.toThrow(/clear/i);
    setFailVault(false);
    await expect(lifecycle.prepareForSignIn()).resolves.toBeUndefined();
  });

  it('rejects a malformed persisted account marker rather than clearing an ambiguous vault', async () => {
    const { lifecycle, values, events } = makeLifecycle();
    values.set('campkit.lifecycle.pending-clear.v1', '../other-account');
    await expect(lifecycle.prepareForSignIn()).rejects.toThrow(/clear/i);
    expect(events).toEqual([]);
    expect(values.get('campkit.lifecycle.pending-clear.v1')).toBe('../other-account');
  });

  it('clears credentials on sign-out even when no account identity is available', async () => {
    const { lifecycle, events } = makeLifecycle();
    await lifecycle.signOut(null);
    expect(events).toEqual(['credentials']);
  });

  it('recovers a persisted cleanup marker before permitting a fresh sign-in', async () => {
    const { lifecycle, values, events } = makeLifecycle();
    values.set('campkit.lifecycle.pending-clear.v1', 'member-old');
    await lifecycle.prepareForSignIn();
    expect(events).toEqual(['credentials', 'selection:member-old', 'vault:member-old']);
    expect(values.has('campkit.lifecycle.pending-clear.v1')).toBe(false);
  });
});

import { describe, expect, it } from '@jest/globals';
import { AccountLifecycle } from '../account-lifecycle';

function makeLifecycle() {
  const values = new Map<string, string>();
  const events: string[] = [];
  let failVault = false;
  let failMarker = false;
  let failRecovery = false;
  const markerStore = {
    async getItemAsync(key: string) { if (failMarker) throw new Error('secure marker unavailable'); return values.get(key) ?? null; },
    async setItemAsync(key: string, value: string) { if (failMarker) throw new Error('secure marker unavailable'); values.set(key, value); },
    async deleteItemAsync(key: string) { if (failMarker) throw new Error('secure marker unavailable'); values.delete(key); },
  };
  const recoveryValues = new Map<string, string>();
  const recoveryStore = {
    async getItemAsync(key: string) { if (failRecovery) throw new Error('recovery store unavailable'); return recoveryValues.get(key) ?? null; },
    async setItemAsync(key: string, value: string) { if (failRecovery) throw new Error('recovery store unavailable'); recoveryValues.set(key, value); },
    async deleteItemAsync(key: string) { if (failRecovery) throw new Error('recovery store unavailable'); recoveryValues.delete(key); },
  };
  const createLifecycle = () => new AccountLifecycle({
    markerStore,
    recoveryStore,
    clearCredentials: async () => { events.push('credentials'); },
    clearSelection: async (memberId: string) => { events.push(`selection:${memberId}`); },
    clearVault: async (memberId: string) => { events.push(`vault:${memberId}`); if (failVault) throw new Error('vault unavailable'); },
  });
  return {
    lifecycle: createLifecycle(), createLifecycle, recoveryValues, values, events,
    setFailVault(value: boolean) { failVault = value; },
    setFailMarker(value: boolean) { failMarker = value; },
    setFailRecovery(value: boolean) { failRecovery = value; },
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

  it('keeps a fresh lifecycle blocked when the primary marker cannot be written and the vault cannot be cleared', async () => {
    const { lifecycle, createLifecycle, values, recoveryValues, setFailMarker, setFailVault } = makeLifecycle();
    setFailMarker(true);
    setFailVault(true);
    await expect(lifecycle.signOut('member-a')).rejects.toThrow(/clear/i);
    expect(values.has('campkit.lifecycle.pending-clear.v1')).toBe(false);
    expect(recoveryValues.get('campkit.lifecycle.recovery.v1')).toBe('member-a');
    // A new process sees an unreadable primary store and the mirrored record;
    // neither may be treated as "safe to sign in".
    const restarted = createLifecycle();
    await expect(restarted.prepareForSignIn()).rejects.toThrow(/verify|clear/i);
    setFailMarker(false);
    await expect(restarted.prepareForSignIn()).rejects.toThrow(/clear/i);
    setFailVault(false);
    await expect(restarted.prepareForSignIn()).resolves.toBeUndefined();
    expect(recoveryValues.has('campkit.lifecycle.recovery.v1')).toBe(false);
  });

  it('blocks a fresh lifecycle when only the vault cleanup fails and the marker was persisted', async () => {
    const { lifecycle, createLifecycle, values, setFailVault } = makeLifecycle();
    setFailVault(true);
    await expect(lifecycle.signOut('member-a')).rejects.toThrow(/clear/i);
    expect(values.get('campkit.lifecycle.pending-clear.v1')).toBe('member-a');
    const restarted = createLifecycle();
    await expect(restarted.prepareForSignIn()).rejects.toThrow(/clear/i);
  });

  it('refuses sign-out and sign-in when no durable barrier can be stored', async () => {
    const { lifecycle, createLifecycle, recoveryValues, setFailMarker, setFailRecovery } = makeLifecycle();
    setFailMarker(true);
    setFailRecovery(true);
    // Nothing durable records the teardown, so it must not claim success.
    await expect(lifecycle.signOut('member-a')).rejects.toThrow(/persist/i);
    expect(recoveryValues.size).toBe(0);
    // Nor may a fresh process assume the prior vault is clean.
    const restarted = createLifecycle();
    await expect(restarted.prepareForSignIn()).rejects.toThrow(/verify|clear/i);
    setFailMarker(false);
    setFailRecovery(false);
    await expect(restarted.prepareForSignIn()).resolves.toBeUndefined();
  });

  it('clears the recovery record on a fully successful sign-out', async () => {
    const { lifecycle, recoveryValues, values } = makeLifecycle();
    await lifecycle.signOut('member-a');
    expect(values.size).toBe(0);
    expect(recoveryValues.size).toBe(0);
  });

  it('refuses to guess when the barrier records name different accounts', async () => {
    const { lifecycle, recoveryValues, values, events } = makeLifecycle();
    values.set('campkit.lifecycle.pending-clear.v1', 'member-a');
    recoveryValues.set('campkit.lifecycle.recovery.v1', 'member-b');
    await expect(lifecycle.prepareForSignIn()).rejects.toThrow(/clear/i);
    expect(events).toEqual([]);
  });

  it('rejects a malformed persisted recovery record instead of permitting sign-in', async () => {
    const { lifecycle, recoveryValues, events } = makeLifecycle();
    recoveryValues.set('campkit.lifecycle.recovery.v1', '../other-account');
    await expect(lifecycle.prepareForSignIn()).rejects.toThrow(/clear/i);
    expect(events).toEqual([]);
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

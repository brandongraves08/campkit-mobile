export interface LifecycleMarkerStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

interface AccountLifecycleOptions {
  /** Primary secure marker store (e.g. `expo-secure-store`, or EncryptedSharedPreferences on Android). */
  markerStore: LifecycleMarkerStore;
  /** Optional independent durable store; must not share the marker store's failure mode. */
  recoveryStore?: LifecycleMarkerStore;
  clearCredentials(): Promise<void>;
  clearSelection(memberId: string): Promise<void>;
  clearVault(memberId: string): Promise<void>;
}

const PENDING_CLEAR_KEY = 'campkit.lifecycle.pending-clear.v1';
const RECOVERY_CLEAR_KEY = 'campkit.lifecycle.recovery.v1';
const MEMBER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

interface DurableRecord {
  store: LifecycleMarkerStore;
  key: string;
}

/**
 * Fail-closed account teardown.
 *
 * A durable "pending clear" record gates all future sign-in. The record is
 * written to the primary secure store and, when configured, mirrored to an
 * independent recovery store so a failure to persist one of them cannot hide
 * an uncleared vault from a freshly started process. If no durable store can
 * accept the record, sign-out rejects rather than assuming success.
 */
export class AccountLifecycle {
  private blockedMember: string | null = null;
  private readonly stores: DurableRecord[];

  constructor(private readonly options: AccountLifecycleOptions) {
    const stores: DurableRecord[] = [{ store: options.markerStore, key: PENDING_CLEAR_KEY }];
    if (options.recoveryStore) stores.push({ store: options.recoveryStore, key: RECOVERY_CLEAR_KEY });
    this.stores = stores;
  }

  private async findPersistedMember(): Promise<string | null> {
    const found = new Set<string>();
    for (const record of this.stores) {
      let value: string | null;
      try {
        value = await record.store.getItemAsync(record.key);
      } catch {
        // An unreadable store cannot prove that no cleanup is pending.
        throw new Error('Unable to verify the prior account cleanup state');
      }
      if (value === null) continue;
      if (!MEMBER_ID.test(value)) throw new Error('Unable to clear account data safely');
      found.add(value);
    }
    // Two different members imply one of the records is stale; refuse to guess
    // which vault is safe to keep.
    if (found.size > 1) throw new Error('Unable to clear account data safely');
    return found.size === 1 ? [...found][0] : null;
  }

  private async persistMember(memberId: string): Promise<void> {
    let persisted = false;
    for (const record of this.stores) {
      try {
        await record.store.setItemAsync(record.key, memberId);
        persisted = true;
      } catch {
        // A single durable record is enough to gate the next sign-in; the
        // cleanup below retries every store, so keep going.
      }
    }
    if (!persisted) throw new Error('Unable to persist the account cleanup barrier');
  }

  private async clearMember(memberId: string): Promise<void> {
    const failures: unknown[] = [];
    try { await this.options.clearCredentials(); } catch (error) { failures.push(error); }
    try { await this.options.clearSelection(memberId); } catch (error) { failures.push(error); }
    try { await this.options.clearVault(memberId); } catch (error) { failures.push(error); }
    if (failures.length) throw new Error('Unable to clear account data safely');
    await this.releaseBarrier();
    this.blockedMember = null;
  }

  private async releaseBarrier(): Promise<void> {
    const failures: unknown[] = [];
    let cleared = 0;
    for (const record of this.stores) {
      try {
        await record.store.deleteItemAsync(record.key);
        cleared += 1;
      } catch (error) {
        failures.push(error);
      }
    }
    if (cleared === 0 && failures.length > 0) throw new Error('Unable to clear account data safely');
  }

  async signOut(memberId: string | null): Promise<void> {
    const targetMember = memberId ?? this.blockedMember;
    if (targetMember !== null && !MEMBER_ID.test(targetMember)) throw new Error('Invalid member ID for account cleanup');
    if (targetMember === null) {
      // No account identity: only credentials can be revoked, nothing is left
      // to gate a future sign-in on.
      await this.options.clearCredentials();
      return;
    }
    this.blockedMember = targetMember;
    await this.persistMember(targetMember);
    await this.clearMember(targetMember);
  }

  async prepareForSignIn(): Promise<void> {
    if (this.blockedMember !== null) {
      await this.signOut(this.blockedMember);
      return;
    }
    const previousMember = await this.findPersistedMember();
    if (previousMember === null) return;
    this.blockedMember = previousMember;
    await this.clearMember(previousMember);
  }
}

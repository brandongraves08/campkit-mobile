export interface LifecycleMarkerStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

interface AccountLifecycleOptions {
  markerStore: LifecycleMarkerStore;
  clearCredentials(): Promise<void>;
  clearSelection(memberId: string): Promise<void>;
  clearVault(memberId: string): Promise<void>;
}

const PENDING_CLEAR_KEY = 'campkit.lifecycle.pending-clear.v1';
const MEMBER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Fail-closed account teardown. A persisted marker gates all future sign-in. */
export class AccountLifecycle {
  private blockedMember: string | null = null;

  constructor(private readonly options: AccountLifecycleOptions) {}

  async signOut(memberId: string | null): Promise<void> {
    const targetMember = memberId ?? this.blockedMember;
    if (targetMember !== null && !MEMBER_ID.test(targetMember)) throw new Error('Invalid member ID for account cleanup');
    if (targetMember !== null) this.blockedMember = targetMember;
    const failures: unknown[] = [];
    if (targetMember !== null) {
      try { await this.options.markerStore.setItemAsync(PENDING_CLEAR_KEY, targetMember); } catch (error) { failures.push(error); }
    }
    try { await this.options.clearCredentials(); } catch (error) { failures.push(error); }
    if (targetMember !== null) {
      try { await this.options.clearSelection(targetMember); } catch (error) { failures.push(error); }
      try { await this.options.clearVault(targetMember); } catch (error) { failures.push(error); }
    }
    if (failures.length) throw new Error('Unable to clear account data safely');
    if (targetMember !== null) await this.options.markerStore.deleteItemAsync(PENDING_CLEAR_KEY);
    this.blockedMember = null;
  }

  async prepareForSignIn(): Promise<void> {
    if (this.blockedMember !== null) {
      await this.signOut(this.blockedMember);
      return;
    }
    const previousMember = await this.options.markerStore.getItemAsync(PENDING_CLEAR_KEY);
    if (previousMember === null) return;
    if (!MEMBER_ID.test(previousMember)) throw new Error('Unable to clear account data safely');
    await this.signOut(previousMember);
  }
}

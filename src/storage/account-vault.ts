import { clearAccountDatabase, openAccountDatabase, CampKitDatabase } from './database';
import { OperationsRepository } from './operations-repository';
import { TripsRepository } from './trips-repository';

export interface AccountWorkspace {
  database: CampKitDatabase;
  trips: TripsRepository;
  operations: OperationsRepository;
}

/**
 * Owns the open account databases for the signed-in member only.
 *
 * Keeping the scope in one place means sign-out can close and wipe the exact
 * database that was in use before the next account opens one.
 */
export class AccountVault {
  private readonly workspaces = new Map<string, AccountWorkspace>();

  async openAccount(memberId: string, householdId: string): Promise<AccountWorkspace> {
    const existing = this.workspaces.get(memberId);
    if (existing && existing.database.householdId === householdId) return existing;
    if (existing) await this.closeAccount(memberId);

    const database = await openAccountDatabase(memberId, householdId);
    const workspace: AccountWorkspace = {
      database,
      trips: new TripsRepository(database),
      operations: new OperationsRepository(database),
    };
    this.workspaces.set(memberId, workspace);
    return workspace;
  }

  /** Closes the live handle first so the native database file can be deleted. */
  async clearAccount(memberId: string): Promise<void> {
    await this.closeAccount(memberId);
    await clearAccountDatabase(memberId);
  }

  async closeAccount(memberId: string): Promise<void> {
    const workspace = this.workspaces.get(memberId);
    if (!workspace) return;
    this.workspaces.delete(memberId);
    await workspace.database.close();
  }

  async closeAll(): Promise<void> {
    for (const memberId of [...this.workspaces.keys()]) await this.closeAccount(memberId);
  }
}

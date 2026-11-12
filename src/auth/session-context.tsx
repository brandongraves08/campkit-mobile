import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AuthClient, MemberSession } from './auth-client';
import { ApiClient, Household } from '../api/http';
import { TokenStore } from './token-store';
import * as SecureStore from 'expo-secure-store';
import { clearTripsForSignOut } from '../trips/trips-service';
import { AccountLifecycle } from '../app-lifecycle/account-lifecycle';
import { SqliteRecoveryStore } from '../app-lifecycle/recovery-store';

interface SessionContextValue {
  session: MemberSession | null; api: ApiClient; error: string | null;
  signIn(): Promise<void>; signOut(): Promise<void>; listHouseholds(): Promise<Household[]>; selectHousehold(id: string): Promise<void>; selectedHousehold(): Promise<string | null>;
}
const SessionContext = createContext<SessionContextValue | null>(null);
const sessionStore = new TokenStore(SecureStore);
const baseUrl = process.env.EXPO_PUBLIC_CAMPKIT_BASE_URL ?? '';
const clientId = process.env.EXPO_PUBLIC_CAMPKIT_OAUTH_CLIENT_ID ?? '';

export function SessionProvider({ children }: React.PropsWithChildren) {
  const [session, setSession] = useState<MemberSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const auth = useMemo(() => new AuthClient({ baseUrl: baseUrl || 'https://invalid.invalid', clientId, tokens: sessionStore }), []);
  const api = useMemo(() => new ApiClient({ baseUrl: baseUrl || 'https://invalid.invalid', refresh: () => auth.refreshSession(), sessionStore }), [auth]);
  const lifecycle = useMemo(() => new AccountLifecycle({
    markerStore: SecureStore,
    // Independent durable barrier: a keychain failure during teardown must not
    // let a restarted process offer sign-in over an uncleared vault.
    recoveryStore: new SqliteRecoveryStore(),
    clearCredentials: () => auth.signOut(),
    clearSelection: (memberId) => api.clearHouseholdSelection(memberId),
    clearVault: (memberId) => clearTripsForSignOut(memberId),
  }), [api, auth]);
  useEffect(() => {
    void lifecycle.prepareForSignIn()
      .then(() => sessionStore.load())
      .then(setSession)
      .catch(() => setError('Unable to safely restore the prior account. Please retry sign-in.'))
      .finally(() => setSessionReady(true));
  }, [lifecycle]);
  const value = useMemo<SessionContextValue>(() => ({
    session, api, error,
    async signIn() {
      if (!sessionReady) { setError('Restoring secure sign-in data. Please try again.'); return; }
      if (!baseUrl || !clientId) { setError('Configure the trusted HTTPS CampKit URL and OAuth client ID.'); return; }
      try {
        setError(null);
        if (session) {
          await lifecycle.signOut(session.memberId);
          setSession(null);
        } else await lifecycle.prepareForSignIn();
        setSession(await auth.signIn());
      } catch (e) { setSession(null); setError(e instanceof Error ? e.message : 'Sign-in failed'); }
    },
    async signOut() {
      const active = session ?? await sessionStore.load();
      try { await lifecycle.signOut(active?.memberId ?? null); setSession(null); setError(null); }
      catch { setSession(null); setError('Unable to clear secure sign-in data.'); throw new Error('Unable to clear secure sign-in data'); }
    },
    listHouseholds: () => api.listHouseholds(),
    selectHousehold: (id) => api.selectHousehold(id),
    selectedHousehold: () => api.selectedHousehold(),
  }), [session, api, auth, lifecycle, error, sessionReady]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

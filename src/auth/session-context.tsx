import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AuthClient, MemberSession } from './auth-client';
import { ApiClient, Household } from '../api/http';
import { TokenStore } from './token-store';
import * as SecureStore from 'expo-secure-store';

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
  useEffect(() => { void sessionStore.load().then(setSession).catch(() => setError('Secure sign-in data is unavailable. Please sign in again.')); }, []);
  const auth = useMemo(() => new AuthClient({ baseUrl: baseUrl || 'https://invalid.invalid', clientId, tokens: sessionStore }), []);
  const api = useMemo(() => new ApiClient({ baseUrl: baseUrl || 'https://invalid.invalid', refresh: () => auth.refreshSession(), sessionStore }), [auth]);
  const value = useMemo<SessionContextValue>(() => ({
    session, api, error,
    async signIn() {
      if (!baseUrl || !clientId) { setError('Configure the trusted HTTPS CampKit URL and OAuth client ID.'); return; }
      try { setError(null); setSession(await auth.signIn()); } catch (e) { setError(e instanceof Error ? e.message : 'Sign-in failed'); }
    },
    async signOut() {
      const active = session ?? await sessionStore.load();
      try { if (active) await api.clearHouseholdSelection(active.memberId); await auth.signOut(); setSession(null); setError(null); }
      catch { setError('Unable to clear secure sign-in data.'); throw new Error('Unable to clear secure sign-in data'); }
    },
    listHouseholds: () => api.listHouseholds(),
    selectHousehold: (id) => api.selectHousehold(id),
    selectedHousehold: () => api.selectedHousehold(),
  }), [session, api, auth, error]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}

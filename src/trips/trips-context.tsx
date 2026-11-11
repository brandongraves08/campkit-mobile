import { createContext, useContext, useMemo } from 'react';
import { useSession } from '../auth/session-context';
import { createTripsService, TripsService } from './trips-service';

const TripsContext = createContext<TripsService | null>(null);
export function TripsProvider({ children }: React.PropsWithChildren) {
  const { session, api } = useSession();
  const service = useMemo(() => session ? createTripsService(api, session.memberId, () => api.selectedHousehold()) : null, [api, session?.memberId]);
  return <TripsContext.Provider value={service}>{children}</TripsContext.Provider>;
}
export function useTrips(): TripsService {
  const service = useContext(TripsContext);
  if (!service) throw new Error('Sign in to open trips');
  return service;
}

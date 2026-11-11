import { Stack } from 'expo-router';
import { SessionProvider } from '../src/auth/session-context';
import { TripsProvider } from '../src/trips/trips-context';

export default function RootLayout() {
  return <SessionProvider><TripsProvider><Stack screenOptions={{ headerShown: false }} /></TripsProvider></SessionProvider>;
}

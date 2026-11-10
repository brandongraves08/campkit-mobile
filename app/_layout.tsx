import { Stack } from 'expo-router';
import { SessionProvider } from '../src/auth/session-context';

export default function RootLayout() {
  return <SessionProvider><Stack screenOptions={{ headerShown: false }} /></SessionProvider>;
}

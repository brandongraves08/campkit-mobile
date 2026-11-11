import { describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Text } from 'react-native';
import { SessionProvider, useSession } from '../session-context';
import { clearTripsForSignOut } from '../../trips/trips-service';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async () => JSON.stringify({ memberId: 'member-synthetic', accessToken: 'opaque', refreshToken: 'opaque', expiresAt: 9 })),
  setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('../../trips/trips-service', () => ({ clearTripsForSignOut: jest.fn(async () => {}) }));

function Harness() {
  const session = useSession();
  return <>{session.session ? <Text>{session.session.memberId}</Text> : null}<Button title="Sign out" onPress={() => void session.signOut()} /></>;
}

describe('member session cache cleanup', () => {
  it('clears the signed-in member encrypted trip cache before signing out', async () => {
    await render(<SessionProvider><Harness /></SessionProvider>);
    expect(await screen.findByText('member-synthetic')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Sign out' })); });
    expect(clearTripsForSignOut).toHaveBeenCalledWith('member-synthetic');
    expect(await screen.queryByText('member-synthetic')).toBeNull();
  });
});

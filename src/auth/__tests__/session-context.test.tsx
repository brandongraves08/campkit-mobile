import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Text } from 'react-native';
import { SessionProvider, useSession } from '../session-context';
import { clearTripsForSignOut } from '../../trips/trips-service';

jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  getItemAsync: jest.fn(async (key: string) => key === 'campkit.member-session.v1' ? JSON.stringify({ memberId: 'member-synthetic', accessToken: 'opaque', refreshToken: 'opaque', expiresAt: 9 }) : null),
  setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock('../../trips/trips-service', () => ({ clearTripsForSignOut: jest.fn(async () => {}) }));

function Harness() {
  const session = useSession();
  return <>{session.session ? <Text>{session.session.memberId}</Text> : null}{session.error ? <Text>{session.error}</Text> : null}<Button title="Sign in" onPress={() => void session.signIn()} /><Button title="Sign out" onPress={() => void session.signOut()} /></>;
}

describe('member session cache cleanup', () => {
  afterEach(() => {
    const { getItemAsync } = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock<(key: string) => Promise<string | null>> };
    getItemAsync.mockImplementation(async (key: string) => key === 'campkit.member-session.v1' ? JSON.stringify({ memberId: 'member-synthetic', accessToken: 'opaque', refreshToken: 'opaque', expiresAt: 9 }) : null);
  });

  it('does not start sign-in while secure account restoration is unresolved', async () => {
    const { getItemAsync } = jest.requireMock('expo-secure-store') as { getItemAsync: jest.Mock<(key: string) => Promise<string | null>> };
    getItemAsync.mockImplementation(() => new Promise(() => {}));
    await render(<SessionProvider><Harness /></SessionProvider>);
    fireEvent.press(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Restoring secure sign-in data. Please try again.')).toBeTruthy();
  });

  it('clears the signed-in member encrypted trip cache before signing out', async () => {
    await render(<SessionProvider><Harness /></SessionProvider>);
    expect(await screen.findByText('member-synthetic')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Sign out' })); });
    expect(clearTripsForSignOut).toHaveBeenCalledWith('member-synthetic');
    const { deleteItemAsync } = jest.requireMock('expo-secure-store') as { deleteItemAsync: jest.Mock };
    expect(deleteItemAsync).toHaveBeenCalledWith('campkit.member-session.v1');
    expect(deleteItemAsync).toHaveBeenCalledWith('campkit.selected-household.v1.member-synthetic');
    expect(await screen.queryByText('member-synthetic')).toBeNull();
  });
});

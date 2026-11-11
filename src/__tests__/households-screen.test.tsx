import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useSession } from '../auth/session-context';
import HouseholdsScreen from '../../app/households';

jest.mock('expo-router', () => ({ router: { replace: jest.fn() } }));
jest.mock('../auth/session-context', () => ({ useSession: jest.fn() }));

const session = { memberId: 'member-a', accessToken: 'opaque', refreshToken: 'opaque', expiresAt: 1 };
const listHouseholds = jest.fn<() => Promise<{ id: string; name: string }[]>>();
const selectedHousehold = jest.fn<() => Promise<string | null>>();
const selectHousehold = jest.fn<(id: string) => Promise<void>>();
const signOut = jest.fn<() => Promise<void>>();

beforeEach(() => {
  jest.clearAllMocks();
  selectedHousehold.mockResolvedValue(null);
  selectHousehold.mockResolvedValue(undefined);
  signOut.mockResolvedValue(undefined);
  (useSession as jest.MockedFunction<typeof useSession>).mockReturnValue({
    session, error: null, api: {} as never, signIn: async () => {}, signOut,
    listHouseholds, selectHousehold, selectedHousehold,
  });
});

describe('household selection screen states', () => {
  it('shows the empty state when the signed-in account has no households', async () => {
    listHouseholds.mockResolvedValue([]);
    await render(<HouseholdsScreen />);
    expect(await screen.findByText('No households are available for this account.')).toBeTruthy();
  });

  it('shows an accessible load failure and retries to the empty state', async () => {
    listHouseholds.mockRejectedValueOnce(new Error('network unavailable')).mockResolvedValueOnce([]);
    await render(<HouseholdsScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(/Households could not be loaded\./);
    await act(async () => {
      fireEvent.press(screen.getByText('Try again'));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(await screen.findByText('No households are available for this account.')).toBeTruthy();
    expect(listHouseholds).toHaveBeenCalledTimes(2);
  });
});

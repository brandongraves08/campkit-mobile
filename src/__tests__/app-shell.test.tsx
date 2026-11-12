import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import HomeScreen from '../../app/index';

describe('signed-out app shell', () => {
  it('shows a signed-out sign-in path without presenting a false loading state or making network requests', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await render(<HomeScreen />);

    expect(screen.getByText('CampKit')).toBeTruthy();
    expect(screen.getByText('Your trips, ready for camp.')).toBeTruthy();
    expect(screen.getByLabelText('Sign-in status')).toHaveTextContent('Signed out');
    expect(screen.getByText('Sign in to view your trips')).toBeTruthy();
    expect(screen.queryByLabelText('App loading status')).toBeNull();
    expect(screen.getByText('Sign in')).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

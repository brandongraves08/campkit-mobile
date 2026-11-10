import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import HomeScreen from '../../app/index';

describe('signed-out app shell', () => {
  it('shows CampKit branding and an explicit signed-out/loading state without network access', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    await render(<HomeScreen />);

    expect(screen.getByText('CampKit')).toBeTruthy();
    expect(screen.getByText('Your trips, ready for camp.')).toBeTruthy();
    expect(screen.getByLabelText('Sign-in status')).toHaveTextContent('Signed out');
    expect(screen.getByLabelText('App loading status')).toHaveTextContent('Loading your trips');
    expect(fetchSpy).not.toHaveBeenCalled();

    fetchSpy.mockRestore();
  });
});

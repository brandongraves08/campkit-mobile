import { describe, expect, it, jest } from '@jest/globals';
import { render } from '@testing-library/react-native';
import OAuthCallbackScreen from '../../app/oauth/callback';

jest.mock('expo-router', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Redirect: ({ href }: { href: string }) => React.createElement(Text, null, href) };
});

describe('OAuth callback route', () => {
  it('recognizes the registered callback and returns route handling to the sign-in screen', async () => {
    const result = await render(<OAuthCallbackScreen />);
    expect(result.getByText('/sign-in')).toBeTruthy();
  });
});

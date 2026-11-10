import { describe, expect, it } from '@jest/globals';
import { AUTH_REDIRECT_URI } from '../auth/redirect';
import appConfig from '../../app.json';

const config = appConfig.expo;

describe('native security configuration', () => {
  it('locks the native application identifiers and OAuth callback scheme', () => {
    expect(config.ios.bundleIdentifier).toBe('com.graveystudios.campkit');
    expect(config.android.package).toBe('com.graveystudios.campkit');
    expect(config.scheme).toBe('com.graveystudios.campkit');
    expect(AUTH_REDIRECT_URI).toBe('com.graveystudios.campkit://oauth/callback');
  });

  it('enables SQLCipher and keeps SecureStore on the native build path', () => {
    const sqlite = config.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-sqlite',
    );
    const secureStore = config.plugins.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === 'expo-secure-store',
    );

    expect(sqlite).toEqual(['expo-sqlite', { useSQLCipher: true }]);
    expect(secureStore).toEqual([
      'expo-secure-store',
      { configureAndroidBackup: true },
    ]);
  });
});

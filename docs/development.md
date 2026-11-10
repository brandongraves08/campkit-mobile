# Local development

## Verified toolchain matrix

The scaffold is pinned to the current stable Expo SDK 58 line and the package versions resolved in `package-lock.json`:

| Package | Locked version |
| --- | ---: |
| `expo` | 58.0.23 |
| `react` | 19.3.0 |
| `react-dom` | 19.3.0 |
| `react-native` | 0.88.1 |
| `react-native-safe-area-context` | 5.11.1 |
| `react-native-screens` | 4.30.1 |
| `expo-router` | 58.0.30 |
| `expo-sqlite` | 58.0.15 |
| `expo-secure-store` | 58.0.2 |
| `expo-system-ui` | 58.0.7 |
| `expo-auth-session` | 58.0.17 |
| `expo-web-browser` | 58.0.7 |
| `jest-expo` | 58.0.14 |
| `@testing-library/react-native` | 14.1.0 |
| `@types/jest` | 30.0.0 |
| TypeScript | 6.0.3 |

Expo's SDK 58 docs confirm that `expo-sqlite` has a built-in config plugin and that `useSQLCipher: true` enables SQLCipher for Android/iOS native builds. The plugin is set in `app.json`; CNG must apply it by generating/re-generating native projects and rebuilding the app. Expo warns that `PRAGMA key` is silently ignored when the binary lacks SQLCipher, including Expo Go. Before any household database is opened or written, a native app must query `PRAGMA cipher_version` and fail closed if it returns no row. This scaffold does not open a database or claim runtime encryption verification.

`expo-secure-store` uses Android Keystore-backed encrypted preferences and iOS Keychain. Its config plugin is enabled; Android backup configuration remains enabled with Expo's SecureStore-aware backup exclusions. OAuth is not implemented in this shell. The chosen Expo AuthSession/WebBrowser packages support browser-based OAuth flows and native redirect URIs; future auth must use the system browser and PKCE, validate `state`, and use the exact registered callback `com.graveystudios.campkit://oauth/callback`. No client secret, service token, password grant, or certificate-validation bypass belongs in the app.

Official Expo documentation checked for this matrix:

- [SQLite / SQLCipher and config plugin](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/)
- [AuthSession / browser OAuth and redirect URIs](https://docs.expo.dev/versions/latest/sdk/auth-session/)
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo SDK 58 changelog](https://expo.dev/changelog/sdk-58)

## Install, test, and run

Use Node.js 22.13 or newer within Expo's supported Node ranges and npm. Install exactly the lockfile versions and run tests/typecheck:

```sh
npm ci
npm test -- --runInBand
npm run typecheck
```

Native modules/config plugins require a custom development build, not Expo Go. With the local Android SDK or Xcode toolchain installed and a device/simulator available:

```sh
npx expo prebuild --platform android
npx expo run:android
# On macOS with Xcode:
npx expo prebuild --platform ios
npx expo run:ios
```

Re-run prebuild and rebuild after native dependency or app-config changes. Do not commit generated `android/` or `ios/` directories unless a reviewed native customization explicitly requires it; this repository uses CNG. Do not upload source or builds to a hosted builder without separate authorization.

This worker environment has no attached Android device (`adb devices -l` returned an empty device list), no `emulator` or `sdkmanager`, and no iOS/Xcode build tools. `npx expo prebuild --platform android --no-install` succeeded and generated `android/gradle.properties` with `expo.sqlite.useSQLCipher=true`, confirming the CNG plugin config is applied. No native binary was compiled, no SQLCipher `cipher_version` runtime probe was performed, and no device screenshot has been produced here. Do not treat unit tests, prebuild output, or a web preview as native runtime/security or visual acceptance. Validate SQLCipher on an authorized native development build before implementing or persisting offline household data.

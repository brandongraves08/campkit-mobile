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
| `expo-crypto` | 58.0.7 |
| `expo-system-ui` | 58.0.7 |
| `expo-auth-session` | 58.0.17 |
| `expo-web-browser` | 58.0.7 |
| `jest-expo` | 58.0.14 |
| `@testing-library/react-native` | 14.1.0 |
| `@types/jest` | 30.0.0 |
| TypeScript | 6.0.3 |

Expo's SDK 58 docs confirm that `expo-sqlite` has a built-in config plugin and that `useSQLCipher: true` enables SQLCipher for Android/iOS native builds. The plugin is set in `app.json`; CNG must apply it by generating/re-generating native projects and rebuilding the app. Expo warns that `PRAGMA key` is silently ignored when the binary lacks SQLCipher, including Expo Go. Before any household database is opened or written, the storage layer queries `PRAGMA cipher_version` and fails closed if it returns no row; see [Encrypted offline storage](#encrypted-offline-storage).

`expo-secure-store` uses Android Keystore-backed encrypted preferences and iOS Keychain. Its config plugin is enabled; Android backup configuration remains enabled with Expo's SecureStore-aware backup exclusions. Authentication uses system-browser Authorization Code + PKCE, validates callback state and the exact registered callback `com.graveystudios.campkit://oauth/callback`, and persists session credentials only through SecureStore. No client secret, service token, password grant, or certificate-validation bypass belongs in the app.

Set `EXPO_PUBLIC_CAMPKIT_BASE_URL` to the HTTPS origin of the self-hosted CampKit instance reachable on the authorized home LAN/VPN (origin only; no path), and `EXPO_PUBLIC_CAMPKIT_OAUTH_CLIENT_ID` to its registered public native OAuth client ID. The server-side OAuth Application record is provisioned separately; register the exact callback and `mobile:packing` scope. The current OAuth contract does not return a member ID, so the client creates a local account-scope identifier in the SecureStore session and clears that scope's household choice on sign-out; server membership remains enforced by every API request. Never use plaintext HTTP or expose the private service publicly.

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

The scaffold's Task 1 environment had no attached Android device; that limitation was resolved when the app was later run on an Android emulator (see [Encrypted offline storage](#encrypted-offline-storage)). `npx expo prebuild --platform android --no-install` generated `android/gradle.properties` with `expo.sqlite.useSQLCipher=true`, confirming the CNG plugin config is applied. Do not treat unit tests, prebuild output, or a web preview as native runtime/security or visual acceptance; the runtime evidence recorded below is the current source of truth.

## Encrypted offline storage

`src/storage/` implements Task 3 of the client plan.

- One SQLCipher database per member: `campkit-<memberId>.db` in `expo-sqlite`'s default directory. A member id must match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` and may not contain `..`, so it cannot escape the database directory; household, trip, entry, and operation ids must be UUIDs.
- The 256-bit key is generated with `expo-crypto` and stored in SecureStore under `campkit.db-key.v1.<memberId>` with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. A marker (`campkit.db-state.v1.<memberId>`) records the household that created the file. If the marker exists but the key does not, opening refuses instead of creating a fresh database over an undecryptable file.
- `PRAGMA key = "x'<hex>'"` is the first statement and is re-applied on every exclusive transaction connection, because SQLCipher keys are per connection. `PRAGMA cipher_version` must return a non-empty value and the `sqlite_master` probe must succeed; otherwise the handle is closed and opening rejects. There is no plaintext fallback.
- `migrations.ts` versions the schema with `PRAGMA user_version` (currently 1) and refuses a database written by a newer build. Tables hold minimum trip metadata, packing display/state/version rows, and the pending-operation queue. Every table is keyed by `member_id` + `household_id`, and every repository statement binds both.
- `clearAccountDatabase` deletes rows in one transaction, closes the handle, deletes the encrypted file, and only then removes the key and marker. Any failure before the file is removed rejects and keeps the key so a retry can finish; repeating a completed clear is a no-op. `AccountVault` owns open handles, closes them before clearing, and reopens on a household change.
- Tokens never enter this layer: storage modules do not import the auth/token store. Operation status is limited to `pending | conflict | needs_attention` by runtime validation and a SQL `CHECK`.

Native verification on the Android 16 emulator against a debug build of this worktree (`PRAGMA cipher_version` = `4.17.0 community`): opening an account database, saving and reading a synthetic trip snapshot, queueing a pending operation, closing and reopening (snapshot and queue retained), deleting the SecureStore key (reopen denied), clearing, and reopening an empty database all behaved as above. The pulled on-device file began with random bytes rather than `SQLite format 3` and contained none of the synthetic trip/packing labels or table names; SecureStore held keystore-AES entries. The temporary probe route used for the check was removed; its capture is `docs/screenshots/storage-probe-android.png`. iOS remains untested.

Storage tests run real SQL through a test-only `node:sqlite` adapter while the SQLCipher PRAGMAs are shimmed; only the emulator run proves actual at-rest encryption. `node:sqlite` needs the Node build used here (22.23) or newer. Run the tests with `npm test -- --runInBand src/storage/__tests__`, then `npm run typecheck`.

## Live end-to-end verification (2026-11-12)

Exercised against a debug build of this worktree on an Android 16 emulator (`sdk_gphone64_x86_64`, 360×800 at density 160), with the JS bundle served by Metro from this worktree and `EXPO_PUBLIC_CAMPKIT_BASE_URL` / `EXPO_PUBLIC_CAMPKIT_OAUTH_CLIENT_ID` pointing at a self-hosted CampKit sandbox over HTTPS on the home LAN. All household, trip, and packing records were synthetic and were deleted from the sandbox afterwards.

Steps actually run, in order:

1. Signed-out landing screen, "Sign in" → "Continue in browser".
2. Browser custom tab opened `/o/authorize/` with PKCE S256; the internal development CA had to be installed as a user CA on the emulator — a browser custom tab uses platform trust, not the app's debug `network-security-config`.
3. Signed in, approved the `mobile:packing` scope, and the `com.graveystudios.campkit://oauth/callback` deep link returned to the app with the session stored.
4. Household chooser listed the member's household; selecting it opened Trips.
5. Downloaded a trip; it moved to "Downloaded trips" with "Downloaded for offline use".
6. Opened the offline copy (3 gear rows, none packed) and toggled one row — it showed "Pending sync · Packed" and stayed local.
7. Returned to the foreground; the queue drained and the screen showed "All packing changes synced".
8. Disabled Wi-Fi and mobile data (`svc wifi disable`, `svc data disable`, confirmed `Active default network: none`), toggled a second row while offline, and confirmed the pending state.
9. Re-enabled both radios; `onConnectionRestored` woke the queue without any user action and the screen returned to "All packing changes synced".

Server-side read-back after each write (rather than trusting the UI): `TripGear.packed` and `TripGear.version` moved from `False/1` to `True/2` per row, with one idempotent `PackingOperation` row per accepted write, and the client's pending queue emptied. Two rows were synced this way, the third through the same path during a later reconnect.

### Backend defect found and fixed by this run

The packing write endpoint (`PUT /api/mobile/v1/households/<id>/trips/<id>/packing/<entry>/`) was **not** CSRF-exempt. Django's CSRF middleware applies to unsafe methods regardless of how the request authenticates, so every write from the app returned `403 CSRF verification failed` (HTML, not the documented error envelope) while every read worked — GETs are unaffected. The backend's own tests did not catch it because Django's test client skips CSRF checks unless `enforce_csrf_checks=True`.

The fix is a `@csrf_exempt` on that view in the CampKit backend plus a regression test that issues the write from a `Client(enforce_csrf_checks=True)`. CSRF protection is meaningless on this endpoint: it authenticates with a bearer token and never uses session cookies. The client's queue treats that unenveloped 403 as an unmapped error, so the failure surfaced to the user as a paused sync rather than an HTTP error.

### Known limitations recorded by this run

- **iOS is unverified.** No iOS build or simulator was available; every native claim here is Android only.
- **A packing write is never retried after a `401`.** `ApiClient.request` refreshes the session and retries only for `GET`, and `SyncEngine` pauses the queue on `unauthorized`. Because access tokens are short-lived (900 s in the sandbox), a change made after the token expires can sit pending until some other authenticated `GET` refreshes the session. The trip screen has no pull-to-refresh, so going back to Trips is what recovers it.
- **The paused-sync message over-claims.** `SyncEngine` sets `paused` both for auth rejections and for errors it cannot map, and the trip screen always renders "Sync paused · Household membership was revoked". An unmapped server fault therefore reads as a revoked membership.
- **The root route is static.** `/` always renders the signed-out landing screen even when a session is restored in SecureStore; the restored session only takes effect on the next screen (`/sign-in` redirects onward). A relaunch shows "Signed out" for one tap without actually losing the session.
- **Debug builds show Metro's warning banner** ("Open debugger to view warnings") over the UI; it is a development-client artifact and is absent from a release build.

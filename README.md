# CampKit Mobile

A separate iPhone and Android app that connects to the existing CampKit backend. This repository is for the mobile client; the Django backend remains in the existing CampKit repository.

## Confirmed first-release requirements

- A purpose-built native mobile client, not a wrapper around the CampKit website.
- At camp, download selected trips and their gear while connected.
- Offline, mark gear packed or unpacked; synchronize those status changes when connectivity returns.
- Deliver the first usable builds privately to the household: TestFlight for iOS and Google Play internal testing for Android.
- Public App Store and Google Play listings are a later release target, after the private beta.

## Security and sync constraints

- Keep the production CampKit backend private behind its existing trusted network/VPN path. Store distribution is not permission to expose production.
- Do not embed or reuse the shared Hermes service credential. The app requires member-level authentication and household authorization.
- Design an idempotent, household-scoped sync queue with visible pending/error state and explicit conflict behavior before implementing offline writes.
- Do not upload private source to hosted build services without explicit approval.

## Proposed implementation direction

Expo + React Native + TypeScript is the current recommendation for one native iOS/Android client. This is a proposal, not an approved implementation design. Confirm the design and API/auth/sync contract before scaffolding the app or adding dependencies.

## Project status

The native Expo/React Native client implements member sign-in with OAuth PKCE, household/trip views, encrypted offline packing, and queued sync/conflict handling. Client tests (155 across 21 suites), typecheck, the Android debug build, and the backend mobile-API suite (57 tests) pass.

On 2026-11-12 the full path was exercised on an Android 16 emulator against a self-hosted CampKit sandbox: browser PKCE sign-in and callback, household selection, trip download, offline packing change, and automatic sync on reconnect — with the server rows and versions read back to confirm each write. That run also found and fixed a backend defect: the packing write endpoint was not CSRF-exempt, so every `PUT` was rejected with `403 CSRF verification failed` even though the endpoint is bearer-token, cookie-free.

Still open before a private beta: native iOS QA against an iOS build (no iOS runtime in this environment), and the known limitations listed in [local development](docs/development.md#live-end-to-end-verification-2026-11-12). No build has been submitted to TestFlight or Google Play internal testing.

## Development documentation and screenshots

See [local development and verification](docs/development.md) for setup, native build, test commands, OAuth configuration, storage/security notes, and the evidence currently available. Verified Android screenshots from the 2026-11-12 live run (360×800, synthetic household data):

- [Signed-out Android app](docs/screenshots/t7-android-signed-out-live-2026-11-12.png) — live Android 16 emulator capture after the signed-out/loading-state fix.
- [Household chooser after sign-in](docs/screenshots/t7-android-households-2026-11-12.png) — restored session, one household selected.
- [Trips screen](docs/screenshots/t7-android-trips-downloaded-2026-11-12.png) — a trip stored for offline use.
- [Packing list after sync](docs/screenshots/t7-android-trip-synced-2026-11-12.png) — three items packed, "All packing changes synced".
- [Encrypted-storage probe](docs/screenshots/storage-probe-android.png) — synthetic native SQLCipher verification screen.

These captures show the app's own screens; they do not by themselves prove the backend write, which is recorded as read-back row state and versions in [local development](docs/development.md#live-end-to-end-verification-2026-11-12).

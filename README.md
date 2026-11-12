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

The native Expo/React Native client is implemented as a **local-only integration candidate**. It includes member sign-in with OAuth PKCE, household/trip views, encrypted offline packing, and queued sync/conflict handling. Client tests, typecheck, Android build/install, and a signed-out-screen visual check pass. Final acceptance is still open: live Android OAuth/backend and sync scenarios plus native iOS QA have not been verified; this candidate has not been published or distributed.

## Development documentation and screenshots

See [local development and verification](docs/development.md) for setup, native build, test commands, OAuth configuration, storage/security notes, and the evidence currently available. Verified Android screenshots:

- [Signed-out Android app at 360×800](docs/screenshots/t7-android-signed-out-live-2026-11-12.png) — live Android 16 emulator capture after the signed-out/loading-state fix.
- [Encrypted-storage Android probe](docs/screenshots/storage-probe-android.png) — synthetic native SQLCipher verification screen.

The signed-out screenshot verifies presentation only; it is not evidence of a successful OAuth login or live household data flow.

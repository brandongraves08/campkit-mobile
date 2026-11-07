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

Research and requirements capture only. No mobile client code, backend changes, device builds, or store submissions have been made yet.

## Development documentation

The setup guide, feature guides, and verified screenshots will be added with the app implementation. Until then, there is no runnable app or development setup to document.

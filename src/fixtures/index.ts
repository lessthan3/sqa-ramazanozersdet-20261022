// src/fixtures/index.ts
//
// The canonical import for spec files:
//
//   import { test, expect } from "@/fixtures";   // or a relative path
//
// Re-exports the most-extended `test` (auth + incognito fixtures merged in)
// plus `expect`. Specs should not import from `./base`, `./auth`, or
// `./incognito` directly — that defeats the whole point of having a single
// chain.
//
// The chain: incognito extends auth extends base.
//   base      — patchright launchPersistentContext + storageState-at-launch
//   auth      — adminPage / viewerPage role fixtures (authenticated shell)
//   incognito — openViewerPage / openAnonymousPage second-context factories
//
// When you add fixtures (e.g. a data fixture that seeds a paywalled video page),
// append them to the chain and update the export here — no spec changes
// required.

export { test, expect } from './incognito';
export type { Role } from './auth';
export type { OpenViewerPage, OpenAnonymousPage } from './incognito';

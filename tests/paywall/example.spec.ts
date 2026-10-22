// tests/paywall/example.spec.ts
//
// Starter skeleton for the challenge — see CHALLENGE.md in this directory.
//
// This file exists so `npm run test:paywall` has something to collect on day
// zero and so you can see the shape of a spec on this framework:
//
//   * `adminPage` — already authenticated as admin, on BASE_URL, cookie
//     banner dismissed (see src/fixtures/auth.ts).
//   * `openAnonymousPage` — spawns a SECOND, isolated anonymous context
//     inside the test, for viewer-perspective assertions
//     (see src/fixtures/incognito.ts).
//
// The URL of the video page under test is provided by your interviewer —
// where you keep it (and how you avoid copy-pasting it into every spec) is
// up to you.
//
// Replace the fixme test below with your real suite. Delete this header
// when you do — your spec headers should explain YOUR intent.

import { test, expect } from '../../src/fixtures';
import { AdminBar } from '../../src/pages/AdminBar';

test('example: admin shell renders (replace me)', async ({ adminPage }) => {
  const bar = new AdminBar(adminPage);
  expect(await bar.isVisible()).toBe(true);
});

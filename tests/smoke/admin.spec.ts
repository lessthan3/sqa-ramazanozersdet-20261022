// tests/smoke/admin.spec.ts
//
// Phase 3.6 split of the original tests/smoke/auth.spec.ts.
// Routes to the chromium-admin project per the testMatch in
// playwright.config.ts.
//
// Two tests in this file:
//   1. admin can log in              — adminPage fixture + AdminBar visible
//   2. logout returns to anonymous   — adminPage + UserProfileDropdown.logout()
//
// Both rely on the chromium-admin project having loaded .auth/admin.json
// at launch (via the project's `use.storageState`). No per-test
// authentication is performed.
//
// Auth state is verified via the #admin-bar marker only, matching the
// UI-test approach — no dependency on isSiteLoginEnabled or the login button.

import { test, expect } from '../../src/fixtures';
import { AdminBar } from '../../src/pages/AdminBar';
import { UserProfileDropdown } from '../../src/pages/UserProfileDropdown';
import { env } from '../../src/utils/env';

// Hybrid C stance (post-5C item #2): smoke specs retry once to absorb
// environmental blips; mutation specs in admin/ run with strict no-retry.
// See playwright.config.ts header for the full rationale.
test.describe.configure({ retries: 1 });

test.describe('admin smoke', () => {
  test('admin can log in', async ({ adminPage }) => {
    // adminPage is pre-authed via storageState; navigate to the app
    // and assert the admin shell renders.
    await adminPage.goto(env.BASE_URL);

    const bar = new AdminBar(adminPage);
    const profile = new UserProfileDropdown(adminPage);

    await bar.waitForVisible();
    expect(await bar.isVisible()).toBe(true);
    expect(await profile.triggerIsVisible()).toBe(true);
  });

  test('logout returns user to anonymous state', async ({ adminPage }) => {
    await adminPage.goto(env.BASE_URL);

    const profile = new UserProfileDropdown(adminPage);
    const bar = new AdminBar(adminPage);
    await bar.waitForVisible();

    await profile.logout();

    // Navigate back and confirm anonymous state: the admin bar must be gone.
    await adminPage.goto(env.BASE_URL);
    expect(await bar.isVisible()).toBe(false);
  });
});

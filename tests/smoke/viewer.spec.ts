// tests/smoke/viewer.spec.ts
//
// Phase 3.6 split of the original tests/smoke/auth.spec.ts.
// Routes to the chromium-viewer project per the testMatch in
// playwright.config.ts.
//
// One test: viewer can log in — viewerPage + UserProfileDropdown visible +
// AdminBar NOT visible. The viewerPage fixture is a thin alias for the
// base page; authentication comes from the project's
// `use.storageState: '.auth/viewer.json'` declaration.

import { test, expect } from '../../src/fixtures';
import { AdminBar } from '../../src/pages/AdminBar';
import { UserProfileDropdown } from '../../src/pages/UserProfileDropdown';
import { env } from '../../src/utils/env';

// Hybrid C stance (post-5C item #2): smoke specs retry once to absorb
// environmental blips. See playwright.config.ts header for rationale.
test.describe.configure({ retries: 1 });

test.describe('viewer smoke', () => {
  // Skip the entire suite at the describe level so the viewerPage fixture
  // (which probes for the auth marker) never runs when VIEWER_USER is absent.
  // test.skip() at describe body level conditionally skips all enclosed tests.
  test.skip(!env.VIEWER_USER, 'VIEWER_USER not set — viewer storageState is anonymous');

  test('viewer can log in', async ({ viewerPage }) => {

    await viewerPage.goto(env.BASE_URL);

    const bar = new AdminBar(viewerPage);
    const profile = new UserProfileDropdown(viewerPage);

    await profile.waitForTriggerVisible();
    expect(await profile.triggerIsVisible()).toBe(true);
    expect(await bar.isVisible()).toBe(false);
  });
});

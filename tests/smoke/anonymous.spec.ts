// tests/smoke/anonymous.spec.ts
//
// Verifies that an anonymous (unauthenticated) visitor can load the channel
// without the admin shell appearing. Auth state is confirmed the same way as
// UI tests: via the #admin-bar marker, not the login-modal trigger (which is
// only rendered when the site has a login method configured).

import { test, expect } from '../../src/fixtures';
import { env } from '../../src/utils/env';
import { AdminBar } from '../../src/pages/AdminBar';
import { CookieBanner } from '../../src/pages/CookieBanner';

// Hybrid C stance (post-5C item #2): smoke specs retry once to absorb
// environmental blips. See playwright.config.ts header for rationale.
test.describe.configure({ retries: 1 });

test.describe('anonymous smoke', () => {
  test('anonymous user can view the channel without admin shell', async ({ page }) => {
    await page.goto(env.BASE_URL);

    const banner = new CookieBanner(page);
    await banner.dismissIfPresent();

    // Anonymous visitors must NOT see the admin bar.
    const bar = new AdminBar(page);
    expect(await bar.isVisible()).toBe(false);
  });

});

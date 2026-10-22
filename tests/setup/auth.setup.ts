// tests/setup/auth.setup.ts
//
// UI login bootstrap — deliberately VISIBLE. Runs are headed + slowMo by
// default in this template, and this setup project is where you watch the
// admin actually log in: open the auth modal, type the email, type the
// password, land in the admin shell. It runs once at the start of every
// invocation; the role-bound projects then load the dumped storageState at
// launch so individual tests start already authenticated.
//
// `.auth/<role>.json` is a PER-RUN handoff, not a cache: beforeAll wipes
// the previous run's dumps, so credentials never persist between runs —
// every run performs the login flow again, on screen.
//
// (The production suite bootstraps via `loginViaApi` in src/api/auth.ts —
// ~300ms, no browser. It's kept in the repo as reference; swap it back in
// if you ever want silent, fast bootstrap.)

import { test as setup, expect } from '../../src/fixtures';
import { authPath } from '../../src/fixtures/auth';
import { AuthModal } from '../../src/pages/AuthModal';
import { CookieBanner } from '../../src/pages/CookieBanner';
import { env } from '../../src/utils/env';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'patchright/test';
import type { Role } from '../../src/fixtures/auth';

const AUTH_DIR = resolve('.auth');

setup.beforeAll(async () => {
  // Fresh handoff every run — no session persistence across runs.
  await rm(authPath('admin'), { force: true });
  await rm(authPath('viewer'), { force: true });
  await mkdir(AUTH_DIR, { recursive: true });
});

/** Drive the real login UI, verify the role's shell, dump storageState. */
async function loginViaUiAndDump(
  page: Page,
  role: Role,
  email: string,
  password: string,
  marker: string,
): Promise<void> {
  // Both setup tests share one persistent worker context, so the admin
  // session is still live when the viewer logs in — no "Log in" trigger
  // renders and AuthModal.open() times out. Start each role from a clean
  // session (consent is re-seeded by the context's init script).
  // The first navigation only needs the origin (localStorage is per-origin),
  // so stop at 'commit' — a second full 'load' doubles exposure to dev's
  // occasional never-firing load event (seen 2026-10-22: reload hung 60s).
  await page.context().clearCookies();
  await page.goto(env.BASE_URL, { waitUntil: 'commit' });
  await page.evaluate(() => localStorage.clear());
  await page.goto(env.BASE_URL);
  await new CookieBanner(page).dismissIfPresent();

  const auth = new AuthModal(page);
  await auth.login(email, password);

  await expect(page.locator(marker)).toBeVisible({ timeout: 45_000 });
  await page.context().storageState({ path: authPath(role) });
  // eslint-disable-next-line no-console
  console.log(`[auth.setup] ${role}: UI login succeeded, storageState dumped`);
}

setup('log in as admin (watch the auth modal)', async ({ page }) => {
  await loginViaUiAndDump(page, 'admin', env.ADMIN_USER, env.DEFAULT_PASS, '#admin-bar');
});

const emptyStorageState = JSON.stringify({ cookies: [], origins: [] }, null, 2);

setup('log in as viewer (watch the auth modal)', async ({ page }) => {
  if (!env.VIEWER_USER || !env.VIEWER_PASS) {
    // Write empty storageState so chromium-viewer can launch without
    // crashing on a missing file; its specs soft-skip.
    await writeFile(authPath('viewer'), emptyStorageState);
    setup.skip(true, 'VIEWER_USER not set — viewer storageState not created.');
    return;
  }
  await loginViaUiAndDump(
    page,
    'viewer',
    env.VIEWER_USER,
    env.VIEWER_PASS,
    '[data-testid="userProfileViewButton"]',
  );
});

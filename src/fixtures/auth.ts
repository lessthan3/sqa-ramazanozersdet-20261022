// src/fixtures/auth.ts
//
// Phase 3.6 (2026-05-22): role fixtures are now thin aliases.
//
// The architectural redesign moved storage-state loading to launch time —
// each Playwright project (chromium-admin, chromium-viewer, chromium-anonymous)
// declares its own `use.storageState` and the worker fixture in base.ts
// forwards it into `launchPersistentContext`. By the time a test runs, the
// page is already authenticated; no per-test injection is needed.
//
// What disappeared from Phase 2's auth.ts:
//   * `applyRoleToContext()`              — gone (state was injected per-test)
//   * `refreshStorageState()`              — moved to tests/setup/auth.setup.ts
//   * `clearCookies + addCookies + reload` — gone (state-at-launch handles it)
//   * Per-test page about:blank drain      — gone (was a Phase 3.5 band-aid)
//
// What remains:
//   * The `Role` type — referenced by setup spec, kept stable for consumers.
//   * `credsForRole(role)` helper — used by the setup spec for UI logins.
//   * `adminPage` / `viewerPage` / `producerPage` fixtures — role-bound
//     pages that GUARANTEE a banner-free shell as a precondition. They
//     navigate to BASE_URL, dismiss the cookie banner once if it renders,
//     and yield the page. Helpers MUST NOT redo this work — the fixture
//     is the proactive setup boundary; helpers are happy-path-only.
//
// Phase 4.2 (2026-05-22) — fixture-setup ownership:
//
//   Before 4.2 the `tempChannel` data fixture was navigating to BASE_URL
//   and dismissing the cookie banner itself. That violated the
//   happy-path invariant ("fixtures own setup proactively; helpers do
//   not dismiss things reactively"). The role-page fixture is the right
//   boundary — every admin/viewer test gets a banner-free shell whether
//   it uses `tempChannel` or not.
//
// Phase 4.2 recovery (2026-05-22) — auth-shell ownership:
//
//   The Phase 4.2 substrate change (chromium-admin: workers:1 +
//   fullyParallel:false) collapsed every admin test into ONE shared
//   BrowserContext for the lifetime of the suite. A `logout()` in
//   `log-in-and-out-admin.spec.ts` (or smoke admin's logout test) now
//   clears the auth tokens in localStorage for EVERY subsequent admin
//   test in the same worker — a side effect that previously stayed
//   isolated to its own worker context under multi-worker concurrency.
//
//   Per happy-path principle 3 ("fixtures own setup proactively"), the
//   adminPage / viewerPage fixtures are the right place to guarantee
//   not just a banner-free shell but an AUTHENTICATED shell. Strategy:
//     1. Navigate to BASE_URL. Dismiss cookie banner if present.
//     2. Probe for the role's auth marker (admin: `#admin-bar`;
//        viewer: `[data-testid="userProfileViewButton"]`). If visible
//        within `AUTH_PROBE_MS`, yield — happy path, nothing to do.
//     3. If not visible, the prior test's logout cleared the session.
//        Re-apply the dumped storageState to the shared context
//        (`applyStorageState`, idempotent), reload, re-probe with a
//        full wait budget. If still not authenticated, throw loudly —
//        the suite is in a state the fixture can't honestly satisfy.
//
//   This is NOT a try/catch bandage — it's a deterministic probe with
//   a real recovery action. No timeouts swallowed, no errors hidden;
//   if storageState restoration fails, the fixture surfaces the bug.

import { test as base, applyStorageState } from './base';
import type { Page } from 'patchright/test';
import { resolve, join } from 'node:path';
import { env } from '../utils/env';
import { CookieBanner } from '../pages/CookieBanner';
import type { Role } from '../utils/roleCreds';

// Role identity + credential resolution live in a RUNNER-NEUTRAL module
// (src/utils/roleCreds.ts) so src/api/* can use them without dragging
// patchright/test into the vanilla-runner lanes (webkit/firefox). Re-exported
// here so every existing `from './auth'` consumer is unchanged.
export type { Role, RoleCreds } from '../utils/roleCreds';
export { credsForRole } from '../utils/roleCreds';

type AuthFixtures = {
  adminPage: Page;
  viewerPage: Page;
};

const AUTH_DIR = resolve('.auth');

/** Filesystem path for a role's storageState dump. */
export function authPath(role: Role): string {
  return join(AUTH_DIR, `${role}.json`);
}

/**
 * Role-aliased page fixtures. Authentication happens at the project level
 * (storageState-at-launch), not in these fixtures. They exist so specs
 * can declare their role intent at the signature level
 * (`async ({ adminPage }) => ...`) and so Phase 2's spec authors don't
 * need to rewrite signatures.
 *
 * If a spec using `{ adminPage }` is routed to a project that doesn't
 * load admin storageState, the page will simply be unauthenticated —
 * the test will fail on the first auth-protected assertion. Project
 * configuration in playwright.config.ts is the source of truth for
 * which storageState a worker loads.
 *
 * Phase 4.2 — proactive shell setup:
 *   adminPage / viewerPage navigate to BASE_URL and dismiss the
 *   cookie banner once before yielding. The CookieBanner POM polls
 *   for the reject button up to 5s; absence is a clean no-op. Helpers
 *   downstream of this fixture MAY assume:
 *     - the page is on BASE_URL (the admin shell, for adminPage)
 *     - the cookie banner is gone (or was never there)
 *   They MUST NOT redo this dismissal — that's a bandage.
 */
/**
 * Per-role authenticated marker. Visible iff the role's storageState
 * produced an authenticated session.
 *   admin:  the admin shell renders `#admin-bar`
 *   viewer: any authenticated user has `userProfileViewButton`
 */
function authMarkerSelector(role: Role): string {
  switch (role) {
    case 'admin':
      return '#admin-bar';
    case 'viewer':
      return '[data-testid="userProfileViewButton"]';
    default:
      throw new Error(`[fixtures/auth] unknown role: ${String(role)}`);
  }
}

/** Short probe window — happy path is "marker already there". */
const AUTH_PROBE_MS = 5_000;
/** Full wait after a storageState restore — gives the app a real cold-load budget. */
const AUTH_RESTORE_WAIT_MS = 30_000;

/**
 * Phase 5C (2026-05-22) — exported so `src/fixtures/incognito.ts` can reuse
 * the same proactive-setup contract on the fresh BrowserContexts it spawns
 * via `openViewerPage()` / `openAnonymousPage()`. The function is generic
 * over role (admin / viewer / producer); the same probe + storageState
 * restore path applies whether the page lives on the worker's role-pinned
 * context (admin/viewer specs) or on a per-call incognito context (mixed-role
 * specs that need an admin actor PLUS a viewer perspective).
 *
 * Originally private to this file; the body is unchanged.
 */
export async function readyAuthenticatedShell(
  page: Page,
  role: Role,
): Promise<void> {
  await page.goto(env.BASE_URL);
  const banner = new CookieBanner(page);
  await banner.dismissIfPresent();

  const marker = page.locator(authMarkerSelector(role));
  // Happy path: marker visible within probe window — yield immediately.
  try {
    await marker.waitFor({ state: 'visible', timeout: AUTH_PROBE_MS });
    return;
  } catch {
    // Fall through to the restore path. Not an error swallow — the
    // recovery action below is deterministic and re-asserts the marker
    // with a full budget; if it still fails, that throw is the bug.
  }

  // Recovery path: a prior test cleared the auth tokens from this
  // worker's shared context. Re-hydrate from the dumped storageState
  // and reload.
  await applyStorageState(page.context(), authPath(role), env.BASE_URL);
  await page.reload();
  // After reload, the cookie banner might re-render (storageState
  // doesn't include the banner-dismissal localStorage key on every
  // setup run). Dismiss again if present, then re-probe with the full
  // budget.
  await banner.dismissIfPresent();
  await marker.waitFor({ state: 'visible', timeout: AUTH_RESTORE_WAIT_MS });
}

export const test = base.extend<AuthFixtures>({
  adminPage: async ({ page }, use) => {
    await readyAuthenticatedShell(page, 'admin');
    await use(page);
  },
  viewerPage: async ({ page }, use) => {
    await readyAuthenticatedShell(page, 'viewer');
    await use(page);
  },
});

export { expect } from './base';

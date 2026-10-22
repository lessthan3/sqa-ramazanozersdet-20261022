// src/fixtures/incognito.ts
//
// Phase 5C (2026-05-22) — per-test incognito-context factories.
//
// Why this exists
// ----------------
//
// The Phase 3.6 architectural redesign pins every worker to ONE role for
// its lifetime. `chromium-admin` workers load `.auth/admin.json` at launch;
// `chromium-viewer` workers load `.auth/viewer.json`; they never swap. That
// eliminates the Phase 2/3 teardown stall, but it also means an admin spec
// CANNOT switch into a viewer perspective mid-test — the worker IS the
// admin context.
//
// Some assertions genuinely need both perspectives in the same test:
//
//   * A channel is marked private from the admin side → assert it 404s
//     from a fresh viewer's perspective.
//   * An offline channel image is uploaded by admin → assert a fresh
//     viewer (no admin shell) sees the image rendered.
//   * Anything that asserts "X is hidden from non-admins" — needs a real
//     non-admin context to make the assertion meaningful (a logged-out
//     admin still has stale tokens in the worker's persistent profile).
//
// Phase 4.2 ports 2 (`set-offline-channel-image`) and 4
// (`set-channel-as-private-and-public`) deferred these assertions for
// exactly this reason. This fixture removes that block.
//
// Shape
// -----
//
// `openViewerPage()` — returns a `Promise<Page>` opened against a brand-new
// BrowserContext hydrated with `.auth/viewer.json`. The cookie banner is
// dismissed and the viewer auth-marker is probed before the page is
// yielded — same contract `viewerPage` provides for role-pinned specs.
//
// `openAnonymousPage()` — companion factory for the "fresh anonymous user"
// pattern (no storageState, no auth marker probed, cookie banner still
// dismissed). Useful for assertions like "an anonymous visitor sees the
// login modal on a private channel".
//
// Both factories are callable repeatedly in a single test (e.g. spawn a
// viewer AND an anonymous user to verify both visibility rules in one
// flow). Every context created by the factory is tracked and closed at
// fixture teardown, so the test body never needs to manage lifecycle.
//
// Why launchPersistentContext (not browser.newContext)
// ----------------------------------------------------
//
// Patchright stealth only holds under `launchPersistentContext` +
// `channel: "chrome"` — see `src/fixtures/base.ts` header. A regular
// `browser.newContext()` (or worse, `chromium.launch()`) is fingerprinted
// by staging and redirects to the marketing site. The worker's
// stealthContext was launched persistently and has no parent Browser
// (`ctx.browser()` is null), so we cannot piggyback on it. Each incognito
// context therefore gets its own launchPersistentContext call against a
// fresh tmpdir profile, with the same stealth args as base.ts.
//
// Cost: ~1-2s per `openViewerPage()` call (Chrome cold-start). Tests that
// need a viewer perspective will pay this once; tests that don't will see
// zero overhead because the factory is invoked lazily.
//
// Constraints honoured
// --------------------
//
//   * `.auth/viewer.json` is required for `openViewerPage()`. If it's
//     missing, the factory throws loudly (rather than yielding an
//     unauthenticated page that would fail a downstream auth-marker probe
//     with a confusing timeout). The setup project produces this file;
//     its absence means setup failed and should be the surfaced bug.
//
//   * `readyAuthenticatedShell` from `./auth` is reused verbatim — same
//     marker probe, same storageState restore recovery path, same cookie
//     banner dismissal. No drift between worker-pinned and incognito
//     viewer contracts.
//
//   * Auto-cleanup: contexts close on fixture teardown via a tracked array
//     iterated in reverse. Profile tmpdirs are released best-effort.
//     Errors during close are logged-and-swallowed so they cannot mask
//     the underlying test result (same posture `tempChannel` teardown
//     takes in `./data`).

import { test as base, readyAuthenticatedShell, authPath } from './auth';
import { applyStorageState } from './base';
import { CookieBanner } from '../pages/CookieBanner';
import { env } from '../utils/env';
import {
  acquireWorkerProfile,
  releaseWorkerProfile,
} from '../utils/workerProfile';
import { chromium } from 'patchright';
import { execSync } from 'node:child_process';
import { accessSync } from 'node:fs';
import type { BrowserContext, Page } from 'patchright/test';

/**
 * Per-call factory returning a fresh viewer-authenticated Page. Each call
 * spawns a NEW persistent BrowserContext hydrated with `.auth/viewer.json`.
 * Multiple calls per test are allowed and each yields an independent
 * context.
 */
export type OpenViewerPage = () => Promise<Page>;

/**
 * Per-call factory returning a fresh anonymous Page. No storageState. The
 * cookie banner is dismissed but no auth marker is asserted.
 */
export type OpenAnonymousPage = () => Promise<Page>;

/**
 * Per-call factory returning a FRESH viewer-authenticated Page inside the
 * worker-shared `viewerCastContext`. Unlike `openViewerPage`, this does NOT
 * spawn a context per call — the casting suite showed that per-test context
 * churn is toxic under workers=1: `ctx.close()` on a spawned persistent
 * context hangs ~40% of the time (Wave 6 note on closeBounded), each hang
 * leaves a zombie Chrome alive until worker exit, and the accumulated
 * zombies starve the next test's /v/ player mount (2026-08-21: the same 3
 * casting tests wedged deterministically across two full runs; retries on a
 * fresh worker always passed).
 *
 * Isolation contract: page-scoped state (addInitScript stubs, page.route)
 * dies with each page, so per-test stub isolation is preserved; the SHARED
 * context keeps auth cookies + HTTP cache warm across tests (same warmth the
 * worker-pinned admin context always had). A wedged context dies with its
 * worker on test failure, so retries still get a fresh context.
 */
export type NewViewerCastPage = () => Promise<Page>;

type IncognitoFixtures = {
  openViewerPage: OpenViewerPage;
  openAnonymousPage: OpenAnonymousPage;
  newViewerCastPage: NewViewerCastPage;
};

type IncognitoWorkerFixtures = {
  /** Worker-shared viewer-authenticated persistent context backing
   *  `newViewerCastPage` — one spawn per worker, closed at worker exit. */
  viewerCastContext: BrowserContext;
};

/** Tracked context + its profile tmpdir so teardown can release both. */
interface SpawnedContext {
  ctx: BrowserContext;
  profileDir: string;
}

/**
 * Throw immediately if the viewer storageState dump is missing. This is a
 * setup-project failure (`tests/setup/auth.setup.ts` did not produce
 * `.auth/viewer.json`) and must surface loudly — never swallowed into a
 * cascade of confusing auth-marker timeouts downstream.
 */
function assertViewerStorageStateExists(): void {
  const path = authPath('viewer');
  try {
    accessSync(path);
  } catch {
    throw new Error(
      `[fixtures/incognito] openViewerPage() requires ${path} but the file ` +
        `is missing. The setup project (tests/setup/auth.setup.ts) is the ` +
        `producer — its failure is the upstream bug. Re-run \`yarn test\` ` +
        `so setup runs before the spec that needs this fixture.`,
    );
  }
}

/**
 * Launch a fresh stealth-grade persistent context. Mirrors the launch
 * arguments base.ts uses for `stealthContext` so detection signatures
 * (channel, args, viewport, locale, timezone) stay aligned. We DON'T re-read
 * `process.env.HEADED` here — the persistent context inherits the same
 * runtime headedness as the worker's primary context because both look at
 * the same env var at launch time.
 */
async function launchIncognito(profileDir: string): Promise<BrowserContext> {
  const headless = !env.HEADED;
  return await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless,
    // Watched-run pacing — same env.SLOWMO default as base.ts.
    ...(env.SLOWMO > 0 ? { slowMo: env.SLOWMO } : {}),
    viewport: { width: 1440, height: 900 },
    baseURL: env.BASE_URL,
    args: [
      '--disable-component-extensions-with-background-pages',
      ...(env.HEADED ? [] : ['--disable-blink-features=AutomationControlled']),
      // NS-11565: no --disable-web-security (strips Origin; editor/caniplay 400).
    ],
    ignoreHTTPSErrors: true,
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
  });
}

/**
 * Close a spawned incognito context, bounding the wait so a hung close cannot
 * consume the test budget.
 *
 * Wave 6 (2026-05-26): a 5x stability run of `update-profile-settings-viewer`
 * (which spawns a viewer context here) showed the test BODY always passing but
 * `ctx.close()` on the spawned persistent context intermittently (~40%)
 * HANGING for the entire remaining test budget — surfacing as
 * `Tearing down "openAnonymousPage" exceeded the test timeout`.
 *
 * Why we do NOT sever the IPC here (unlike `base.ts`): the base worker-context
 * teardown severs the driver via the private `_connection.close()` on a hung
 * close. Wave 6 tried the same on a spawned incognito context and found it ALSO
 * tore down the WORKER's primary context — the next worker-scoped `page`
 * teardown then failed with `page.close: Target page ... has been closed` and
 * the worker teardown itself timed out (observed across the 5x run). In this
 * Patchright build the spawned `launchPersistentContext` and the worker context
 * evidently share the underlying driver connection, so severing one kills the
 * other. Instead we RACE the close against a deadline and simply RETURN on
 * timeout, leaving the (already `.catch`-guarded) close promise to settle in
 * the background; the spawned Chrome process is reaped at worker exit. No error
 * is swallowed — a genuine close rejection is surfaced by the caller's catch.
 */
async function closeBounded(ctx: BrowserContext): Promise<void> {
  const closeDeadlineMs = 15_000;
  const ctxClosePromise = ctx.close();
  ctxClosePromise.catch(() => undefined);
  let closeTimeoutId: NodeJS.Timeout | undefined;
  const closeResult = await Promise.race([
    ctxClosePromise.then(() => 'closed' as const),
    new Promise<'timeout'>((resolve) => {
      closeTimeoutId = setTimeout(() => resolve('timeout'), closeDeadlineMs);
    }),
  ]);
  if (closeTimeoutId) clearTimeout(closeTimeoutId);
  if (closeResult === 'timeout') {
    // eslint-disable-next-line no-console
    console.warn(
      `[fixtures/incognito] ctx.close() exceeded ${closeDeadlineMs}ms — ` +
        `continuing teardown; the spawned Chrome is reaped at worker exit ` +
        `(NOT severing the shared driver — that would kill the worker context).`,
    );
  }
}

async function teardownSpawned(spawned: SpawnedContext[]): Promise<void> {
  // Reverse-order close so the most-recently-opened context releases
  // first; matches the resource-ownership intuition tests have.
  for (let i = spawned.length - 1; i >= 0; i--) {
    const { ctx, profileDir } = spawned[i]!;
    try {
      await closeBounded(ctx);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[fixtures/incognito] context close failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await releaseWorkerProfile(profileDir);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[fixtures/incognito] profile release failed for ${profileDir}: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

export const test = base.extend<IncognitoFixtures, IncognitoWorkerFixtures>({
  viewerCastContext: [
    async ({}, use, workerInfo) => {
      assertViewerStorageStateExists();
      const profileDir = await acquireWorkerProfile(workerInfo.parallelIndex);
      let ctx: BrowserContext;
      try {
        ctx = await launchIncognito(profileDir);
      } catch (err) {
        await releaseWorkerProfile(profileDir).catch(() => undefined);
        throw err;
      }
      await applyStorageState(ctx, authPath('viewer'), env.BASE_URL);
      // Pin the caniplay device identity BEFORE any navigation. The client
      // mints a random UUID into localStorage `mio_pid_5855` (raw key —
      // services/persistence formatKey isRawKey) on first load, and every
      // fresh worker profile therefore registered as a brand-new "device"
      // with the concurrency limiter (caniplay DEVICE_LIMIT — the site caps
      // an account at N concurrent devices). Runs piled up phantom devices
      // until the cap blocked playback (observed 2026-08-21: 3 stale
      // sessions on automation-viewer, Manage Devices wall instead of the
      // player). A stable per-lane id makes every run re-claim the SAME
      // device slot — no accumulation, no cleanup needed.
      await ctx.addInitScript((id: string) => {
        window.localStorage.setItem('mio_pid_5855', JSON.stringify(id));
      }, `e2e00000-cast-4000-8000-chromium000${workerInfo.parallelIndex}`);
      await use(ctx);
      // Teardown = KILL THE PROCESS, never a driver close. Two failure modes
      // meet here (both observed 2026-08-21, all tests green):
      //   * ctx.close() on a spawned persistent context hits the known ~40%
      //     hang and, because it shares the driver connection with the
      //     worker's primary context (Wave 6 note on closeBounded), the
      //     dangling close jams base.ts's own teardown into its sever path.
      //   * Skipping the close entirely leaves the spawned Chrome ALIVE at
      //     worker exit, and Playwright waits on the still-running child
      //     until "Worker teardown timeout of 120000ms exceeded" — the exact
      //     NS-11410 mechanism base.ts documents for its own escalation.
      // So: reap the browser tree directly by its user-data-dir — mkdtemp-
      // unique to this fixture, so the -f match cannot hit anything else
      // (same escalation base.ts uses after its sever). No driver command is
      // issued, so nothing can jam the shared connection; with Chrome dead,
      // the profile rm below also releases cleanly (no SingletonLock holds).
      const driverAcked = new Promise<void>((resolve) => {
        ctx.once('close', () => resolve());
      });
      try {
        execSync(`pkill -9 -f ${JSON.stringify(profileDir)}`, {
          stdio: 'ignore',
          timeout: 5_000,
        });
      } catch {
        // no match / already exited / non-POSIX platform — non-fatal.
      }
      // Let the shared driver connection FINISH digesting the abrupt browser
      // death before base.ts issues its own ctx.close() ~100ms later —
      // 2026-08-25 instrumented runs showed base's close stalling into its
      // 45s sever exactly when it raced this kill (and sailing through when
      // it didn't). Bounded: the context's 'close' event or 5s, whichever
      // comes first.
      let ackTimeoutId: NodeJS.Timeout | undefined;
      await Promise.race([
        driverAcked,
        new Promise<void>((resolve) => {
          ackTimeoutId = setTimeout(resolve, 5_000);
        }),
      ]);
      if (ackTimeoutId) clearTimeout(ackTimeoutId);
      // Kill-then-FIRE-AND-FORGET close (2026-08-26): killing without ever
      // issuing ctx.close() left the driver's context records undisposed
      // (viewer-only lanes hit the 120s cap with NO base context at all),
      // but AWAITING the close — even bounded — kept a wedge-prone command
      // on the worker-exit critical path. Issue it and move on: on a dead
      // browser it is bookkeeping that settles in the background, and the
      // worker exits with the driver connection intact (never severed).
      ctx.close().catch(() => undefined);
      await releaseWorkerProfile(profileDir).catch(() => undefined);
    },
    { scope: 'worker' },
  ],

  newViewerCastPage: async ({ viewerCastContext }, use) => {
    const opened: Page[] = [];
    const factory: NewViewerCastPage = async () => {
      const page = await viewerCastContext.newPage();
      opened.push(page);
      // Same proactive-setup contract as openViewerPage: BASE_URL, cookie
      // banner, viewer auth marker probe (with storageState recovery).
      await readyAuthenticatedShell(page, 'viewer');
      return page;
    };
    await use(factory);
    // Page-level close is light (no persistent-context close hang) and kills
    // the page-scoped stubs/routes so the next test starts clean.
    for (let i = opened.length - 1; i >= 0; i--) {
      await opened[i]!.close().catch(() => undefined);
    }
  },

  openViewerPage: async ({}, use, testInfo) => {
    const spawned: SpawnedContext[] = [];

    const factory: OpenViewerPage = async () => {
      assertViewerStorageStateExists();
      // Use a profile prefix that includes the worker index AND a per-call
      // discriminator (spawned.length) so concurrent calls in a single test
      // get unique tmpdirs.
      const profileDir = await acquireWorkerProfile(
        // Embed both indices via a synthetic key — workerProfile prefixes
        // with `maestro-e2e-w${workerIndex}-`, so passing a string here
        // would collide; instead pass workerIndex and rely on mkdtemp's
        // suffix for per-call uniqueness.
        testInfo.parallelIndex,
      );
      // The tmpdir now exists but is not yet tracked for teardown. If the
      // context launch (or anything before the `spawned.push`) throws, the
      // dir — and a partially-launched context — would leak: teardown only
      // iterates the `spawned` array. Wrap the acquire→launch→track window
      // so a mid-creation failure closes the partial context and removes the
      // tmp profile dir before rethrowing. Once `spawned.push` lands,
      // teardown owns lifecycle and the happy path proceeds unchanged.
      let ctx: BrowserContext;
      try {
        ctx = await launchIncognito(profileDir);
      } catch (err) {
        await releaseWorkerProfile(profileDir).catch(() => undefined);
        throw err;
      }
      try {
        spawned.push({ ctx, profileDir });
      } catch (err) {
        await closeBounded(ctx).catch(() => undefined);
        await releaseWorkerProfile(profileDir).catch(() => undefined);
        throw err;
      }

      // launchPersistentContext silently ignores `storageState` (see
      // base.ts Phase 3.6 note). Apply via the same one-shot used for the
      // worker's primary context.
      await applyStorageState(ctx, authPath('viewer'), env.BASE_URL);

      // launchPersistentContext opens an about:blank tab on launch; reuse
      // it. Mirror base.ts's `page` fixture choice.
      const existing = ctx.pages();
      const page =
        existing.length > 0 && existing[0]!.url() === 'about:blank'
          ? existing[0]!
          : await ctx.newPage();

      // Same proactive-setup contract as the role-pinned `viewerPage`
      // fixture: navigate to BASE_URL, dismiss the cookie banner if
      // present, probe for the viewer auth marker (recovery via
      // applyStorageState if the marker isn't visible within the probe
      // window).
      await readyAuthenticatedShell(page, 'viewer');
      return page;
    };

    await use(factory);
    await teardownSpawned(spawned);
  },

  openAnonymousPage: async ({}, use, testInfo) => {
    const spawned: SpawnedContext[] = [];

    const factory: OpenAnonymousPage = async () => {
      const profileDir = await acquireWorkerProfile(testInfo.parallelIndex);
      // Same partial-creation guard as openViewerPage: the tmpdir exists but
      // is not yet tracked. If the launch throws, release the dir before
      // rethrowing so a mid-creation failure cannot leak the profile or a
      // partially-launched context.
      let ctx: BrowserContext;
      try {
        ctx = await launchIncognito(profileDir);
      } catch (err) {
        await releaseWorkerProfile(profileDir).catch(() => undefined);
        throw err;
      }
      try {
        spawned.push({ ctx, profileDir });
      } catch (err) {
        await closeBounded(ctx).catch(() => undefined);
        await releaseWorkerProfile(profileDir).catch(() => undefined);
        throw err;
      }
      // No storageState injection — genuinely anonymous.

      const existing = ctx.pages();
      const page =
        existing.length > 0 && existing[0]!.url() === 'about:blank'
          ? existing[0]!
          : await ctx.newPage();

      // Navigate to BASE_URL and clear the cookie banner if it renders.
      // No auth marker probe — anonymous is the contract.
      await page.goto(env.BASE_URL);
      const banner = new CookieBanner(page);
      await banner.dismissIfPresent();
      return page;
    };

    await use(factory);
    await teardownSpawned(spawned);
  },
});

export { expect } from './base';

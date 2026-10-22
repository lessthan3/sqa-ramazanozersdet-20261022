// src/fixtures/base.ts
//
// THE load-bearing file. All `test.extend` chains in the project start here.
// The runner's default `page`/`context`/`browser` fixtures are replaced — NOT
// extended — because patchright's stealth only works under
// launchPersistentContext + channel:"chrome". Default `chromium.launch()` is
// detected by staging and redirects to the marketing site.
//
// Phase 3.6 architectural redesign (2026-05-22):
//
//   storageState is passed AT LAUNCH (via launchPersistentContext options),
//   not injected per-test onto a shared worker context. Each role-bound
//   Playwright project (chromium-admin / chromium-viewer / chromium-anonymous)
//   declares its own `use.storageState` path; the workerInfo carries that
//   path into this fixture, which forwards it directly to Patchright.
//
//   This eliminates the Phase 2/3 teardown stall: no worker ever flips
//   auth state, no cross-test state accumulates on the shared
//   BrowserContext, and ctx.close() runs through a clean codepath every
//   time. The Phase 3.5 escalation chain (browser.close → connection.close
//   fallback) and the per-test about:blank drain are GONE — they were
//   band-aids for the lifecycle bug that the architectural fix removes.
//
//   What stays:
//     * --disable-component-extensions-with-background-pages — still useful
//       to prevent Hangouts background_page targets from attaching.
//     * workerProfile.ts rm-timeout race — still useful as a safety net
//       for tmpdir cleanup.
//     * Loud throw on launchPersistentContext failure — unchanged.

import { test as base, type BrowserContext, type Page } from 'patchright/test';
import { chromium } from 'patchright';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { env } from '../utils/env';
import {
  acceptedTermsKey,
  resolveBrowserSiteId,
  TERMS_REJECTED,
} from '../utils/siteId';
import {
  acquireWorkerProfile,
  releaseWorkerProfile,
} from '../utils/workerProfile';

/**
 * Storage-state shape Playwright dumps to disk. Re-declared here to avoid
 * importing the internal type.
 */
interface StorageState {
  cookies: Array<Parameters<BrowserContext['addCookies']>[0][number]>;
  origins: Array<{
    origin: string;
    localStorage: Array<{ name: string; value: string }>;
  }>;
}

/**
 * Phase 3.6 rollback path: apply storageState via `addCookies` + a
 * per-origin localStorage hydration.
 *
 * Idempotent. Originally called once per worker (role-pinned launch).
 * Phase 4.2 recovery (2026-05-22): also callable from the `adminPage`
 * fixture to RE-hydrate after a prior test's `logout()` cleared the
 * authenticated session in the shared `workers: 1` context. Exported
 * for that consumer; safe to call repeatedly because cookies/localStorage
 * writes overwrite rather than append.
 */
export async function applyStorageState(
  ctx: BrowserContext,
  storageState: string | { cookies?: unknown; origins?: unknown },
  hydrationUrl?: string,
): Promise<void> {
  let state: StorageState;
  if (typeof storageState === 'string') {
    const raw = readFileSync(storageState, 'utf8');
    state = JSON.parse(raw) as StorageState;
  } else {
    state = storageState as StorageState;
  }

  if (state.cookies && state.cookies.length > 0) {
    await ctx.addCookies(state.cookies);
  }

  if (!state.origins || state.origins.length === 0) return;

  // localStorage entries must be set in the right origin context. Open a
  // dedicated hydration page per origin, navigate, evaluate, close.
  // Closing the hydration page immediately keeps the context clean for
  // tests; the entries persist on the BrowserContext's storage partition.
  //
  // hydrationUrl overrides origin.origin when the bare origin redirects to
  // a different host (e.g. https://maestro.tv/ → https://info.maestro.io/).
  // Pass env.BASE_URL so we land on a real channel page that is guaranteed
  // to be served at the correct origin without a cross-origin redirect.
  for (const origin of state.origins) {
    if (origin.localStorage.length === 0) continue;
    const page = await ctx.newPage();
    try {
      const targetUrl =
        hydrationUrl && new URL(hydrationUrl).origin === origin.origin
          ? hydrationUrl
          : origin.origin;
      await page.goto(targetUrl);
      await page.evaluate((entries) => {
        for (const e of entries) {
          try {
            window.localStorage.setItem(e.name, e.value);
          } catch {
            // Sandboxed origins (about:blank, chrome:// etc.) deny
            // localStorage — skip and continue.
          }
        }
      }, origin.localStorage);
    } finally {
      if (!page.isClosed()) await page.close();
    }
  }
}

type WorkerFixtures = {
  /**
   * One BrowserContext per worker. Loaded with the role-bound storageState
   * (if any) AT LAUNCH so all pages opened on this context are
   * pre-authenticated. Workers stay role-pinned for their lifetime — no
   * state mutation between tests, no teardown race.
   */
  stealthContext: BrowserContext;
  workerProfileDir: string;
};

type TestFixtures = {
  /** Fresh page per test, on the worker-scoped context. */
  page: Page;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  workerProfileDir: [
    async ({}, use, workerInfo) => {
      const dir = await acquireWorkerProfile(workerInfo.workerIndex);
      await use(dir);
      await releaseWorkerProfile(dir);
    },
    { scope: 'worker' },
  ],

  stealthContext: [
    async ({ workerProfileDir }, use, workerInfo) => {
      // Read project-declared storageState from the workerInfo. Playwright
      // exposes the project's `use` block via workerInfo.project.use.
      // `storageState` may be a string path (preferred) or an inline
      // StorageState object. Either is forwarded directly to Patchright.
      const projectUse = workerInfo.project.use as {
        storageState?: string | { cookies?: unknown; origins?: unknown };
      };
      const storageState = projectUse.storageState;

      const headless = !env.HEADED;
      let ctx: BrowserContext;
      try {
        // Use PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH (NixOS / custom installs)
        // when set; otherwise fall back to the installed Chrome channel.
        const chromeExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
        ctx = await chromium.launchPersistentContext(workerProfileDir, {
          ...(chromeExecutable
            ? { executablePath: chromeExecutable }
            : { channel: 'chrome' }),
          headless,
          // Watched-run pacing — env.SLOWMO defaults to 500ms locally, 0 in
          // CI; override per-run with SLOWMO=<ms> (0 = full speed).
          ...(env.SLOWMO > 0 ? { slowMo: env.SLOWMO } : {}),
          viewport: { width: 1440, height: 900 },
          baseURL: env.BASE_URL,
          args: [
            // Disable preinstalled component extensions (Google Hangouts
            // etc.) that attach `background_page` targets and slow down
            // context close. Does NOT affect Patchright stealth.
            '--disable-component-extensions-with-background-pages',
            // No --disable-web-security: it collapses origin isolation and
            // breaks cross-origin embeds.
            ...(env.HEADED
              ? []
              : ['--disable-blink-features=AutomationControlled']),
          ],
          ignoreHTTPSErrors: true,
          locale: 'en-US',
          timezoneId: 'America/Los_Angeles',
          // Phase 3.6: storageState IS NOT passed at launch.
          // launchPersistentContext silently ignores `storageState`
          // because persistent contexts persist state via the
          // user-data-dir, not via the in-memory StorageState shape.
          // The first Phase 3.6 attempt confirmed this empirically:
          // the setup project dumped .auth/admin.json correctly, the
          // chromium-admin project's launch options included
          // `storageState: '.auth/admin.json'`, but every role-bound
          // test loaded an anonymous page (Maestro showed "Log in"
          // top-right, no admin shell).
          //
          // Rollback path per the brief: apply storageState in a
          // worker-scoped one-shot below (`addCookies` + localStorage
          // hydration). Still safe — role projects are role-pinned for
          // worker lifetime, so the injection happens ONCE per worker
          // and is never repeated/mutated. No cross-test state churn,
          // no teardown race.
        });
      } catch (err) {
        throw new Error(
          `[fixtures/base] launchPersistentContext failed.\n` +
            `  workerProfileDir: ${workerProfileDir}\n` +
            `  channel: chrome (install via 'yarn patchright install chrome' if missing)\n` +
            `  headless: ${String(headless)}\n` +
            `  baseURL: ${env.BASE_URL}\n` +
            `  storageState: ${
              typeof storageState === 'string'
                ? storageState
                : storageState !== undefined
                  ? '<inline object>'
                  : '<none>'
            }\n` +
            `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err instanceof Error ? err : undefined },
        );
      }

      // Seed consent so the terms banner never mounts. The banner is
      // bottom-anchored and overlaps the editor's bottom bar, blocking clicks
      // on controls there. addInitScript runs before page scripts on every
      // navigation, so it beats the banner's render; a reactive dismiss races it.
      const consentSiteId = resolveBrowserSiteId();
      if (consentSiteId) {
        await ctx.addInitScript(
          ([key, value]) => {
            try {
              localStorage.setItem(key, value);
            } catch {
              // Storage can be unavailable on about:blank / opaque origins.
              // Not fatal — CookieBanner.dismissIfPresent remains the fallback.
            }
          },
          [acceptedTermsKey(consentSiteId), TERMS_REJECTED] as const,
        );
      }

      // Phase 3.6 one-shot storageState injection. Runs ONCE per worker
      // before any test sees the context. Because role projects are
      // role-pinned for worker lifetime, the injection is never repeated
      // and the context is never mutated mid-suite — the Phase 2/3 churn
      // pattern cannot form.
      if (storageState !== undefined) {
        await applyStorageState(ctx, storageState, env.BASE_URL);
      }

      await use(ctx);

      // Phase 3.6 teardown: ctx.close with a safety-net race + fallback to
      // connection.close. The Phase 3.5 escalation chain was preserved here
      // (in trimmed form) because even with role-pinned workers, a single
      // test that exercises an unusual navigation (e.g. logout-to-marketing
      // page) can leave iframes that delay ctx.close past Playwright's
      // worker-teardown budget. The fallback fires rarely in the role-pinned
      // model (1 in N runs vs 33% in Phase 3.5 churn pattern).
      // NS-11410 (2026-07-30): raised 15s → 45s. Upload-heavy specs
      // (multi-MB GCS PUTs through the page) leave Chrome with real profile
      // /cache flushing to do at close; with 4 workers closing concurrently
      // on one disk, ctx.close() legitimately exceeds 15s. Severing at that
      // point puts teardown on the pathological path (abandoned browser,
      // worker-teardown overruns), so give the graceful close room first —
      // 45s still leaves >60s of the 120s worker budget for the rm race and
      // escalation below.
      // Kill-first (2026-08-26, re-applied — validated 2026-08-25 on the
      // two-context casting/live specs, then lost in a branch shuffle): the
      // worker profile is a throwaway tmpdir, so a graceful close preserves
      // nothing — while a LIVE Chrome at close time is what produces the
      // intermittent close hang (worst when a spawned casting context's
      // process kill just crossed the shared driver connection: "Worker
      // teardown timeout of 120000ms exceeded" with all tests green, seen on
      // adminPage + newViewerCastPage suites). Reap the process tree first —
      // ctx.close() on a dead browser settles immediately; the 45s race +
      // sever below stay as the fallback. Same profile-dir -f match the
      // post-sever escalation already uses.
      try {
        execSync(`pkill -9 -f ${JSON.stringify(workerProfileDir)}`, {
          stdio: 'ignore',
          timeout: 5_000,
        });
      } catch {
        // no match / already exited / non-POSIX platform — non-fatal.
      }
      // Fire-and-forget close — NEVER await, NEVER sever (2026-08-26).
      // Evolution of this teardown, evidence-first:
      //   * ctx.close() intermittently wedges in this patchright build EVEN
      //     on a browser the kill above already reaped (sever fired with
      //     kill-first in place, 2026-08-25 instrumented runs).
      //   * The 45s race → _connection.close() sever then put shutdown on
      //     the pathological path this comment block always warned about:
      //     Playwright's POST-SEVER worker cleanup is unbounded and
      //     intermittently exceeded the 120s worker-teardown cap ("Worker
      //     teardown timeout of 120000ms exceeded" with every test green —
      //     recurred 2026-08-26 on the two-context ads suite even after
      //     kill-first landed).
      // With the Chrome tree already dead and the profile a throwaway
      // tmpdir, the close is pure bookkeeping: let it settle in the
      // background with the driver connection INTACT.
      // KNOWN-INTERMITTENT RESIDUAL (2026-08-26): even this shape does not
      // fully eliminate the 120s worker-teardown overrun — it recurred once
      // in a 3x validation with fire-and-forget in place. Every fixture-
      // level strategy has now been tried (awaited close, bounded race,
      // sever+kill, kill-first, kill-then-close, fire-and-forget); the
      // remaining wedge is inside this patchright build's own worker
      // shutdown. Tests are never affected — the error is worker-exit only.
      // The real fix is a patchright version bump (tracked in the NS-11413
      // PR notes); do NOT spend further fixture iterations here.
      ctx.close().catch(() => undefined);
    },
    { scope: 'worker' },
  ],

  // Per-test page on the worker context. First test on each worker reuses
  // the about:blank tab that launchPersistentContext opens; subsequent
  // tests get a fresh tab.
  page: async ({ stealthContext }, use) => {
    const existing = stealthContext.pages();
    const page =
      existing.length > 0 && existing[0]!.url() === 'about:blank'
        ? existing[0]!
        : await stealthContext.newPage();
    await use(page);
    if (!page.isClosed()) await page.close();
  },

  // Override the standard `context` fixture so consumers using
  // `{ context }` get the stealth one.
  context: async ({ stealthContext }, use) => {
    await use(stealthContext);
  },
});

export { expect } from 'patchright/test';

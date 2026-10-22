// tests/paywall/viewer-gate.spec.ts
//
// P0-1 — a non-entitled viewer who opens the video URL directly gets the
// paywall, never playback.
// P1-3 — the gate is enforced by the SERVER, not just drawn by the client:
// no session → denied; logged-in non-entitled → denied; the protected stream
// never reaches the browser, even with the overlay deleted.
//
// The leak assertions are only meaningful because viewer-purchase.spec.ts
// proves the same StreamLeakMonitor DOES see the stream for an entitled
// viewer.

import { test, expect } from '../../src/fixtures';
import { PaywallEditor } from '../../src/pages/PaywallEditor';
import { VideoPage } from '../../src/pages/VideoPage';
import { NO_ENTITLEMENT, requestAccessWithoutAuth, describeDecision } from '../../src/api/caniplay';
import { StreamLeakMonitor } from '../../src/utils/streamLeakMonitor';
import { uniquePrice } from '../../src/utils/paywallData';
import { registerFreshViewerAtCheckout, requireSingleWorker } from '../../src/utils/paywallSuite';


test.beforeAll(({}, testInfo) => requireSingleWorker(testInfo));

/** Long enough for the player + any stream request to fire if they were going to. */
const LEAK_OBSERVATION_MS = 5_000;

test.describe('non-entitled viewers are gated', () => {
  test.beforeEach(async ({ adminPage }) => {
    // Shared live page: establish the gate this spec relies on instead of
    // trusting whatever a previous run or another suite left behind.
    const saved = await new PaywallEditor(adminPage).configureOneTimePurchase(uniquePrice());
    expect(saved.gateSaveStatus, 'precondition: paywall saved').toBeLessThan(300);
  });

  test('P0-1 anonymous viewer opening the video URL directly gets the paywall, not playback', async ({
    openAnonymousPage,
  }) => {
    const page = await openAnonymousPage();
    const video = new VideoPage(page);
    const streams = new StreamLeakMonitor(page);

    await test.step('server denies access on a direct URL load', async () => {
      const decision = await video.goto();
      expect(decision.status, describeDecision(decision)).toBe(401);
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
    });

    await test.step('viewer sees the paywall: marketing copy, purchase CTA, login for past buyers', async () => {
      await expect(video.paywall.root).toBeVisible();
      await expect(video.paywall.copyBlocks.first()).toBeVisible();
      await expect(video.paywall.copyBlocks.first()).not.toBeEmpty();
      await expect(video.paywall.getAccessButton).toBeEnabled();
      await expect(video.paywall.loginButton).toBeVisible();
      await expect(video.paywall.watchNowButton).toBeHidden();
    });

    await test.step('no player and no stream reach the browser', async () => {
      await video.observeFor(LEAK_OBSERVATION_MS);
      await expect(video.video).toHaveCount(0);
      expect(await video.secondsPlayed()).toBe(0);
      expect(streams.leaks, 'stream requests / stream URLs in API bodies').toEqual([]);
    });

    await test.step('reloading the direct URL is still gated', async () => {
      const decision = await video.reload();
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await expect(video.paywall.getAccessButton).toBeVisible();
      await expect(video.video).toHaveCount(0);
    });
  });

  test('P1-3 the gate is enforced server-side, not just drawn over the player', async ({ openAnonymousPage }) => {
    test.setTimeout(180_000);

    await test.step('no session at all: caniplay denies both check and play intents', async () => {
      for (const intent of ['check', 'play'] as const) {
        const decision = await requestAccessWithoutAuth(intent);
        expect(decision.status, `intent=${intent}`).toBe(401);
        expect(decision.access, `intent=${intent}`).toBe(NO_ENTITLEMENT);
      }
    });

    const page = await openAnonymousPage();
    const video = new VideoPage(page);
    const streams = new StreamLeakMonitor(page);

    await test.step('a logged-in viewer without a purchase is denied too', async () => {
      await video.goto();
      await registerFreshViewerAtCheckout(video);
      await expect(video.checkout.heading).toBeVisible();
      const decision = await video.reload();
      expect(decision.status, describeDecision(decision)).toBe(401);
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await expect(video.paywall.getAccessButton).toBeVisible();
    });

    await test.step('deleting the paywall overlay does not reveal a player or the stream', async () => {
      await video.removePaywallOverlay();
      await expect(video.paywall.root).toHaveCount(0);
      await video.observeFor(LEAK_OBSERVATION_MS);
      await expect(video.video).toHaveCount(0);
      expect(await video.secondsPlayed()).toBe(0);
      expect(streams.leaks, 'stream requests / stream URLs in API bodies').toEqual([]);
    });
  });
});

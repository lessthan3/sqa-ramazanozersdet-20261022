// tests/paywall/payment-failures.spec.ts
//
// P1-1 — a declined card grants nothing, AND the viewer can recover by
//        paying with a good card (a failed attempt must not leave a willing
//        buyer stuck — that is lost revenue too).
// P1-2 — an abandoned checkout grants nothing.
//
// Both are revenue-leak guards: entitlement must follow a SUCCESSFUL charge,
// never the attempt.

import { test, expect } from '../../src/fixtures';
import { PaywallEditor } from '../../src/pages/PaywallEditor';
import { VideoPage } from '../../src/pages/VideoPage';
import { NO_ENTITLEMENT, isGranted, describeDecision } from '../../src/api/caniplay';
import { BILLING, STRIPE_CARDS, newViewerCredentials, uniquePrice } from '../../src/utils/paywallData';
import { fillPaymentDetails, registerFreshViewerAtCheckout, requireSingleWorker } from '../../src/utils/paywallSuite';


test.beforeAll(({}, testInfo) => requireSingleWorker(testInfo));

test.describe('failed and abandoned payments grant nothing', () => {
  test.beforeEach(async ({ adminPage }) => {
    const saved = await new PaywallEditor(adminPage).configureOneTimePurchase(uniquePrice());
    expect(saved.gateSaveStatus, 'precondition: paywall saved').toBeLessThan(300);
  });

  test('P1-1 declined card (4000 0000 0000 0002) grants nothing; retry with 4242 unlocks', async ({
    openAnonymousPage,
  }) => {
    test.setTimeout(240_000);
    const viewer = newViewerCredentials();
    const video = new VideoPage(await openAnonymousPage());

    await test.step('fresh viewer reaches checkout', async () => {
      const decision = await video.goto();
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await registerFreshViewerAtCheckout(video, viewer);
      await expect(video.checkout.heading).toBeVisible();
      await expect(video.checkout.completePurchaseButton).toBeDisabled();
    });

    await test.step('viewer pays with the always-declined test card', async () => {
      await fillPaymentDetails(video.checkout, viewer, STRIPE_CARDS.declined);
      await expect(video.checkout.card.cardNumber).toHaveValue(STRIPE_CARDS.declined);
      await expect(video.checkout.completePurchaseButton).toBeEnabled();
      await video.checkout.completePurchase();
    });

    await test.step('the decline is shown and no receipt is issued', async () => {
      await expect(video.checkout.paymentErrorTitle).toBeVisible({ timeout: 45_000 });
      await expect(video.checkout.paymentError).toContainText(/card has been declined/i);
      await expect(video.receipt.title).toBeHidden();
    });

    await test.step('acknowledging the error returns to the same checkout with billing kept', async () => {
      await video.checkout.paymentErrorOkButton.click();
      await expect(video.checkout.paymentError).toBeHidden();
      await expect(video.checkout.heading).toBeVisible();
      await expect(video.checkout.billingName).toHaveValue(viewer.name);
      await expect(video.checkout.zip).toHaveValue(BILLING.zip);
      await expect(video.checkout.completePurchaseButton).toBeVisible();
    });

    await test.step('server still denies access and the paywall still asks for payment', async () => {
      const decision = await video.reload();
      expect(decision.status, describeDecision(decision)).toBe(401);
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await expect(video.paywall.getAccessButton).toBeVisible();
      await expect(video.paywall.watchNowButton).toBeHidden();
      await expect(video.video).toHaveCount(0);
    });

    await test.step('the same viewer can retry with a good card and is charged what was quoted', async () => {
      await video.paywall.getAccess();
      await expect(video.checkout.heading).toBeVisible({ timeout: 45_000 });
      await fillPaymentDetails(video.checkout, viewer, STRIPE_CARDS.success);
      await expect(video.checkout.zip).toHaveValue(BILLING.zip);
      await expect(video.checkout.completePurchaseButton).toBeEnabled();
      const quotedTotal = await video.checkout.readSummary('Total Due');
      await video.checkout.completePurchase();
      await expect(video.receipt.title).toBeVisible({ timeout: 60_000 });
      expect(await video.receipt.readAmount('Total Amount'), 'total charged vs quoted').toBe(quotedTotal);
    });

    await test.step('the successful retry unlocks playback', async () => {
      await video.receipt.watchNowButton.click();
      await expect(video.paywall.root).toBeHidden({ timeout: 30_000 });
      await video.startPlaybackIfIdle();
      await expect.poll(() => video.secondsPlayed(), { timeout: 30_000 }).toBeGreaterThan(0);
      const decision = await video.reload();
      expect(isGranted(decision), `caniplay after retry: ${JSON.stringify(decision.body)}`).toBe(true);
    });
  });

  test('P1-2 abandoned checkout grants nothing', async ({ openAnonymousPage }) => {
    test.setTimeout(180_000);
    const viewer = newViewerCredentials();
    const video = new VideoPage(await openAnonymousPage());

    await test.step('fresh viewer opens checkout and starts filling billing', async () => {
      await video.goto();
      await registerFreshViewerAtCheckout(video, viewer);
      await video.checkout.fillBilling({ name: viewer.name, ...BILLING });
      await expect(video.checkout.zip).toHaveValue(BILLING.zip);
    });

    await test.step('viewer closes checkout without paying', async () => {
      await video.checkout.close();
      await expect(video.checkout.heading).toBeHidden();
      await expect(video.paywall.getAccessButton).toBeVisible();
      await expect(video.receipt.title).toBeHidden();
    });

    await test.step('after reload the server denies access and no player is mounted', async () => {
      const decision = await video.reload();
      expect(decision.status, describeDecision(decision)).toBe(401);
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await expect(video.paywall.getAccessButton).toBeVisible();
      await expect(video.paywall.watchNowButton).toBeHidden();
      await expect(video.video).toHaveCount(0);
    });
  });
});

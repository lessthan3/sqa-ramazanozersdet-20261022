// tests/paywall/admin-paywall-config.spec.ts
//
// P0-2 / P0-3 — the admin flow: configure a one-time-purchase price on the
// video page, save, prove it persisted (reload + server payload), and prove
// it reached viewers (non-entitled viewers are gated and see THIS price).
// P1-5 — a price edit propagates: viewers are never shown (or charged) the
// stale price.
//
// Why price is the run-unique marker: the one-time product is per-video and
// named after the video, so its name cannot distinguish this run's config
// from a previous one. A random price can.

import { test, expect } from '../../src/fixtures';
import { PaywallEditor } from '../../src/pages/PaywallEditor';
import { VideoPage } from '../../src/pages/VideoPage';
import { NO_ENTITLEMENT, describeDecision } from '../../src/api/caniplay';
import { videoPage as target } from '../../src/utils/videoPage';
import { formatPrice, uniquePrice } from '../../src/utils/paywallData';
import { registerFreshViewerAtCheckout, requireSingleWorker } from '../../src/utils/paywallSuite';


test.beforeAll(({}, testInfo) => requireSingleWorker(testInfo));

test.describe('admin configures the video paywall', () => {
  test('P0-2/P0-3 one-time purchase price persists across reload and gates non-entitled viewers', async ({
    adminPage,
    openAnonymousPage,
  }) => {
    test.setTimeout(240_000);
    const editor = new PaywallEditor(adminPage);
    let previousPrice = 0;
    let price = 0;

    await test.step('admin opens the paywall editor on the video page', async () => {
      await editor.open();
      await expect(editor.paywallStatus).toBeVisible();
      await expect(editor.settingsButton).toBeVisible();
      await expect(editor.preview.heading).toBeVisible();
      await expect(editor.preview.productName(target.title)).toBeVisible();
    });

    await test.step('Paywall Settings opens on the Paywall tab with every monetization option', async () => {
      await editor.openSettings();
      await expect(editor.paywallTab).toHaveAttribute('aria-selected', 'true');
      for (const option of ['one-time-purchase', 'rental', 'membership', 'ticket'] as const) {
        await expect(editor.optionCheckbox(option), `${option} option`).toBeVisible();
      }
      await expect(editor.saveButton).toBeVisible();
      if (await editor.isOptionEnabled('one-time-purchase')) previousPrice = await editor.readOneTimePrice();
      price = uniquePrice(previousPrice);
    });

    await test.step('admin enables one-time purchase at a run-unique price', async () => {
      await editor.setOptionEnabled('one-time-purchase', true);
      await expect(editor.optionCheckbox('one-time-purchase')).toHaveAttribute('aria-checked', 'true');
      await editor.setOneTimePrice(price);
      await expect(editor.oneTimePrice).toHaveValue(price.toFixed(2));
      // The rental block has an identically-testid'd price input — it must be untouched.
      if (await editor.isOptionEnabled('rental')) {
        await expect(editor.rentalPrice).not.toHaveValue(price.toFixed(2));
      }
    });

    await test.step('save writes the gate and the product price to the server', async () => {
      const saved = await editor.save();
      expect(saved.gateSaveStatus, 'gate PATCH status').toBeGreaterThanOrEqual(200);
      expect(saved.gateSaveStatus, 'gate PATCH status').toBeLessThan(300);
      const purchase = saved.productUpserts.find((p) => p.type === 'vodPurchase');
      expect(purchase, 'one-time product upsert sent').toBeDefined();
      expect(purchase!.prices?.[0]).toMatchObject({ value: price, currency: target.currency.toLowerCase() });
      await expect(editor.saveButton).toBeHidden();
    });

    await test.step('after a reload the editor still shows one-time purchase at that price', async () => {
      await editor.open();
      await editor.openSettings();
      await expect(editor.optionCheckbox('one-time-purchase')).toHaveAttribute('aria-checked', 'true');
      expect(await editor.readOneTimePrice()).toBe(price);
    });

    await test.step('the editor checkout preview offers "Buy" at the new price', async () => {
      await editor.open();
      await expect(editor.preview.offer('Buy')).toBeVisible();
      await expect(editor.preview.offerPrice('Buy')).toHaveText(formatPrice(price));
    });

    const viewerPage = await openAnonymousPage();
    const video = new VideoPage(viewerPage);

    await test.step('an anonymous viewer now hits the paywall instead of playback', async () => {
      const decision = await video.goto();
      expect(decision.status, describeDecision(decision)).toBe(401);
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await expect(video.paywall.root).toBeVisible();
      await expect(video.paywall.getAccessButton).toBeVisible();
      await expect(video.video).toHaveCount(0);
    });

    await test.step('a newly registered (non-entitled) viewer is offered the new price', async () => {
      await registerFreshViewerAtCheckout(video);
      await expect(video.checkout.heading).toBeVisible();
      await expect(video.checkout.productName(target.title)).toBeVisible();
      await expect(video.checkout.offerPrice('Buy')).toHaveText(formatPrice(price));
      await expect(video.checkout.completePurchaseButton).toBeDisabled();
    });

    await test.step('being logged in is not being entitled: reload stays gated', async () => {
      const decision = await video.reload();
      expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
      await expect(video.paywall.getAccessButton).toBeVisible();
      await expect(video.paywall.watchNowButton).toBeHidden();
      await expect(video.video).toHaveCount(0);
    });
  });

  test('P1-5 a price edit reaches viewers — no stale price on the paywall or in the order total', async ({
    adminPage,
    openAnonymousPage,
  }) => {
    test.setTimeout(240_000);
    const editor = new PaywallEditor(adminPage);
    const oldPrice = uniquePrice();
    const newPrice = uniquePrice(oldPrice);

    await test.step('precondition: one-time purchase is on sale at the old price', async () => {
      const saved = await editor.configureOneTimePurchase(oldPrice);
      expect(saved.gateSaveStatus).toBeLessThan(300);
      // The live preview only re-renders offers on a fresh editor load.
      await editor.open();
      await expect(editor.preview.offerPrice('Buy')).toHaveText(formatPrice(oldPrice));
    });

    await test.step('admin edits the price and saves', async () => {
      await editor.openSettings();
      await expect(editor.oneTimePrice).toHaveValue(oldPrice.toFixed(2));
      await editor.setOneTimePrice(newPrice);
      await expect(editor.oneTimePrice).toHaveValue(newPrice.toFixed(2));
      const saved = await editor.save();
      expect(saved.gateSaveStatus).toBeLessThan(300);
      expect(saved.productUpserts.find((p) => p.type === 'vodPurchase')?.prices?.[0]?.value).toBe(newPrice);
    });

    await test.step('the editor preview shows only the new price', async () => {
      await editor.open();
      await expect(editor.preview.offerPrice('Buy')).toHaveText(formatPrice(newPrice));
    });

    const video = new VideoPage(await openAnonymousPage());

    await test.step('a fresh viewer is offered the new price, never the old one', async () => {
      await video.goto();
      await expect(video.paywall.getAccessButton).toBeVisible();
      await registerFreshViewerAtCheckout(video);
      await expect(video.checkout.offerPrice('Buy')).toHaveText(formatPrice(newPrice));
      await expect(video.checkout.root).not.toContainText(formatPrice(oldPrice));
    });

    await test.step('the order subtotal is the new price and the total adds up', async () => {
      await video.checkout.selectOffer('Buy');
      await expect(video.checkout.summaryValue('Subtotal')).toHaveText(formatPrice(newPrice));
      const subtotal = await video.checkout.readSummary('Subtotal');
      const service = await video.checkout.readSummary('Service Charge');
      const tax = await video.checkout.readSummary('Sales Tax');
      expect(await video.checkout.readSummary('Total Due')).toBeCloseTo(subtotal + service + tax, 2);
    });
  });
});

// tests/paywall/viewer-purchase.spec.ts
//
// P0-4 + P0-5 — the money path. A brand-new viewer lands on the paywalled
// video, registers from the paywall, sees the product + price + CTA, pays
// with Stripe test card 4242, and gets playback that survives a reload and
// a fresh login in a different browser.
//
// One journey, one purchase: purchases are permanent and each run pays once,
// so P0-4 and P0-5 are steps of the same test (separate step names keep the
// failure pointing at the exact contract that broke).
//
// Oracles per step: what the viewer sees (page objects) AND what the server
// decided (caniplay). Playback means media actually advanced.

import { test, expect } from '../../src/fixtures';
import { PaywallEditor } from '../../src/pages/PaywallEditor';
import { VideoPage } from '../../src/pages/VideoPage';
import { NO_ENTITLEMENT, isGranted, captureAccessCheck, describeDecision } from '../../src/api/caniplay';
import { StreamLeakMonitor } from '../../src/utils/streamLeakMonitor';
import { videoPage as target } from '../../src/utils/videoPage';
import { BILLING, STRIPE_CARDS, formatPrice, futureExpiry, newViewerCredentials, uniquePrice } from '../../src/utils/paywallData';
import { requireSingleWorker } from '../../src/utils/paywallSuite';


test.beforeAll(({}, testInfo) => requireSingleWorker(testInfo));

test('P0-4/P0-5 fresh viewer buys with 4242 and keeps playback across reload and fresh login', async ({
  adminPage,
  openAnonymousPage,
}) => {
  // Admin config + registration + Stripe + a second browser login.
  test.setTimeout(300_000);
  const price = uniquePrice();
  const viewer = newViewerCredentials();
  // What the checkout told the viewer they would pay — the receipt must match it.
  const quoted = { subtotal: 0, serviceCharge: 0, tax: 0, total: 0 };

  await test.step('precondition: admin sells the video as a one-time purchase at a run-unique price', async () => {
    const saved = await new PaywallEditor(adminPage).configureOneTimePurchase(price);
    expect(saved.gateSaveStatus, 'gate config save').toBeLessThan(300);
    expect(saved.productUpserts.find((p) => p.type === 'vodPurchase')?.prices?.[0]?.value).toBe(price);
  });

  const page = await openAnonymousPage();
  const video = new VideoPage(page);
  const streams = new StreamLeakMonitor(page);

  await test.step('fresh anonymous viewer lands on the paywall, not playback', async () => {
    const decision = await video.goto();
    expect(decision.status, describeDecision(decision)).toBe(401);
    expect(decision.access, describeDecision(decision)).toBe(NO_ENTITLEMENT);
    await expect(video.paywall.root).toBeVisible();
    await expect(video.paywall.getAccessButton).toBeVisible();
    await expect(video.video).toHaveCount(0);
  });

  await test.step('"Get Access" asks an anonymous viewer to sign in first', async () => {
    await video.paywall.getAccess();
    await expect(video.authModal.root).toBeVisible();
    await expect(video.authModal.emailInput).toBeVisible();
  });

  await test.step('viewer registers a new account from the paywall', async () => {
    await video.authModal.registerFromOpenModal(viewer);
    await expect(video.authModal.root).toBeHidden();
    await expect(video.signedInUser).toHaveText(viewer.name);
  });

  await test.step('checkout shows product name, the configured price and the purchase CTA', async () => {
    const { checkout } = video;
    await expect(checkout.heading).toBeVisible();
    await expect(checkout.productName(target.title)).toBeVisible();
    await expect(checkout.offer('Buy')).toBeVisible();
    await expect(checkout.offerPrice('Buy')).toHaveText(formatPrice(price));
    await expect(checkout.completePurchaseButton).toBeVisible();
    // Nothing can be charged before the form is complete.
    await expect(checkout.completePurchaseButton).toBeDisabled();
  });

  await test.step('order summary charges the advertised price and adds up', async () => {
    const { checkout } = video;
    await checkout.selectOffer('Buy');
    await expect(checkout.offer('Buy')).toHaveAttribute('aria-checked', 'true');
    await expect(checkout.summaryValue('Subtotal')).toHaveText(formatPrice(price));
    quoted.subtotal = await checkout.readSummary('Subtotal');
    quoted.serviceCharge = await checkout.readSummary('Service Charge');
    quoted.tax = await checkout.readSummary('Sales Tax');
    quoted.total = await checkout.readSummary('Total Due');
    expect(quoted.subtotal).toBe(price);
    expect(quoted.serviceCharge).toBeGreaterThanOrEqual(0);
    expect(quoted.tax).toBeGreaterThanOrEqual(0);
    expect(quoted.total).toBeCloseTo(quoted.subtotal + quoted.serviceCharge + quoted.tax, 2);
  });

  await test.step('viewer enters billing address', async () => {
    const { checkout } = video;
    await checkout.fillBilling({ name: viewer.name, ...BILLING });
    await expect(checkout.billingName).toHaveValue(viewer.name);
    await expect(checkout.country).toHaveValue(BILLING.country);
    await expect(checkout.state).toBeVisible();
    await expect(checkout.zip).toHaveValue(BILLING.zip);
  });

  await test.step('viewer enters Stripe test card 4242 and the CTA enables', async () => {
    const { checkout } = video;
    await checkout.card.fill({ number: STRIPE_CARDS.success, expiry: futureExpiry(), cvc: BILLING.cvc });
    await expect(checkout.card.cardNumber).toHaveValue(STRIPE_CARDS.success);
    await expect(checkout.completePurchaseButton).toBeEnabled();
  });

  await test.step('purchase completes and the receipt offers "Watch now"', async () => {
    await video.checkout.completePurchase();
    await expect(video.receipt.title).toBeVisible({ timeout: 60_000 });
    await expect(video.receipt.receiptId).toBeVisible();
    await expect(video.receipt.watchNowButton).toBeVisible();
  });

  await test.step('receipt charges exactly what the checkout quoted, on the card used', async () => {
    const { receipt } = video;
    expect(await receipt.readLine('Card ending in')).toBe(`*${STRIPE_CARDS.success.slice(-4)}`);
    expect.soft(await receipt.readAmount('Video On Demand Purchase'), 'item price charged vs quoted').toBe(quoted.subtotal);
    expect.soft(await receipt.readAmount('Service Charge'), 'service charge charged vs quoted').toBe(quoted.serviceCharge);
    expect.soft(await receipt.readAmount('Tax'), 'tax charged vs quoted').toBe(quoted.tax);
    expect(await receipt.readAmount('Total Amount'), 'total charged vs quoted').toBe(quoted.total);
  });

  await test.step('P0-4: entitlement unlocks playback', async () => {
    await video.receipt.watchNowButton.click();
    await expect(video.paywall.root).toBeHidden({ timeout: 30_000 });
    await expect(video.video).toBeAttached({ timeout: 30_000 });
    await video.startPlaybackIfIdle();
    await expect.poll(() => video.secondsPlayed(), { timeout: 30_000 }).toBeGreaterThan(0);
    // Positive control for the leak monitor used by the gate specs.
    expect(streams.leaks.length, 'entitled viewer receives the stream').toBeGreaterThan(0);
  });

  await test.step('P0-5: access survives a reload — server grants, landing offers "Watch Now"', async () => {
    const decision = await video.reload();
    expect(isGranted(decision), `caniplay after reload: ${JSON.stringify(decision.body)}`).toBe(true);
    // Entitled landing: the CTA flips from "Get Access" to "Watch Now"; no checkout.
    await expect(video.paywall.watchNowButton).toBeVisible({ timeout: 30_000 });
    await expect(video.paywall.getAccessButton).toBeHidden();
    await expect(video.checkout.heading).toBeHidden();
  });

  await test.step('P0-5: "Watch Now" after reload plays without asking to pay', async () => {
    await video.paywall.watchNow();
    await expect(video.paywall.root).toBeHidden({ timeout: 30_000 });
    await expect(video.checkout.heading).toBeHidden();
    await video.startPlaybackIfIdle();
    await expect.poll(() => video.secondsPlayed(), { timeout: 30_000 }).toBeGreaterThan(0);
  });

  await test.step('P0-5: access survives a fresh login in a new browser, without paying again', async () => {
    const freshPage = await openAnonymousPage();
    const fresh = new VideoPage(freshPage);

    const anonymous = await fresh.goto();
    expect(anonymous.access, `logged out = not entitled, even for a buyer: ${describeDecision(anonymous)}`).toBe(
      NO_ENTITLEMENT,
    );
    await expect(fresh.paywall.loginButton).toBeVisible();

    await fresh.paywall.openLogin();
    await expect(fresh.authModal.root).toBeVisible();
    const afterLogin = await captureAccessCheck(freshPage, () =>
      fresh.authModal.loginFromOpenModal(viewer.email, viewer.password),
    );
    expect(isGranted(afterLogin), `caniplay after login: ${JSON.stringify(afterLogin.body)}`).toBe(true);
    await expect(fresh.signedInUser).toHaveText(viewer.name);
    await expect(fresh.paywall.watchNowButton).toBeVisible({ timeout: 30_000 });
    await expect(fresh.paywall.getAccessButton).toBeHidden();
    await expect(fresh.checkout.heading).toBeHidden();

    await fresh.paywall.watchNow();
    await expect(fresh.paywall.root).toBeHidden({ timeout: 30_000 });
    await fresh.startPlaybackIfIdle();
    await expect.poll(() => fresh.secondsPlayed(), { timeout: 30_000 }).toBeGreaterThan(0);
  });
});

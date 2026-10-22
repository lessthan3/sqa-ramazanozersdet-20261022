// src/utils/paywallSuite.ts
//
// Suite-level helpers shared by the paywall specs.
//
// SHARED STATE: every paywall spec mutates the SAME live video page's gate.
// Two specs saving different prices in parallel would make each other's
// price assertions fail (or, worse, pass against the wrong config). The
// suite is therefore only valid with one worker — `npm run test:paywall`
// forces it; this guard makes any other invocation fail loudly instead of
// producing flaky, misleading results.

import type { TestInfo } from 'patchright/test';
import type { CheckoutPanel } from '../pages/CheckoutPanel';
import type { VideoPage } from '../pages/VideoPage';
import { BILLING, futureExpiry, newViewerCredentials, type ViewerCredentials } from './paywallData';

export function requireSingleWorker(testInfo: TestInfo): void {
  if (testInfo.config.workers > 1) {
    throw new Error(
      `[paywall] ${testInfo.config.workers} workers configured, but paywall specs share one ` +
        `live video page's gate config and must run serially. Use ` +
        '`npm run test:paywall` (forces --workers=1) or pass --workers=1.',
    );
  }
}

/**
 * Setup shortcut: from a gated video page, register a brand-new viewer via
 * "Get Access" and land on the checkout. Specs whose SUBJECT is registration
 * drive these steps themselves with assertions; this is for specs that only
 * need "a fresh logged-in, non-entitled viewer at checkout".
 */
export async function registerFreshViewerAtCheckout(
  videoPage: VideoPage,
  viewer: ViewerCredentials = newViewerCredentials(),
): Promise<ViewerCredentials> {
  await videoPage.paywall.getAccess();
  await videoPage.authModal.registerFromOpenModal(viewer);
  await videoPage.checkout.heading.waitFor({ state: 'visible', timeout: 45_000 });
  return viewer;
}

/** Fill billing + card on an open checkout (does not submit). */
export async function fillPaymentDetails(
  checkout: CheckoutPanel,
  viewer: ViewerCredentials,
  cardNumber: string,
): Promise<void> {
  await checkout.fillBilling({ name: viewer.name, ...BILLING });
  await checkout.card.fill({ number: cardNumber, expiry: futureExpiry(), cvc: BILLING.cvc });
}

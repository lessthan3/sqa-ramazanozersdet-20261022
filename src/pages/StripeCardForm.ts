// src/pages/StripeCardForm.ts
//
// Stripe Elements card input embedded in the checkout panel. Card number,
// expiry and CVC live in ONE cross-origin iframe named
// `__privateStripeFrame<random>` (codegen 2026-10-22). The numeric suffix
// changes every load, so match on the prefix; Stripe's other iframes are
// `__privateStripeController*` / `__privateStripeMetricsController*` and do
// not match it.
//
// The iframe is mounted lazily — it is absent until the billing address
// above it is filled — so callers wait on `cardNumber`, not on page load.

import type { Page, Locator, FrameLocator } from 'patchright/test';

export class StripeCardForm {
  readonly page: Page;
  readonly frame: FrameLocator;
  readonly cardNumber: Locator;
  readonly expiry: Locator;
  readonly cvc: Locator;

  constructor(page: Page) {
    this.page = page;
    this.frame = page.locator('iframe[name^="__privateStripeFrame"]').first().contentFrame();
    this.cardNumber = this.frame.getByRole('textbox', { name: 'Card number' });
    this.expiry = this.frame.getByRole('textbox', { name: 'Expiration date' });
    this.cvc = this.frame.getByRole('textbox', { name: 'Security code' });
  }

  async fill(card: { number: string; expiry: string; cvc: string }): Promise<void> {
    // Stripe re-formats as it types; fill() lands the whole value at once,
    // which Elements accepts (verified by the codegen recording).
    await this.cardNumber.waitFor({ state: 'visible', timeout: 45_000 });
    await this.cardNumber.fill(card.number);
    await this.expiry.fill(card.expiry);
    await this.cvc.fill(card.cvc);
  }
}

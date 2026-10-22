// src/pages/CheckoutPanel.ts
//
// The "Checkout" side panel a logged-in, non-entitled viewer gets after
// "Get Access". The admin's paywall editor renders the SAME panel as a live
// preview, so admin specs reuse this object to read what viewers will see.
//
// Structure (DOM dump 2026-10-22):
//   h3 "Checkout" · countdown · Close
//   product: thumbnail + video title (the product name)
//   radiogroup: one radio per offer — accessible name = offer label
//     ("Buy", "Rent"), price in the sibling block ("EUR €7.37")
//   billing: Name · Country combobox · (State, once US) · Zip
//   Stripe card iframe (mounted after billing — see StripeCardForm)
//   summary rows: "Subtotal (1)" · "Service Charge" · "Sales Tax" · "Total Due"
//   "Complete Purchase" — disabled until the form is valid
//
// Almost nothing here has a testid, so locators are role/name based and
// scoped to the panel root. Summary rows are label/value <span> pairs; the
// value is read as the label's following sibling.

import type { Page, Locator } from 'patchright/test';
import { StripeCardForm } from './StripeCardForm';
import { parsePrice } from '../utils/paywallData';

/** Offer labels as the checkout renders them. */
export type OfferLabel = 'Buy' | 'Rent';

/** Summary row labels (prefix match — "Subtotal (1)" carries an item count). */
export type SummaryLabel = 'Subtotal' | 'Service Charge' | 'Sales Tax' | 'Total Due';

export interface BillingDetails {
  name: string;
  country: string;
  state: string;
  zip: string;
}

export class CheckoutPanel {
  readonly page: Page;
  readonly root: Locator;
  readonly heading: Locator;
  readonly closeButton: Locator;
  readonly offers: Locator;
  readonly billingName: Locator;
  readonly country: Locator;
  readonly state: Locator;
  readonly zip: Locator;
  readonly completePurchaseButton: Locator;
  readonly card: StripeCardForm;
  /**
   * Payment failure dialog. A decline opens a page-level "Oh Snap!" dialog
   * over the checkout: "Failed to confirm payment: Your card has been
   * declined. Please check your payment details and try again." + Ok.
   * Ok returns the viewer to the SAME checkout with billing kept — the retry
   * happens there (the paywall's "Get Access" stays covered by the panel's
   * backdrop until the panel is closed or the page reloads).
   */
  readonly paymentError: Locator;
  readonly paymentErrorTitle: Locator;
  readonly paymentErrorOkButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.heading = page.getByRole('heading', { name: 'Checkout', exact: true });
    // Innermost element holding both the heading and the offers — the panel.
    this.root = page
      .locator('div')
      .filter({ has: this.heading })
      .filter({ has: page.getByRole('radiogroup') })
      .last();
    this.closeButton = this.root.getByRole('button', { name: 'Close' }).first();
    this.offers = this.root.getByRole('radio');
    this.billingName = this.root.getByRole('textbox', { name: 'Name as appears on the card' });
    this.country = this.root.getByRole('combobox', { name: 'Select Country' });
    this.state = this.root.getByRole('combobox', { name: /^State/ });
    this.zip = this.root.getByTestId('codeBillingInput');
    this.completePurchaseButton = this.root.getByRole('button', { name: 'Complete Purchase' });
    this.card = new StripeCardForm(page);
    this.paymentError = page.getByText(/Failed to confirm payment/i);
    this.paymentErrorTitle = page.getByText('Oh Snap!', { exact: true });
    this.paymentErrorOkButton = page.getByRole('button', { name: 'Ok', exact: true });
  }

  /** Product name block — the video title rendered under the heading. */
  productName(title: string): Locator {
    return this.root.getByText(title, { exact: true }).first();
  }

  offer(label: OfferLabel): Locator {
    return this.root.getByRole('radio', { name: label, exact: true });
  }

  /** The price text rendered next to an offer, e.g. "EUR €7.37". */
  offerPrice(label: OfferLabel): Locator {
    // Row shape: <div><button role=radio/><div><span>labels</span><span>price</span></div></div>
    return this.offer(label).locator('xpath=following-sibling::div[1]/span[last()]');
  }

  summaryValue(label: SummaryLabel): Locator {
    return this.root.locator(
      `xpath=.//span[starts-with(normalize-space(.), "${label}")]/following-sibling::span[1]`,
    );
  }

  async readOfferPrice(label: OfferLabel): Promise<number> {
    return parsePrice(await this.offerPrice(label).innerText());
  }

  async readSummary(label: SummaryLabel): Promise<number> {
    return parsePrice(await this.summaryValue(label).innerText());
  }

  async selectOffer(label: OfferLabel): Promise<void> {
    await this.offer(label).click();
  }

  async fillBilling(billing: BillingDetails): Promise<void> {
    await this.billingName.fill(billing.name);
    await this.country.click();
    await this.page.getByRole('option', { name: billing.country, exact: true }).click();
    await this.state.click();
    await this.page.getByRole('option', { name: billing.state, exact: true }).click();
    await this.zip.fill(billing.zip);
  }

  async completePurchase(): Promise<void> {
    await this.completePurchaseButton.click();
  }

  async close(): Promise<void> {
    await this.closeButton.click();
  }
}

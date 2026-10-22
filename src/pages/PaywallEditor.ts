// src/pages/PaywallEditor.ts
//
// Admin-side paywall configuration for a video page.
//
// Path (codegen + probe, 2026-10-22):
//   video page (admin) → bottom bar "Paywall" (`paywallPreviewButton`)
//   → "Edit Paywall" (`editGate`) → editor with a live Checkout preview
//   → "Paywall Settings" → Video Settings modal, Paywall tab:
//       One-Time Purchase  [checkbox] → price + currency
//       Rental             [checkbox] → start-watching / rental period + price
//       Included with Membership [checkbox] → "Add Membership" (catalog)
//       Included with Ticket     [checkbox] → "Add Ticket" (catalog)
//   → Save (`video-settings-modal-save`).
//
// Save alone persists: it upserts the per-video products
// (POST subscription/v2/<id>, sku `vod-purchase-<videoId>` /
// `vod-rental-<videoId>`) and PATCHes the page's `gate`. No Publish needed.
//
// TRAP: both price inputs carry the SAME testid (`priceInput-0`) — one under
// the one-time pricing block, one under the rental block. Always scope a
// price input to its section, or you set the wrong product's price.

import type { Page, Locator, Request, Response } from 'patchright/test';
import { CheckoutPanel } from './CheckoutPanel';
import { parsePrice } from '../utils/paywallData';
import { videoPageUrl } from '../utils/videoPage';

/** Paywall options, keyed by their testid suffix. */
export type PaywallOption = 'one-time-purchase' | 'rental' | 'membership' | 'ticket';

export interface SaveResult {
  /** Status of the PATCH that writes the page's gate config. */
  gateSaveStatus: number;
  /** Request bodies of the product upserts sent during the save. */
  productUpserts: Array<{ type?: string; prices?: Array<{ value: number; currency: string }> }>;
}

export class PaywallEditor {
  readonly page: Page;
  readonly adminBar: Locator;
  readonly paywallPreviewButton: Locator;
  readonly paywallStatus: Locator;
  readonly editGateButton: Locator;
  readonly exitEditorButton: Locator;
  readonly settingsButton: Locator;
  /** The editor's live preview of the viewer checkout. */
  readonly preview: CheckoutPanel;

  // Video Settings modal
  readonly paywallTab: Locator;
  readonly saveButton: Locator;
  readonly oneTimePrice: Locator;
  readonly rentalPrice: Locator;

  constructor(page: Page) {
    this.page = page;
    this.adminBar = page.locator('#admin-bar');
    this.paywallPreviewButton = page.getByTestId('paywallPreviewButton');
    this.paywallStatus = page.getByTestId('paywallStatusIndicator');
    this.editGateButton = page.getByTestId('editGate');
    this.exitEditorButton = page.getByTestId('exitEditorButton');
    // Two "Paywall Settings" buttons render (sidebar + preview footer); both open the modal.
    this.settingsButton = page.getByRole('button', { name: 'Paywall Settings' }).first();
    this.preview = new CheckoutPanel(page);

    this.paywallTab = page.getByRole('tab', { name: 'Paywall' });
    this.saveButton = page.getByTestId('video-settings-modal-save');
    this.oneTimePrice = page
      .getByTestId('video-settings-paywall-one-time-purchase-pricing')
      .getByTestId('priceInput-0');
    this.rentalPrice = page.getByTestId('video-settings-paywall-rental-rental').getByTestId('priceInput-0');
  }

  /** The Radix checkbox button inside an option's label. */
  optionCheckbox(option: PaywallOption): Locator {
    return this.page.getByTestId(`video-settings-paywall-${option}`).getByRole('checkbox');
  }

  /** Navigate to the video page and enter the paywall editor. */
  async open(): Promise<void> {
    await this.page.goto(videoPageUrl());
    await this.adminBar.waitFor({ state: 'visible', timeout: 45_000 });
    await this.paywallPreviewButton.click();
    await this.editGateButton.click();
    await this.settingsButton.waitFor({ state: 'visible', timeout: 30_000 });
  }

  /** Open the Video Settings modal on its Paywall tab. */
  async openSettings(): Promise<void> {
    await this.settingsButton.click();
    await this.saveButton.waitFor({ state: 'visible', timeout: 30_000 });
    await this.paywallTab.click();
  }

  async isOptionEnabled(option: PaywallOption): Promise<boolean> {
    return (await this.optionCheckbox(option).getAttribute('aria-checked')) === 'true';
  }

  async setOptionEnabled(option: PaywallOption, enabled: boolean): Promise<void> {
    if ((await this.isOptionEnabled(option)) !== enabled) {
      await this.optionCheckbox(option).click();
    }
  }

  async readOneTimePrice(): Promise<number> {
    return parsePrice(await this.oneTimePrice.inputValue());
  }

  async setOneTimePrice(price: number): Promise<void> {
    await this.oneTimePrice.fill(price.toFixed(2));
  }

  /**
   * Click Save and wait for the gate write to land. Returns the gate PATCH
   * status and the product upsert payloads, so specs can assert the
   * server received the price they typed — not just that the modal closed.
   */
  async save(): Promise<SaveResult> {
    const productUpserts: SaveResult['productUpserts'] = [];
    // Save is a chain (video POST → product upserts → gate PATCH). Track
    // every API call it makes so a stalled save reports WHICH call stalled
    // or failed instead of a bare waitForResponse timeout.
    const calls = new Map<Request, string>();
    const onRequest = (req: Request) => {
      if (!/api\.maestro\.io/.test(req.url()) || req.method() === 'GET') return;
      calls.set(req, 'pending');
      if (req.method() === 'POST' && /\/subscription\/v2\/[a-f0-9]+$/.test(req.url())) {
        productUpserts.push(req.postDataJSON() as SaveResult['productUpserts'][number]);
      }
    };
    const onFinished = async (req: Request) => {
      if (calls.has(req)) calls.set(req, String((await req.response())?.status() ?? 'no response'));
    };
    const onFailed = (req: Request) => {
      if (calls.has(req)) calls.set(req, `failed: ${req.failure()?.errorText ?? 'unknown'}`);
    };
    this.page.on('request', onRequest);
    this.page.on('requestfinished', onFinished);
    this.page.on('requestfailed', onFailed);
    try {
      const gateSave = this.page.waitForResponse(
        (r: Response) => /\/page\/v2\/[a-f0-9]+$/.test(r.url()) && r.request().method() === 'PATCH',
        { timeout: 45_000 },
      );
      await this.saveButton.click();
      const response = await gateSave.catch(async (err: Error) => {
        const trail = [...calls].map(([req, state]) => `  ${req.method()} ${req.url()} → ${state}`).join('\n');
        const saveState = (await this.saveButton.isVisible().catch(() => false))
          ? `Save still visible (disabled=${await this.saveButton.isDisabled().catch(() => '?')})`
          : 'Save hidden';
        throw new Error(
          `[PaywallEditor] gate PATCH never arrived after Save. ${saveState}.\n` +
            `API writes during save:\n${trail || '  (none — the click started no request)'}\n${err.message}`,
        );
      });
      await this.saveButton.waitFor({ state: 'hidden', timeout: 30_000 });
      return { gateSaveStatus: response.status(), productUpserts };
    } finally {
      this.page.off('request', onRequest);
      this.page.off('requestfinished', onFinished);
      this.page.off('requestfailed', onFailed);
    }
  }

  /**
   * Setup shortcut for specs whose subject is the VIEWER: make one-time
   * purchase available at `price`. The admin spec drives the same steps
   * individually, with assertions after each.
   */
  async configureOneTimePurchase(price: number): Promise<SaveResult> {
    await this.open();
    await this.openSettings();
    await this.setOptionEnabled('one-time-purchase', true);
    await this.setOneTimePrice(price);
    return this.save();
  }
}

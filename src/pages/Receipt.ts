// src/pages/Receipt.ts
//
// Post-purchase receipt panel ("Thank you for your purchase!"). It is the
// only viewer-visible record of what was actually CHARGED, so specs compare
// it against the checkout they paid from (price shown == amount charged).
//
// Structure (probe 2026-10-22, testids `vod-receipt-*`):
//   title · receipt id pill · hero card (video title)
//   summary box, label/value lines:
//     Card ending in            *4242
//     Video On Demand Purchase  EUR €7.53
//     Service Charge            EUR €1.36
//     Tax                       EUR €0.00
//     Total Amount              EUR €8.89
//   Watch Now · "A receipt has been sent to <email>"
//
// The summary is parsed from its text (label line followed by value line)
// rather than by DOM position, so cosmetic restructuring doesn't break it.

import type { Page, Locator } from 'patchright/test';
import { parsePrice } from '../utils/paywallData';

export type ReceiptLine = 'Card ending in' | 'Video On Demand Purchase' | 'Service Charge' | 'Tax' | 'Total Amount';

export class Receipt {
  readonly page: Page;
  readonly root: Locator;
  readonly title: Locator;
  readonly receiptId: Locator;
  readonly summary: Locator;
  readonly watchNowButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('vod-receipt-modal-scroll-inner');
    this.title = page.getByTestId('vod-receipt-title');
    this.receiptId = page.getByTestId('vod-receipt-id-pill');
    this.summary = page.getByTestId('vod-receipt-summary-box');
    this.watchNowButton = page.getByTestId('vod-receipt-watch-now-button');
  }

  /** Summary lines as label → value text. */
  async readLines(): Promise<Map<string, string>> {
    const lines = (await this.summary.innerText())
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const out = new Map<string, string>();
    for (let i = 0; i + 1 < lines.length; i += 2) out.set(lines[i]!, lines[i + 1]!);
    return out;
  }

  async readLine(label: ReceiptLine): Promise<string> {
    const value = (await this.readLines()).get(label);
    if (value === undefined) {
      throw new Error(`[Receipt] no "${label}" line in summary: ${[...(await this.readLines()).keys()].join(', ')}`);
    }
    return value;
  }

  async readAmount(label: Exclude<ReceiptLine, 'Card ending in'>): Promise<number> {
    return parsePrice(await this.readLine(label));
  }
}

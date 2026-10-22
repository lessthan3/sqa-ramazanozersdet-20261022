// src/pages/Paywall.ts
//
// The paywall overlay a non-entitled viewer sees on a gated video page:
// marketing copy, the "Get Access" CTA ("Watch Now" once entitled), and the secondary links
// ("Already purchased? Log in", "Have an access code? Enter Code",
// "Purchased ticket with a different account? Switch Account").
//
// Selectors probed 2026-10-22 on the dev video page. Only the root and the CTA
// wrapper carry testids; the buttons are matched by role + name scoped to the
// root, so the top-bar "Log in" (user-login-action) can never be picked up.

import type { Page, Locator } from 'patchright/test';

export class Paywall {
  readonly page: Page;
  readonly root: Locator;
  /** Editable marketing copy blocks (title, description). */
  readonly copyBlocks: Locator;
  readonly getAccessButton: Locator;
  /**
   * The CTA an ENTITLED viewer gets in place of "Get Access" when the page
   * loads (observed 2026-10-22: after a reload or fresh login the landing
   * still renders, but the CTA flips to "Watch Now"). Clicking it plays.
   */
  readonly watchNowButton: Locator;
  /** "Already purchased? Log in" — anonymous viewers only. */
  readonly loginButton: Locator;
  readonly enterCodeButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.getByTestId('paywall');
    this.copyBlocks = this.root.getByTestId('text-editor-input');
    this.getAccessButton = this.root.getByRole('button', { name: 'Get Access' });
    this.watchNowButton = this.root.getByRole('button', { name: 'Watch Now' });
    this.loginButton = this.root.getByRole('button', { name: /^log in$/i });
    this.enterCodeButton = this.root.getByRole('button', { name: 'Enter Code' });
  }

  async getAccess(): Promise<void> {
    await this.getAccessButton.click();
  }

  async watchNow(): Promise<void> {
    await this.watchNowButton.click();
  }

  async openLogin(): Promise<void> {
    await this.loginButton.click();
  }
}

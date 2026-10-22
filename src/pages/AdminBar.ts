// src/pages/AdminBar.ts
//
// Admin sidebar shell. The 10 sidebar icons have no `data-testid` in the live
// Maestro web surface — selection is by SVG `<path d>` prefix per
// `reports/sidebar-svg-dump.json` (captured 2026-05-21, after a
// product-evolution trim of two sidebar entries). When/if the Maestro team adds
// testids to these buttons, swap the d-prefix selectors here and every spec
// inherits the upgrade automatically.
//
// Semantic mapping derived from icon shapes in the dump (button indices 0–9):
//
//   button[0]  M9 2v4m4-4v2M4 9...    — looks like calendar/event icon
//   button[1]  M2 10c0-2.8 0-...      — rounded square (chat-bubble-ish)
//   button[2]  M15 2v20m-5 0h4...     — split panel → Panels view (verified
//                                       by `tabs.spec.ts` clicking this and
//                                       seeing "Panel Settings" render)
//   button[3]  M12 4c-.697 0-...      — gear cog → settings
//   button[4]  M18 8v4m0-4h-4...      — arrow/share
//   button[5]  M15 10a4 4 0 0...      — people/users
//   button[6]  M15 22H6.8c-1.68...    — folder/clipboard
//   button[7]  M2.5 8h19M6 12h4...    — cards/grid lines
//   button[8]  M15 16a7 7 0 0...      — testid `adminbarSiteSettings`
//                                       (the ONLY sidebar button with a testid)
//   button[9]  M12.5 16a.5.5 0 0...   — speech-bubble/help/chat-bot
//
// Some semantic labels are best-guess — the test suite cares about presence
// + click behavior; if owner labels these officially later, rename methods
// here and update spec call sites.

import type { Page, Locator } from 'patchright/test';

export class AdminBar {
  readonly page: Page;
  readonly root: Locator;

  // Sidebar entries — `:has(path[d^=...])` is the Phase 1-validated selector
  // shape; index in comment refers to reports/sidebar-svg-dump.json button
  // ordering.
  readonly calendarButton: Locator; // button[0]
  readonly chatButton: Locator; // button[1]
  readonly panelsButton: Locator; // button[2] — verified opens Panels
  readonly settingsButton: Locator; // button[3] — gear cog (sidebar)
  readonly shareButton: Locator; // button[4]
  readonly peopleButton: Locator; // button[5]
  readonly libraryButton: Locator; // button[6] — folder/clipboard
  /**
   * @deprecated On current staging this path is Billing (wallet), not a
   * separate "cards" entry. Prefer `billingButton` / `gotoBilling()`.
   */
  readonly cardsButton: Locator; // button[7] — live path opens Billing
  readonly siteSettingsButton: Locator; // button[8] — testid available
  /** Ads action (megaphone) inside the EXPANDED Advanced Settings group. */
  readonly siteAdsButton: Locator;
  readonly helpButton: Locator; // button[9]
  /**
   * Billing tab. Prefer `[data-testid="action-billing"]` when deployed;
   * on current pearl staging the wallet icon path is `M2.5 8h19…`.
   */
  readonly billingButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = page.locator('#admin-bar');
    this.calendarButton = page.locator('button:has(path[d^="M9 2v4m"])');
    this.chatButton = page.locator('button:has(path[d^="M2 10c0"])');
    this.panelsButton = page.locator('button:has(path[d^="M15 2v2"])');
    // Gear-cog path is reused by every panel-card cog button on the open
    // Panels page (26 total matches per Phase 1 audit). `.first()` narrows
    // to the document-order-first instance, which is the sidebar entry.
    this.settingsButton = page
      .locator('button:has(path[d^="M12 4c-.697"])')
      .first();
    this.shareButton = page.locator('button:has(path[d^="M18 8v4"])');
    this.peopleButton = page.locator('button:has(path[d^="M15 10a4"])');
    this.libraryButton = page.locator('button:has(path[d^="M15 22H6"])');
    this.cardsButton = page.locator('button:has(path[d^="M2.5 8h19M6"])');
    this.siteSettingsButton = page.locator(
      `[data-testid="adminbarSiteSettings"]`,
    );
    // Prefer testid when deployed. Staging currently ships the wallet icon
    // as path `M2.5 8h19…` (same node as legacy `cardsButton`). Also accept
    // the newer nav2-billing path (`M6.29013…`) once that asset rolls out.
    this.billingButton = page
      .locator('[data-testid="action-billing"]')
      .or(this.root.locator('button:has(path[d^="M2.5 8h19"])'))
      .or(this.root.locator('button:has(path[d^="M6.29013"])'));
    // NS-11413 Story 6 (2026-08-26): the Ads action inside the EXPANDED
    // Advanced Settings group (clicking adminbarSiteSettings REPLACES the
    // toolbar with the settings submenu; Ads is its last action, a megaphone,
    // path M10 7H6a4… — probe tests/ad/tmp-census run 4). Prefer the
    // product testid (action-siteAds, shipped with this branch) once the
    // bundle deploys; the path prefix is the live-today fallback.
    this.siteAdsButton = page
      .locator('[data-testid="action-siteAds"]')
      .or(this.root.locator('button:has(path[d^="M10 7H6a4"])'));
    // Phase 3 audit (Port B): the original Phase 2 mapping used
    // path[d^="M15 16a7"] for helpButton, but that prefix actually matches
    // button[8] (adminbarSiteSettings) — same element as siteSettingsButton
    // above. Correct button[9] prefix per the dump is `M12.5 16` (the
    // help/chat-bot speech bubble icon).
    this.helpButton = page.locator('button:has(path[d^="M12.5 16"])');
  }

  /**
   * Returns true if the admin shell is rendered. Viewer-role accounts do NOT
   * see `#admin-bar`; this is the canonical "am I an admin" predicate used
   * by smoke tests.
   */
  async isVisible(): Promise<boolean> {
    return await this.root.isVisible();
  }

  /** Wait for the admin shell to render. Throws if not visible within timeout. */
  async waitForVisible(): Promise<void> {
    // Explicit budget rather than the 15s default actionTimeout — the admin
    // shell is the heaviest bundle on the site and routinely exceeds 15s on a
    // dev cold load (NS-11583).
    await this.root.waitFor({ state: 'visible', timeout: 45_000 });
  }

  /** Click the Panels sidebar entry. Verified by `tabs.spec.ts` to open the
   *  Panel Settings / Active Panels / Available Panels view. */
  async gotoPanels(): Promise<void> {
    await this.panelsButton.click();
  }

  async gotoCalendar(): Promise<void> {
    await this.calendarButton.click();
  }
  async gotoChat(): Promise<void> {
    await this.chatButton.click();
  }
  async gotoSettings(): Promise<void> {
    await this.settingsButton.click();
  }
  /** Expand the Advanced Settings group and open the Ads config tab. */
  async gotoSiteAds(): Promise<void> {
    await this.siteSettingsButton.click();
    await this.siteAdsButton.click();
  }
  async gotoShare(): Promise<void> {
    await this.shareButton.click();
  }
  /**
   * Alias for gotoShare() — verified by the Olares-tier first batch
   * (earnings-view-earnings port, 2026-05-22) that the `M18 8v4` SVG
   * path opens the Analytics shell (sub-nav exposes Earnings). Earlier
   * best-guess labelling called this "share" — keep that name for back-
   * compat and add the semantic alias here.
   */
  async gotoAnalytics(): Promise<void> {
    await this.shareButton.click();
  }
  async gotoPeople(): Promise<void> {
    await this.peopleButton.click();
  }
  /**
   * Alias for gotoPeople() — verified by the Olares-tier first batch
   * (export-community-list port, 2026-05-22) that the `M15 10a4` SVG
   * path opens the Community shell (the People icon IS the Community
   * entry per the live label "Community" in the result-actions-filter
   * dump). Keep gotoPeople for back-compat and add the semantic alias
   * here.
   */
  async gotoCommunity(): Promise<void> {
    await this.peopleButton.click();
  }
  async gotoLibrary(): Promise<void> {
    await this.libraryButton.click();
  }
  async gotoCards(): Promise<void> {
    await this.cardsButton.click();
  }
  async gotoSiteSettings(): Promise<void> {
    await this.siteSettingsButton.click();
  }
  /** Open the Billing admin tab (SaaS plan / payment methods / payouts). */
  async gotoBilling(): Promise<void> {
    await this.billingButton.waitFor({ state: 'visible', timeout: 30_000 });
    await this.billingButton.click();
  }
  async gotoHelp(): Promise<void> {
    await this.helpButton.click();
  }

  /**
   * Assert every sidebar entry is present. Used by the migrated
   * `tabs.spec.ts` to validate that the admin shell renders with the
   * expected 10-icon sidebar (current product state).
   */
  allSidebarLocators(): ReadonlyArray<Locator> {
    return [
      this.calendarButton,
      this.chatButton,
      this.panelsButton,
      this.settingsButton,
      this.shareButton,
      this.peopleButton,
      this.libraryButton,
      this.cardsButton,
      this.siteSettingsButton,
      this.helpButton,
    ];
  }
}

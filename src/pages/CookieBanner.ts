// src/pages/CookieBanner.ts
//
// First-visit cookie consent banner. Every test that starts from a fresh
// (unauthenticated) profile will hit this. Once dismissed, the rejection
// state persists in localStorage for the worker context lifetime.
//
// Selectors verified against int-automation 2026-05-22 — see
// `tests/admin/tabs.spec.ts` inlined loginAdmin (now retired) and the
// Phase 1 `error-context.md` accessibility tree which captured
// `- text: "..." (.message)` + `- button.reject`.

import type { BrowserContext, Page, Locator } from 'patchright/test';
import {
  acceptedTermsKey,
  resolveBrowserSiteId,
  TERMS_REJECTED,
} from '../utils/siteId';

/**
 * Seed rejected GDPR terms for `siteId` so the banner never mounts.
 * Billing SSU mints are a different site than BASE_URL/int-automation —
 * fixture init only seeds that site, and `#gdpr` then intercepts Purchase.
 */
export async function seedRejectedConsent(
  context: BrowserContext,
  siteId: string,
): Promise<void> {
  if (!siteId) return;
  await context.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // about:blank / opaque origins deny localStorage.
      }
    },
    [acceptedTermsKey(siteId), TERMS_REJECTED] as const,
  );
}

export class CookieBanner {
  readonly page: Page;
  readonly root: Locator;
  readonly rejectButton: Locator;

  constructor(page: Page) {
    this.page = page;
    // The banner renders as a `.message` block (first match — there can be
    // sibling `.message` elements in the chat panel later, so `.first()`
    // is load-bearing).
    this.root = page.locator('.message').first();
    this.rejectButton = page.locator('button.reject');
  }

  /** Present iff the reject button is. `.message` alone also matches chat rows. */
  async isVisible(): Promise<boolean> {
    return await this.rejectButton.isVisible();
  }

  /** True when consent is already stored, so the banner cannot render. */
  private async consentSeeded(): Promise<boolean> {
    // Minted SSU sites use a different siteId than BASE_URL. If #gdpr is
    // actually on screen, skip the early-return and dismiss it.
    if (await this.page.locator('#gdpr').isVisible().catch(() => false)) {
      return false;
    }
    const siteId = resolveBrowserSiteId();
    if (!siteId) return false;
    return await this.page
      .evaluate((key) => {
        try {
          return localStorage.getItem(key) !== null;
        } catch {
          return false;
        }
      }, acceptedTermsKey(siteId))
      .catch(() => false);
  }

  /** Wait for the banner to appear, then dismiss it. */
  async reject(): Promise<void> {
    await this.root.waitFor({ state: 'visible' });
    await this.rejectButton.click();
  }

  /**
   * Phase 4.1 — banner-dismissal that tolerates absence + late render.
   *
   * The banner may or may not appear on a given page load (storageState may
   * carry a prior dismissal cookie, or may not, depending on the origin the
   * dismissal was written against). When it DOES appear, it intercepts
   * pointer events on form CTAs — verified during Phase 4.1 probe against
   * the channel-editor's Publish button.
   *
   * Strategy: poll for the reject button up to `timeoutMs`. If found,
   * click it and wait for it to detach. If not found within the budget,
   * return cleanly — the banner isn't there, nothing to dismiss.
   * Subsequent waits on the banner being gone (`waitFor({state:"hidden"})`)
   * use the SAME deterministic signal the click would produce, so callers
   * don't race a re-render.
   *
   * Default budget 2000ms: every caller invokes this right after
   * `page.goto(BASE_URL)` (which already awaits load), so the banner's first
   * render window mostly overlaps the navigation. 2s leaves headroom for a
   * late first-render on slow staging without paying the old 5s per startup.
   */
  async dismissIfPresent(timeoutMs = 2000): Promise<boolean> {
    // Consent is seeded at context launch, so the banner normally never
    // renders. Skip the poll rather than burn its budget on every call.
    if (await this.consentSeeded()) return false;
    // Prefer Reject (persists decline); fall back to Accept Cookies — both
    // clear the bottom overlay that intercepts the admin toolbar. The
    // fallback is load-bearing: the click branches below both reference it.
    const accept = this.page.getByRole('button', { name: /accept cookies/i });
    try {
      await this.rejectButton
        .or(accept)
        .first()
        .waitFor({ state: 'visible', timeout: timeoutMs });
    } catch {
      return false;
    }
    if (await this.rejectButton.isVisible().catch(() => false)) {
      await this.rejectButton.click();
      await this.rejectButton.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
    } else {
      await accept.click();
      await accept.waitFor({ state: 'detached', timeout: 5000 }).catch(() => undefined);
    }
    return true;
  }
}

// src/pages/VideoPage.ts
//
// The video page under test, from the viewer's side. Composes the paywall
// overlay and the checkout panel, and owns the two things every paywall
// assertion needs:
//
//   * navigation that also captures the server's access decision
//     (caniplay), so "what the viewer sees" and "what the server decided"
//     come from the same page load;
//   * a real playback probe. "Playback available" means the <video> element
//     actually advanced, not that a player node exists — a player can mount
//     behind an overlay, or mount and fail to load the stream.

import type { Page, Locator } from 'patchright/test';
import { Paywall } from './Paywall';
import { CheckoutPanel } from './CheckoutPanel';
import { AuthModal } from './AuthModal';
import { CookieBanner } from './CookieBanner';
import { Receipt } from './Receipt';
import { captureAccessCheck, type AccessDecision } from '../api/caniplay';
import { videoPageUrl } from '../utils/videoPage';

export class VideoPage {
  readonly page: Page;
  readonly paywall: Paywall;
  readonly checkout: CheckoutPanel;
  readonly receipt: Receipt;
  readonly authModal: AuthModal;
  /** The page's video block (admin view showed `video-block-<arrayId>`). */
  readonly videoBlock: Locator;
  readonly video: Locator;
  /** Signed-in viewer's display name in the sidebar auth header. */
  readonly signedInUser: Locator;
  /**
   * Second-context viewer pages (openAnonymousPage) re-render the consent
   * banner after navigation, and it overlaps the paywall's bottom links
   * ("Already purchased? Log in"). dismissIfPresent is a no-op when consent
   * is already stored.
   */
  private readonly cookieBanner: CookieBanner;

  constructor(page: Page) {
    this.page = page;
    this.cookieBanner = new CookieBanner(page);
    this.paywall = new Paywall(page);
    this.checkout = new CheckoutPanel(page);
    this.receipt = new Receipt(page);
    this.authModal = new AuthModal(page);
    this.videoBlock = page.locator('[data-testid^="video-block-"]');
    this.video = page.locator('video').first();
    this.signedInUser = page.getByTestId('user-username');
  }

  /** Open the video page; resolves with the access decision for this load. */
  async goto(): Promise<AccessDecision> {
    const decision = await captureAccessCheck(this.page, () => this.page.goto(videoPageUrl()));
    await this.cookieBanner.dismissIfPresent();
    return decision;
  }

  /** Reload; resolves with the access decision for the new load. */
  async reload(): Promise<AccessDecision> {
    const decision = await captureAccessCheck(this.page, () => this.page.reload());
    await this.cookieBanner.dismissIfPresent();
    return decision;
  }

  /**
   * Seconds of media actually played (sum of `video.played` ranges).
   * 0 when there is no <video> yet. The clip is ~4s long and may end or
   * loop, so this is used instead of `currentTime`.
   */
  async secondsPlayed(): Promise<number> {
    if ((await this.video.count()) === 0) return 0;
    return this.video.evaluate((el) => {
      const v = el as HTMLVideoElement;
      let total = 0;
      for (let i = 0; i < v.played.length; i++) total += v.played.end(i) - v.played.start(i);
      return total;
    });
  }

  /**
   * Simulate a viewer deleting the paywall overlay in DevTools. If the gate
   * were only cosmetic, the player (or the stream) would surface underneath.
   */
  async removePaywallOverlay(): Promise<void> {
    await this.paywall.root.evaluate((el) => el.remove());
  }

  /**
   * Hold for a fixed window. Negative assertions ("no stream is fetched")
   * can only be made over time; this keeps that wait explicit and named
   * instead of a bare sleep in a spec.
   */
  async observeFor(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  /**
   * Start playback the way a viewer would if autoplay did not: click the
   * player. No-op when media is already advancing.
   */
  async startPlaybackIfIdle(): Promise<void> {
    await this.video.waitFor({ state: 'attached', timeout: 30_000 });
    if ((await this.secondsPlayed()) > 0) return;
    const paused = await this.video.evaluate((el) => (el as HTMLVideoElement).paused);
    if (paused) await this.videoBlock.first().click();
  }
}

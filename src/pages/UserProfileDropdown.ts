// src/pages/UserProfileDropdown.ts
//
// Top-bar user profile dropdown. Trigger:
// `[data-testid="userProfileViewButton"]` — verified rendered after admin
// login in the Phase 1 inlined `loginAdmin` final assertion. Clicking it
// toggles a panel that exposes "Log out" + "Edit Profile" buttons (captured
// in the Phase 1 `error-context.md` accessibility tree:
//   - text: Profile Settings
//   - button "Log out"
//   - button
//   - button "Edit Profile"
//
// The trigger TOGGLES — clicking the testid a second time closes the panel
// rather than re-opening it. POM methods are explicit about open/close state
// so callers don't accidentally double-click and close the panel they wanted
// open (a footgun documented in `_archive/helpers/qawolf-helpers.mjs:117-119`
// from the QAWolf-era loginAdmin helper).

import type { Page, Locator } from 'patchright/test';

export class UserProfileDropdown {
  readonly page: Page;
  readonly trigger: Locator;
  readonly logoutButton: Locator;
  readonly editProfileButton: Locator;
  readonly profileSettingsHeading: Locator;
  readonly usernameLabel: Locator;
  readonly editButtonParent: Locator;
  /** Mobile bottom-tab-bar profile entry (no desktop avatar below the breakpoint). */
  readonly mobileTrigger: Locator;
  /** The trigger this layout actually renders — desktop avatar or mobile tab. */
  readonly anyTrigger: Locator;

  constructor(page: Page) {
    this.page = page;
    this.trigger = page.locator(`[data-testid="userProfileViewButton"]`);
    // Phase 3 probe (2026-05-22, _archive/tests/_probe-profile-panel.spec.ts)
    // confirmed both buttons carry stable testids: upLogOutButton,
    // upEditButton. Phase 2 used name-based getByRole which still works
    // but the testid form is more stable across copy/i18n changes.
    this.logoutButton = page.locator(`[data-testid="upLogOutButton"]`);
    this.editProfileButton = page.locator(`[data-testid="upEditButton"]`);
    // Panel-open predicate. Product renamed the panel heading from
    // "Profile Settings" → "User profile" (2026-05-26; observed when the
    // auth blast-radius check ran the log-in-and-out specs — the
    // dropdown opened correctly but the old text predicate timed out). Per
    // this POM's own stability note (prefer testids over copy), switch the
    // open-predicate to the panel's `upEditButton` ("Edit Profile"), which
    // only renders inside the open panel and is copy/i18n-immune. The
    // `profileSettingsHeading` name is retained for callers but now points
    // at that testid.
    this.profileSettingsHeading = page.locator(`[data-testid="upEditButton"]`);
    // user-username is a SPAN inside the open panel; visible value = the
    // account's username (e.g. "automation-admin" for the int-automation
    // admin role).
    this.usernameLabel = page.locator(`[data-testid="user-username"]`);
    // Profile-panel username block. Used by Port A to assert the username
    // via toContainText scoped to the open panel.
    //
    // 2026-05-26: the panel was redesigned (heading renamed "Profile
    // Settings" → "User profile"; the a11y tree now shows `Edit Profile`
    // living in a separate `banner` header from the username block). The old
    // `div:has(>[data-testid="upEditButton"])` direct-child selector no
    // longer contains the username — Edit Profile and the username are now
    // siblings, not parent/child. Re-anchor on the `user-username` testid's
    // own container (the block that carries the username heading + "Member
    // since" line), which is copy/i18n-immune and still scopes the
    // assertion to the open panel.
    // Direct-child combinator (`>`) is load-bearing, NOT a fragility: with
    // `:has()` a DESCENDANT selector (`div:has([data-testid="user-username"])`)
    // matches EVERY ancestor div of the username — the panel wrapper, the
    // modal wrapper, etc. — returning several nodes and breaking the
    // scoped-to-the-username-block intent. `>` pins the match to the username's
    // IMMEDIATE container, which is the only div that directly parents it.
    this.editButtonParent = page.locator(
      `div:has(>[data-testid="user-username"])`,
    );
    // MOBILE entry point. Below the mobile breakpoint the sidebar auth header
    // (and with it `userProfileViewButton`) is not rendered at all — the only
    // way into the profile is the bottom tab bar. Waiting on the desktop
    // trigger there just times out, which is how the TC-3.5 mobile purchase
    // spec failed once it began running at a real 390px viewport.
    //
    // Two selectors, because the suite runs against the DEPLOYED dev.web
    // bundle:
    //   * `mobileTabBar-profileMenu` — the testid added alongside this POM
    //     (client MobileTabBar/TabButton.tsx). Preferred, but absent from the
    //     browser until that client change ships.
    //   * `#mobile-tab > *:last-child` — works on the CURRENT bundle. The tab
    //     bar wrapper carries id=MOBILE_TAB_ID ('mobile-tab', global-ids.ts)
    //     and MobileTabBar maps Object.keys(mobileLayout), declared
    //     home → searchMenu → cartMenu → profileMenu, so profile is always the
    //     LAST tab — including when cartMenu is absent (verified against both
    //     the 3-tab and 4-tab layouts, 2026-08-14).
    // The positional fallback can retire once the testid is on dev.
    this.mobileTrigger = page
      .locator(
        '[data-testid="mobileTabBar-profileMenu"], #mobile-tab > *:last-child',
      )
      .first();
    // Whichever entry point this layout renders.
    this.anyTrigger = this.trigger.or(this.mobileTrigger).first();
  }

  /** True when the trigger itself is rendered (regardless of panel state). */
  async triggerIsVisible(): Promise<boolean> {
    return await this.trigger.isVisible();
  }

  /** Wait for whichever trigger this layout renders (desktop or mobile). */
  async waitForTriggerVisible(): Promise<void> {
    await this.anyTrigger.waitFor({ state: 'visible' });
  }

  /**
   * Open the dropdown if not already open. Detects open state via the
   * "Profile Settings" text, which only renders inside the panel.
   */
  async open(): Promise<void> {
    if (await this.isOpen()) return;
    await this.anyTrigger.click();
    await this.profileSettingsHeading.waitFor({ state: 'visible' });
  }

  /**
   * Close the panel if open. Trigger toggles — only click when open so we
   * don't accidentally open it.
   */
  async close(): Promise<void> {
    if (!(await this.isOpen())) return;
    const closeBtn = this.page.getByRole('button', { name: /^close$/i });
    if (await closeBtn.isVisible().catch(() => false)) {
      await closeBtn.click();
    } else {
      await this.trigger.click();
    }
    await this.profileSettingsHeading
      .waitFor({ state: 'hidden', timeout: 10_000 })
      .catch(() => undefined);
  }

  /** True when the dropdown panel is currently open. */
  async isOpen(): Promise<boolean> {
    return await this.profileSettingsHeading.isVisible();
  }

  /**
   * Open the dropdown if needed, then click Log out. Caller is responsible
   * for asserting post-logout state (typically: AuthModal reopenable).
   */
  async logout(): Promise<void> {
    await this.open();
    await this.logoutButton.click();
  }

  /**
   * Read the visible username text from the open profile panel. Opens the
   * panel if it isn't already open. Returns the trimmed string (e.g.
   * "automation-admin" for the int-automation admin role).
   *
   * Phase 3 reference port A introduced this method — see
   * `tests/auth/log-in-and-out-admin.spec.ts`.
   */
  async username(): Promise<string> {
    await this.open();
    return ((await this.usernameLabel.textContent()) ?? '').trim();
  }
}

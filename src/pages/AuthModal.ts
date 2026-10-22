// src/pages/AuthModal.ts
//
// Maestro web login/registration modal. Encapsulates the 5 testids that drive
// account lookup + password submission, plus the trigger that opens the modal
// from the top-bar "Log in" entry point.
//
// Selectors lifted verbatim from the retired inlined `loginAdmin` helper in
// `tests/admin/tabs.spec.ts` (Phase 1 close, run timestamp 2026-05-22 03:52
// EEST, status "expected"). They are stable testids in the live Maestro web
// surface — `authModal`, `authModalAccountLookupEmailInput`,
// `authModalAccountLookupSubmitButton`, `authModalLoginViewPasswordInput`,
// `authModalLoginViewSubmitButton`. The `user-login-action` trigger uses the
// recorder-inherited `:text("Log in")` fallback chain because the trigger
// node has two possible DOM shapes (text directly on the element vs nested).

import { expect, type Page, type Locator } from 'patchright/test';

export class AuthModal {
  readonly page: Page;
  readonly trigger: Locator;
  readonly triggerFallback: Locator;
  readonly root: Locator;
  readonly emailInput: Locator;
  readonly emailSubmit: Locator;
  readonly passwordInput: Locator;
  readonly passwordSubmit: Locator;
  // Register-view (Create Account) locators — added by Olares-tier first
  // batch (Port 2: create-account-log-in-button.spec.ts, 2026-05-22).
  // Selectors lifted verbatim from the PoC at
  // _archive/scripts/create-account-log-in-button.mjs — all stable
  // `authModalRegisterView*` testids scoped under the `authModal` root.
  readonly registerViewTitle: Locator;
  readonly registerConfirmEmailInput: Locator;
  readonly registerPasswordInput: Locator;
  readonly registerNameInput: Locator;
  readonly registerTermsCheckbox: Locator;
  readonly registerSubmitButton: Locator;
  /** Bare-name `[name="password"]` input — used by password-rules port to
   *  read the CSS border-color (the testid wrapper doesn't carry the
   *  validation styles; the underlying input does). */
  readonly registerPasswordRawInput: Locator;
  /** "I forgot my password" link/button — surfaces on the Log In view
   *  after the email lookup succeeds. Wave 11a (reset-password port). */
  readonly forgotPasswordTrigger: Locator;
  /** "Forgot password?" view heading — confirms the modal advanced into
   *  the forgot-password request view. Wave 11a (reset-password port). */
  readonly forgotPasswordViewHeading: Locator;
  /** Email input on the forgot-password request view. Wave 11a port. */
  readonly forgotPasswordEmailInput: Locator;
  /** Submit button on the forgot-password request view. Wave 11a port. */
  readonly forgotPasswordSubmit: Locator;

  constructor(page: Page) {
    this.page = page;
    this.trigger = page.locator(
      `[data-testid="user-login-action"]:text("Log in")`,
    );
    this.triggerFallback = page.locator(
      `[data-testid="user-login-action"] :text("Log in")`,
    );
    this.root = page.locator(`[data-testid="authModal"]`);
    this.emailInput = this.root.locator(
      `[data-testid="authModalAccountLookupEmailInput"]`,
    );
    this.emailSubmit = this.root.locator(
      `[data-testid="authModalAccountLookupSubmitButton"]`,
    );
    this.passwordInput = this.root.locator(
      `[data-testid="authModalLoginViewPasswordInput"]`,
    );
    this.passwordSubmit = this.root.locator(
      `[data-testid="authModalLoginViewSubmitButton"]`,
    );
    this.registerViewTitle = this.root.locator(
      `[data-testid="authModalRegisterViewTitle"]`,
    );
    this.registerConfirmEmailInput = this.root.locator(
      `[data-testid="authModalRegisterViewConfirmEmailInput"]`,
    );
    this.registerPasswordInput = this.root.locator(
      `[data-testid="authModalRegisterViewPasswordInput"]`,
    );
    this.registerNameInput = this.root.locator(
      `[data-testid="authModalRegisterViewNameInput"]`,
    );
    this.registerTermsCheckbox = this.root.locator(
      `[data-testid="authModalRegisterViewTermsAndPolicyCheckbox"]`,
    );
    this.registerSubmitButton = this.root.locator(
      `[data-testid="authModalRegisterViewSubmitButton"]`,
    );
    // Bare [name="password"] input — page-scoped because the testid wrapper
    // does not carry the validation styling that the raw input element has.
    this.registerPasswordRawInput = page.locator(`[name="password"]`);

    // Forgot-password surface — source flow used button text matchers
    // ("I forgot my password" → "Forgot password?" heading →
    // forgotPasswordModalEmailInput testid → Submit). The testid is
    // stable per the QAWolf source; the button/heading text fallbacks
    // match the source verbatim.
    this.forgotPasswordTrigger = this.root.getByRole('button', {
      name: /I forgot my password/i,
    });
    this.forgotPasswordViewHeading = page.locator(`:text("Forgot password?")`);
    this.forgotPasswordEmailInput = page.locator(
      `[data-testid="forgotPasswordModalEmailInput"]`,
    );
    this.forgotPasswordSubmit = page.getByRole('button', {
      name: /^Submit$/,
    });
  }

  /**
   * Drive the email-lookup flow with a NON-EXISTENT email so the modal
   * advances to the Register (Create Account) view. Returns once the
   * register view's title is visible.
   */
  async openRegisterViaUnknownEmail(email: string): Promise<void> {
    await this.open();
    await this.waitForOpen();
    await this.enterEmail(email);
    await this.submitEmail();
    // Dev cold-loads the register view well past the 15s default
    // actionTimeout this used to inherit — the most frequent flake in the
    // NS-11388 cancel suite was signup, not the flow under test (NS-11583).
    await this.registerViewTitle.waitFor({
      state: 'visible',
      timeout: 45_000,
    });
  }

  /**
   * Click the top-bar "Log in" trigger. Tries the direct-text selector first
   * (5s timeout) and falls back to the nested-text variant — the QAWolf
   * recorder pinned both shapes because the underlying React tree can render
   * either depending on the theme/profile state.
   */
  async open(): Promise<void> {
    // Poll the trigger until the modal is actually OPEN, rather than firing
    // one click and trusting it. While the header is still hydrating on a dev
    // cold load the click resolves successfully but nothing opens — the
    // caller's waitForOpen then burns its whole budget on a modal that was
    // never triggered. That was the single most frequent flake in the
    // NS-11388 cancel suite (NS-11583).
    await expect
      .poll(
        async () => {
          if (await this.root.isVisible().catch(() => false)) return true;
          try {
            await this.trigger.click({ timeout: 5_000 });
          } catch {
            await this.triggerFallback
              .click({ timeout: 5_000 })
              .catch(() => undefined);
          }
          return this.root
            .waitFor({ state: 'visible', timeout: 8_000 })
            .then(() => true)
            .catch(() => false);
        },
        { timeout: 60_000, intervals: [1_000, 2_000, 3_000] },
      )
      .toBe(true);
  }

  /** Wait for the modal root to be visible. */
  async waitForOpen(): Promise<void> {
    // Explicit budget rather than the 15s default actionTimeout: the auth
    // modal waits on app bootstrap, which is the slowest thing on a dev
    // cold load. Raising a wait cannot break a passing test — it only gives a
    // slow one room to succeed (NS-11583).
    await this.root.waitFor({ state: 'visible', timeout: 45_000 });
  }

  /** Wait for the modal root to be hidden (or detached). */
  async waitForClose(): Promise<void> {
    await this.root.waitFor({ state: 'hidden' });
  }

  /**
   * Dismiss the modal by clicking the backdrop. Probed 2026-05-22 against
   * int-automation (see `_archive/tests/_probe-authmodal-close.spec.ts`):
   * the modal has NO X button and Escape does NOT dismiss; the only
   * close affordance is a click on the backdrop overlay (the modal's
   * parent <div>, a 1440x900 full-viewport element). Clicking at (5, 5)
   * is well outside the centered modal box (x=535,y=329,w=370,h=242)
   * and lands on the backdrop reliably across viewport sizes >= ~600px.
   */
  async close(): Promise<void> {
    await this.page.mouse.click(5, 5);
    await this.waitForClose();
  }

  async enterEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  async submitEmail(): Promise<void> {
    await this.emailSubmit.click();
  }

  async enterPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  async submitLogin(): Promise<void> {
    await this.passwordSubmit.click();
  }

  /**
   * High-level orchestration mirroring the retired `loginAdmin`:
   * trigger → email → submit-email → password → submit-login.
   * Does NOT dismiss the cookie banner — callers compose with
   * `CookieBanner.reject()` first when starting from anonymous.
   */
  async login(email: string, password: string): Promise<void> {
    await this.open();
    await this.enterEmail(email);
    await this.submitEmail();
    await this.enterPassword(password);
    await this.submitLogin();
  }
}

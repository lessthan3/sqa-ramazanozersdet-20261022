# Test Plan — Video Page Paywall

**Target:** `https://dev.web.maestro.io/barbara-paxico/v/6a036b749a999d97198446a9`
**Project:** `chromium-admin` · serial · `retries: 0`
**Status:** draft for review (2026-10-22)

---

## 1. Risk model: what we are protecting

Every case in this plan protects against one of these four failures:

| # | Failure | Who is hurt | Example |
|---|---------|-------------|---------|
| R1 | **Paying viewer locked out** | Customer + creator (refunds, churn, support) | Payment succeeds but playback never unlocks, or access is lost after reload/re-login |
| R2 | **Revenue leak: content watchable without paying** | Creator | Gate is only a UI overlay, declined/abandoned payment still grants access, entitlement for A unlocks B |
| R3 | **Wrong money taken** | Customer (trust, chargebacks) | Price on paywall ≠ amount charged; stale price after admin edit |
| R4 | **Admin config silently not applied** | Creator | Save "succeeds" but does not persist, or viewers still see the old/no paywall |

Priority follows from that table:

- **P0** is the core contract. If any P0 fails, the feature is unshippable (R1/R4 happy path).
- **P1** covers the revenue leaks and lockouts in edge paths (R2/R3), plus the second admin path and the other price types.
- **P2** covers real bugs that are lower likelihood or lower impact, or that need setup we don't control.

## 2. What exploration showed (anonymous, 2026-10-22)

| Observation | Impact on the plan |
|---|---|
| Page is **already paywalled**: `[data-testid=paywall]`, CTA "Get Access", 0 `<video>` elements | The viewer flow can be built *before* admin automation exists (see build order) |
| `GET dev.api.maestro.io/caniplay/v1/<videoId>?kind=video&intent=check…` → **401 `{"access":"no_entitlement","paywallSource":"video"}`** | Gives us a **second, server-side oracle**. Every gate assertion checks the UI *and* this response |
| **No price and no product name** on the anonymous paywall, only marketing copy | ❓ Open question. The brief expects both. They may only show after login, or the product has no price. If it's a bug, it's R3 |
| Anonymous "Get Access" → **auth modal** (email lookup → login/register) | A fresh viewer must **register first**. `AuthModal` already supports the register view |
| "Already purchased? **Log in**" link on the paywall | This is the natural path for P0-5 (fresh login) |
| "Have an access code? **Enter Code**" and a **cart** icon (`user-cart-action`) | Alternative entitlement paths. Code redemption is P2; the cart is watched in case checkout routes through it |
| Stripe.js v3 loads on page load | Checkout is probably embedded Stripe Elements (iframes), not a redirect. To be confirmed |

## 3. Test design decisions

**Shared state.** All specs mutate one live video page. To keep that safe:

- Paywall specs run serially (`--workers=1` plus `describe.configure({ mode: 'serial' })` in mutation files).
- Each spec file **establishes the paywall config it needs** in `beforeAll`. No spec relies on whatever a previous run or another candidate left behind.

**Unique data per run.**

- Products are named `QA-<runId>-<type>` (run id = timestamp + short random), so an assertion can never match a stale product.
- Viewers are **freshly registered** with `@faker-js/faker` for every purchase test, because purchases are permanent on an account.
- `VIEWER_USER` is used only for "logged-in, never purchased" checks. Even there, run P0-1's check first: if that account was entitled in an earlier run, fail loudly rather than mask it.

**UI for the thing under test, API for setup (where possible).**

- The admin UI path is exercised fully once (P0-2).
- If DevTools reveals the paywall/product endpoints, other specs set their preconditions through a small `src/api/paywall.ts` client. That is faster and keeps admin-UI flake from failing viewer tests.
- If no usable API exists, fall back to the UI page object.

**Two oracles for access.**

- **UI:** paywall hidden, player visible, and `video.currentTime` advances after play. This is what "playback" means, not merely an element existing.
- **Server:** the `caniplay` response `access` field, captured with `page.waitForResponse`. Not checking it would miss a UI-only gate (R2).

**Single source for the URL.**

- `videoPage: { id: '6a036b749a999d97198446a9' }` goes in the `dev` profile in `src/test-data/environments.ts`.
- The URL is built by one helper. Specs never contain the literal.

**No retries, generous waits.** Stripe iframes and webhook-driven unlocks get explicit, bounded polling (`expect.poll` on `caniplay`), never `waitForTimeout`.

## 4. Test cases

### P0: release blockers

| ID | Flow | Case | Key assertions | Risk |
|----|------|------|----------------|------|
| **P0-1** | Viewer (anon) | **Non-entitled viewer is gated on direct URL load** (read-only, no mutation) | `paywall` visible · CTA visible · no playable `<video>` · `caniplay` → `no_entitlement` | R2 |
| **P0-2** | Admin | **Configure paywall: create a one-time-purchase product inline (unique name + price), save** | Save confirmation · after **reload**, the editor still shows the product name, type and price | R4 |
| **P0-3** | Admin → Viewer | **Saved config reaches viewers** (fresh anonymous context via `openAnonymousPage`) | Paywall shows **this run's** product name + price + CTA · `caniplay` → `no_entitlement` | R4 |
| **P0-4** | Viewer (new) | **Fresh registered viewer buys with `4242 4242 4242 4242` → playback** | Before: gated (also proves "logged in ≠ entitled") · **price shown on paywall == amount on Stripe checkout** · after: paywall gone, video plays, `caniplay` grants access | R1, R3 |
| **P0-5** | Viewer (same) | **Entitlement survives reload and fresh login** | Reload → plays · new browser context → "Already purchased? Log in" → plays **without being asked to pay again** | R1 |

P0-4 and P0-5 run as one serial journey (`test.step`s), so we pay once per run. They stay separate IDs so a failure points at the exact contract that broke.

### P1: revenue leaks, lockout edges, second paths

| ID | Flow | Case | Key assertions | Risk |
|----|------|------|----------------|------|
| **P1-1** | Viewer | **Declined card `4000 0000 0000 0002`** shows an error and grants nothing; **retry with 4242 succeeds** | Stripe/inline error visible · still gated after reload · `caniplay` → `no_entitlement` · retry unlocks (a failed attempt must not leave the viewer stuck) | R2, R1 |
| **P1-2** | Viewer | **Abandoned checkout** (open checkout, close/back out) grants nothing | Still gated after reload + `caniplay` | R2 |
| **P1-3** | Viewer | **Gate is server-side**: non-entitled viewer cannot get the stream by bypassing the overlay | `caniplay` with `intent=play` denied · no stream/manifest URL (`.m3u8`/`.mp4`) in DOM or network for a gated viewer · removing the overlay node does not yield playback | R2 |
| **P1-4** | Admin + Viewer | **Entitlement scope**: buyer of product A is gated when the page requires product B | Viewer buys A → admin swaps page to B only → same viewer gated, offered B | R2 |
| **P1-5** | Admin + Viewer | **Price edit propagates**: admin changes price → paywall and Stripe checkout show the new amount | No stale price on paywall or in checkout | R3, R4 |
| **P1-6** | Admin | **Attach an existing catalog product** (second admin path) and save | Persists across reload · viewer sees it | R4 |
| **P1-7** | Admin + Viewer | **Membership (recurring)** configure + purchase → playback | Subscription checkout completes · unlocks · survives reload | R1, R4 |
| **P1-8** | Admin | **Each remaining price type persists** (rental, ticket) | Config survives reload; viewer paywall lists each option with its price | R4 |
| **P1-9** | Admin + Viewer | **Removing the paywall restores free playback** for anonymous viewers | No paywall · video plays · `caniplay` allows. Also our teardown/baseline-restore path | R4 |

### P2: valuable, lower likelihood or blocked by setup

| ID | Case | Why only P2 |
|----|------|-------------|
| P2-1 | Rental purchase grants access (expiry itself out of scope) | Same unlock path as one-time; differs mainly in expiry, which we can't fast-forward |
| P2-2 | Combined offers (one-time + rental + membership) render as distinct options; each CTA charges its own price | Covered piecemeal by P0-4 / P1-5 / P1-7 |
| P2-3 | 3-D Secure card `4000 0025 0000 3155`: approve → unlocks; fail → gated | Real EU path, but an extra Stripe modal; lower volume on dev |
| P2-4 | Access-code redemption ("Enter Code") unlocks | Needs codes from the interviewer; separate feature surface |
| P2-5 | Purchase in tab A → tab B unlocks after reload | Edge of R1; low likelihood |
| P2-6 | Already-entitled viewer is never shown a purchase CTA (no double charge) | Largely implied by P0-5; explicit check is cheap if time allows |
| P2-7 | Paywall marketing copy edited by admin persists | Cosmetic; no money impact |
| P2-8 | Paywall usable at mobile viewport (CTA reachable, checkout fits) | Layout risk, not logic |

## 5. Deliberately out of scope

| Area | Why that's an acceptable risk here |
|---|---|
| Rental **expiry** / membership **renewal & cancellation** | Time-based. Needs clock control or Stripe test clocks we don't have access to. Better covered at the API/unit level |
| Refunds / chargebacks revoking access | Needs Stripe dashboard actions; backend concern |
| Webhook failure / delay injection | We don't control the backend; we *do* assert unlock within a bounded window, which catches gross latency |
| Other decline codes (insufficient funds, expired, CVC fail) | Same client code path as P1-1; marginal value per minute is low |
| Tax, currency, localisation of prices | One currency on this site; no evidence of tax config |
| Google SSO purchase path | Third-party auth automation is brittle and not paywall logic |
| Admin role permissions (non-admin can't edit paywall) | Authorization feature in its own right; worth a ticket, not this timebox |
| Cross-browser, visual regression, a11y audit, load | Patchright only supports real Chrome here; not where the money risk is |

## 6. Build order (highest value lands first)

1. **Foundation (~short):** put the video id in the env profile plus a URL helper. Build the `VideoPage` / `Paywall` page objects and the `caniplay` response helper. Ship **P0-1**. It's read-only, validates selectors plus the server oracle, and is green before anything mutates.
2. **Money path against the existing config:** registered-viewer factory, `StripeCheckout` page object (frame locators), then **P0-4 + P0-5**. The page is already paywalled, so the most valuable journey exists even if admin automation runs late.
3. **Admin path:** `PaywallEditor` page object, then **P0-2 + P0-3**. Then switch the purchase spec's `beforeAll` to use the admin-created, run-unique product, so it no longer depends on pre-existing state.
4. **Revenue-leak negatives:** **P1-1, P1-2, P1-3** (cheap; reuse step 2's objects).
5. **Scope and propagation:** **P1-4, P1-5, P1-9**.
6. **Second paths / other types:** **P1-6, P1-7, P1-8**.
7. **P2** as time allows, in table order.

If time runs out after step 3, we still have the full brief (both flows end to end) with server-side verification.

## 7. Proposed layout

```
src/test-data/environments.ts   + videoPage.id on the dev profile
src/utils/videoPage.ts          videoPageUrl() — the one place the URL is built
src/utils/testData.ts           runId, uniqueProductName(), fakeViewer()
src/api/caniplay.ts             parse/await caniplay responses (access oracle)
src/api/paywall.ts              (if endpoints found) product + page-paywall setup
src/pages/VideoPage.ts          player, playback assertion
src/pages/Paywall.ts            product name, price, CTA, login/code links
src/pages/StripeCheckout.ts     card entry via frameLocator, submit, error text
src/pages/PaywallEditor.ts      admin: open editor, create/attach product, save
tests/paywall/01-gate.spec.ts               P0-1, P1-3
tests/paywall/02-admin-config.spec.ts       P0-2, P0-3, P1-6, P1-8, P1-9
tests/paywall/03-purchase.spec.ts           P0-4, P0-5, P1-7
tests/paywall/04-payment-failures.spec.ts   P1-1, P1-2
tests/paywall/05-entitlement-scope.spec.ts  P1-4, P1-5
```

## 8. Implementation status (2026-10-22)

Latest `npm run test:paywall` (after adding receipt assertions): **5 pass, 2 fail on a product finding.**

| ID | Spec | Status |
|----|------|--------|
| P0-1 | `viewer-gate.spec.ts` | ✅ |
| P0-2, P0-3 | `admin-paywall-config.spec.ts` | ✅ (one intermittent Save hang, now instrumented, see below) |
| P0-4 | `viewer-purchase.spec.ts` | ❌ **receipt ≠ checkout quote** (BUG-1). Playback, reload and re-login all passed before the receipt check was added |
| P0-5 | `viewer-purchase.spec.ts` | ✅ (when run before the receipt check; now blocked behind BUG-1 in the same journey) |
| P1-1 | `payment-failures.spec.ts` | ❌ decline handling ✅, **retry receipt ≠ quote** (BUG-1) |
| P1-2 | `payment-failures.spec.ts` | ✅ |
| P1-3 | `viewer-gate.spec.ts` | ✅ (one intermittent 401 with an unexpected body, now instrumented) |
| P1-5 | `admin-paywall-config.spec.ts` | ✅ |
| P1-4, P1-6, P1-7, P1-8, P1-9, all P2 | — | not started (next in build order) |

### Findings for the interviewer

- **BUG-1 (R3, wrong money): the receipt does not match the checkout.**
  - Three purchases at three different configured prices all produced the same receipt: **€7.53 + €1.36 service = €8.89**. The checkouts quoted €8.22/€9.70, €8.97 total, and €6.82/€8.05.
  - The payment-intent request carries only the SKU (`vod-purchase-<videoId>`), no amount, so the server computes the charge. It appears to use a stale product price.
  - Next step: check the Stripe dashboard to see whether the **charge** or only the **receipt** is wrong. Example PaymentIntent from the probe: `pi_3UTRMFKlS19qVW5l1AcYaJO8`.
- **Intermittent: admin Save didn't complete once.** The click registered, but the gate PATCH never arrived within 45s, and it didn't reproduce. `PaywallEditor.save()` now lists each API write and its state on timeout.
- **Intermittent: caniplay returned 401 without `access` once** for a logged-in non-buyer, and it didn't reproduce. Every access assertion now prints status + body.
- **Dev environment:** the `load` event occasionally never fires (setup reload hung 60s). Setup now does one full load instead of two.

**What the product taught us (plan adjusted):**

- **Product name = video title.** The one-time and rental products are per-video and named after the video. Product names can't prove this run's config reached the viewer, so **a run-unique price** does that job.
- **Price is shown only after login.** Anonymous "Get Access" opens the auth modal; the checkout (offers, price, totals) appears after register/login. This answers open question #2.
- **Save persists on its own.** No Publish is needed: Save upserts `subscription/v2` products and PATCHes the page `gate`.
- **Duplicate testid trap.** Both price inputs are `priceInput-0`. `PaywallEditor` scopes each one to its section, and P0-2 asserts the rental price is untouched.
- **The entitled state is a CTA change, not a missing overlay.** After a reload or fresh login, the paywall landing still renders, but the CTA flips from "Get Access" to **"Watch Now"**. Clicking it plays.
- **A decline is a page-level "Oh Snap!" dialog.** Clicking Ok returns the viewer to the same checkout with billing kept, and the retry happens there.
- **The receipt is the only view of what was charged.** Specs compare every receipt line to the checkout quote. That's how BUG-1 surfaced: the first green run never looked at the receipt.
- **caniplay needs two headers.** Without `Origin` and `x-maestro-client-id`, it returns 400 before evaluating entitlement.
- **The checkout totals are a money oracle.** Subtotal + Service Charge + Sales Tax = Total Due is asserted wherever a checkout opens.
- **Framework fix.** `tests/setup/auth.setup.ts` now clears the admin session before the viewer login (both shared one context, so viewer setup always failed). Without this fix, setup failure skipped every `chromium-admin` spec.

## 9. Open questions for the interviewer

1. **Concurrency:** is anyone else (other candidates, other suites) editing this video page right now? This decides whether a serial run is enough or we need a lock or our own page.
2. ~~**No price on the anonymous paywall**~~: answered by exploration. The price appears in the checkout after login. Still worth confirming that this is the intended UX, since anonymous viewers can't compare prices before signing up.
3. **Registration:** is email verification required? Which email domains are accepted?
4. **Checkout shape:** embedded Elements, a Stripe-hosted redirect, or through the cart? Is the dev Stripe account in test mode for every product type?
5. **Unlock timing:** should playback unlock immediately after payment (client-side), or after a webhook? What latency is acceptable?
6. **Cleanup:** can products be archived or deleted? Should the page be restored to a specific baseline paywall after runs?
7. **API:** are there admin endpoints for products/paywall config we're allowed to use for setup?

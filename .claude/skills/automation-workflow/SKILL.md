---
name: automation-workflow
description: Turn Playwright codegen recordings into production e2e tests on this Patchright framework — clean the recording, probe the live site to fill gaps, build page objects (no selectors in specs), write step-by-step specs with assertions in every step and both UI + server oracles, then run, triage, and verify. Use when the user hands over codegen output (*.flow.md, recorded .ts) or asks to automate a recorded flow / test case from the test plan.
argument-hint: <codegen file(s)> [test-plan case IDs, e.g. P0-4 P1-1]
---

# Codegen → automation workflow

Arguments: `$ARGUMENTS` — codegen file path(s), optionally the test-plan case IDs to automate.

Codegen tells you **what a human clicked**. It does not tell you what must be
true, which selectors survive, what the server decided, or what happens after
the recording stopped. This workflow closes those gaps. Follow the phases in
order; each one has an exit check.

House rules (non-negotiable for this repo):

1. **No web elements in spec files.** Every `getByTestId/getByRole/getByText/locator/frameLocator/contentFrame`, every DOM `evaluate`, lives in `src/pages/*`. Specs talk to page objects only.
2. **Every `test.step` has at least one `expect`.** A step without an assertion is a step that can silently do nothing.
3. **Two oracles where money or access is involved:** what the user sees (page object) *and* what the server decided (API response).
4. **Never weaken an assertion to get green.** If the product behaves differently than assumed, find out *why*, assert the real contract, and document it.

---

## Phase 1 — Intake (read before writing anything)

1. Read the codegen files. **Check they are non-empty on disk** (`wc -c`) — a file open in the IDE can be unsaved; if it's 0 bytes, ask the user to save (Ctrl+S) and do framework reading meanwhile.
2. Read the plan: [tests/paywall/TEST_PLAN.md](../../../tests/paywall/TEST_PLAN.md) (case IDs, priorities, risks) and `CLAUDE.md`.
3. Read the framework pieces you will plug into — don't re-invent them:
   - `src/fixtures/index.ts`, `base.ts`, `auth.ts`, `incognito.ts` → `adminPage`, `openAnonymousPage()`, `openViewerPage()`
   - existing page objects in `src/pages/` (extend `AuthModal`, don't duplicate it)
   - `src/test-data/environments.ts` (the target URL/IDs live on the profile — never literal in specs)
   - `src/api/auth.ts` (`resolveApiHost`, `resolveOriginHeader`, request-context conventions)
4. Make sure `.auth/admin.json` exists (`npx patchright test --project=setup` with `HEADED=0`). If setup fails, fix that first — every `chromium-admin` spec depends on it.

**Exit check:** you can say which fixtures, page objects and test-data entries the new tests will use.

## Phase 2 — Clean the recording (signal vs noise)

Go line by line and sort each action:

| Recording shows | Treat as | Do |
|---|---|---|
| repeated `.click()` / `.fill()` on the same field, `press('CapsLock')`, `press('ArrowRight')`, partial fills | human noise | collapse to one `fill(finalValue)` |
| `getByTestId('…')` | **signal** — best selector | keep, move to a page object |
| `getByRole(role, { name })` | good selector | keep, scope to the component root |
| `locator('div').filter({ hasText: 'Create AccountYou will' }).nth(5)`, `label.nth(4)` | brittle (concatenated text, positional) | replace — find the testid/role of the real target (e.g. terms checkbox → `authModalRegisterViewTermsAndPolicyCheckbox` + its parent label) |
| `iframe[name="__privateStripeFrame4065"]` | dynamic name | prefix match `iframe[name^="__privateStripeFrame"]` |
| clicks on tabs/sections the flow doesn't need | exploration noise | drop |
| hard-coded URLs, emails, prices | test data | URL → profile helper; emails/prices → run-unique generators |

Then list **what the recording never did** — that's your probe list. Typical gaps: the save/submit at the end, what appears after submit (receipt, error, redirect), the state after reload, negative paths.

**Exit check:** a short list of kept selectors and a list of unknowns to probe.

## Phase 3 — Probe the live site to fill the gaps

Use [probe-lib.cjs](probe-lib.cjs) from a throwaway script in the **scratchpad** (never in the repo). It launches real Chrome via Patchright, hydrates an auth state, seeds cookie consent, and gives you `dump()` (visible testids + text + screenshot), `controls()` (inputs/buttons/roles with testids and states) and `captureMutations()` (non-GET API calls with request/response bodies).

```js
// <scratchpad>/probe-x.cjs
const P = require('C:/Users/ramaz/code/sqa-ramazanozersdet-20261022/.claude/skills/automation-workflow/probe-lib.cjs');
(async () => {
  const { ctx, page } = await P.launch('C:/Users/ramaz/code/sqa-ramazanozersdet-20261022/.auth/admin.json'); // omit for anonymous
  const muts = P.captureMutations(page);
  await page.goto(P.TARGET_URL);
  await P.dump(page, 'step1', process.argv[2]);           // screenshot lands in the scratchpad dir passed as argv[2]
  console.log((await P.controls(page)).join('\n'));
  await ctx.close();
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
```

Run it (Windows — node is not on the Bash PATH; use PowerShell):

```powershell
$env:NODE_PATH = "$PWD\node_modules"; & "C:\Program Files\nodejs\node.exe" "<scratchpad>\probe-x.cjs" "<scratchpad>"
```

Probing rules:

- **Read-only first.** Open editors, toggle checkboxes, open pickers — then close without saving. Only perform a mutation (Save) when the tests themselves will do the same mutation, and capture its network calls while you do.
- **Dump DOM structure for components without testids** (clone the root, strip classes/styles/svg) — that's how you design structural locators (e.g. offer row = radio + sibling price span).
- **Look for duplicate testids** across sections (`priceInput-0` appeared under both one-time and rental). Note them as traps.
- **Watch the network** for the server-side oracle: which endpoint decides access/success, its status and body shape, and which headers it requires (curl it with and without headers).
- **Stop before irreversible real-world effects** in probes (e.g. stop at the checkout, don't pay) — let the real test do the payment once you've built it.
- Save findings as you go; they become page-object header comments and TEST_PLAN notes.

**Exit check:** every unknown from Phase 2 has a concrete selector or observed behavior.

## Phase 4 — Page objects (`src/pages/`)

One class per UI surface (page, panel, modal, third-party iframe), composed where natural (`VideoPage` owns `Paywall`, `CheckoutPanel`, `AuthModal`).

Conventions (match the existing files):

- **Header comment**: what the surface is, how you reach it, when/how selectors were verified (date + "codegen" / "probe"), structural notes, and **traps** (duplicate testids, lazy-mounted iframes, dialogs that replace panels).
- `readonly` locators assigned in the constructor; scope everything to a component `root`.
- Selector priority: `getByTestId` → `getByRole({ name })` scoped to root → structural XPath anchored on a stable element (`following-sibling::div[1]/span[last()]`) → prefix attribute match for dynamic names.
- Parameterized locators as methods (`offer('Buy')`, `summaryValue('Total Due')`, `optionCheckbox('rental')`).
- **Action methods** (`fillBilling`, `save`, `registerFromOpenModal`) — they may wait for the UI to settle, but **business assertions stay in specs**. Exception: an internal guard that makes the action meaningful (e.g. terms checkbox `toBeChecked` before submit).
- Methods that return **evidence** for specs to assert on: `save()` returns the gate PATCH status + product payloads; `goto()/reload()` return the server access decision; `secondsPlayed()` returns real media progress.
- Anything "DOM-hacky" (removing an overlay, fixed observation windows) is a named page-object method, never inline in a spec.
- **Setup shortcuts** (`configureOneTimePurchase(price)`) for specs where that flow is a precondition; the spec whose *subject* is that flow drives the steps one by one with assertions.

Supporting code: run-unique data and constants → `src/utils/` (`paywallData.ts`); server oracles / API calls → `src/api/` (`caniplay.ts`); target URL → profile + one URL helper (`src/utils/videoPage.ts`).

## Phase 5 — Specs (`tests/<area>/*.spec.ts`)

Skeleton:

```ts
// tests/paywall/<name>.spec.ts
//
// <Case IDs> — what is protected and WHY (money lost / paying user locked out).
// Notes on design choices (one journey = one purchase, why price is the unique marker, …).

import { test, expect } from '../../src/fixtures';
// page objects, api oracles, utils — never patchright selectors

test.describe.configure({ mode: 'serial' });
test.beforeAll(({}, testInfo) => requireSingleWorker(testInfo)); // shared live state

test('<ID> <behavior in plain words>', async ({ adminPage, openAnonymousPage }) => {
  test.setTimeout(240_000); // only when the journey genuinely needs it — say why

  await test.step('precondition: <state this test establishes itself>', async () => {
    const saved = await new PaywallEditor(adminPage).configureOneTimePurchase(price);
    expect(saved.gateSaveStatus).toBeLessThan(300);
  });

  await test.step('<user-visible step>', async () => {
    // act via page object, then assert UI + server
  });
});
```

Assertion checklist per step — pick what applies, at least one always:

- **Visibility/state** of the thing the user needs next (`toBeVisible`, `toBeEnabled`/`toBeDisabled`, `toHaveAttribute('aria-checked','true')`, `toHaveValue`).
- **Absence** of the thing that must not happen (`toBeHidden`, `toHaveCount(0)`, old price `not.toContainText`).
- **Server decision** (status + body field), captured from the page's own request.
- **Money**: displayed price == configured price; subtotal == price; total == subtotal + fees + tax (`toBeCloseTo(…, 2)`). **Then compare the receipt to the quote, line by line**: the receipt is the only user-visible record of what was *charged*. Checking the checkout alone missed a real bug (receipt €8.89 for a €8.05 quote) on the first "green" run.
- **Real outcome**, not a proxy: media actually advanced (`expect.poll(secondsPlayed) > 0`), not "a `<video>` exists".
- **Negative assertions need a positive control**: a "no stream leaked" check is only meaningful if another test proves the same monitor *does* see the stream when entitled.
- **Persistence**: reload / fresh browser / re-login, then re-assert both oracles.

Data and isolation:

- Fresh user per irreversible action (purchases are permanent) — `newViewerCredentials()`.
- Run-unique values the assertion can key on (random price ≠ current price) so stale state can't make a test pass.
- Each spec establishes its own preconditions on shared state; never rely on file order.
- No retries on mutation specs; no `waitForTimeout` in specs.
- **Don't use `describe.configure({ mode: 'serial' })` for independent tests.** One failure skips the rest of the file and hides coverage. Serialization against shared state comes from `--workers=1` + `requireSingleWorker`.
- **Every server-oracle assertion carries its evidence** in the message (`expect(d.access, describeDecision(d))`). An intermittent failure without the response body can't be classified.

## Phase 6 — Run, triage, adapt

```powershell
$env:PATH = "C:\Program Files\nodejs;$env:PATH"; $env:HEADED='0'; $env:SLOWMO='0'
npx tsc --noEmit
npx patchright test tests/paywall/<file>.spec.ts --project=chromium-admin --workers=1 --reporter=list
```

Build order: run the **highest-value spec first, alone**, then the rest, then the whole suite.

On every failure, **look before you change anything**: open the screenshot (`reports/test-artifacts/<test>/test-failed-*.png`) and `error-context.md` (page snapshot). Then classify:

| Classification | Example from this suite | Action |
|---|---|---|
| **Test bug** — wrong locator/assumption about mechanics | preview not re-rendered after save; caniplay probe missing `x-maestro-client-id` → 400 | fix page object / helper; the assertion intent stays |
| **Product behaves differently than assumed (by design)** | entitled viewer still sees the paywall landing, CTA flips "Get Access" → "Watch Now"; decline shows a page-level "Oh Snap!" dialog | assert the *real* contract (still strict), document it in the PO header + TEST_PLAN findings |
| **Framework bug** | setup logged viewer in on the admin's live session → setup failed → all admin specs skipped | minimal fix with a comment explaining why |
| **Product bug** | server grants while UI locks the buyer out; price shown ≠ charged | keep the test red, report it with evidence (screenshot, response body) — do not adapt the test |

Never: add retries, loosen to `toBeTruthy`, wrap in try/catch, or delete the step that fails.

**One green run is not "passing".** Re-run the full suite before claiming it (a live dev site drifts). When a failure can't be reproduced, don't guess: instrument the code path so the next occurrence explains itself (e.g. `PaywallEditor.save()` lists every API write and its state on timeout), and report it as intermittent. Check your own theories against evidence before reporting them. ("Another user is editing the page" and "the decline overlay blocks retry" both turned out wrong once checked.)

Reports: passing `--reporter=list` on the CLI **replaces** the configured HTML/JSON/JUnit reporters, so `reports/` keeps stale results. Run without `--reporter` when you need the artifacts.

## Phase 7 — Verify and hand over

Run these and report the numbers:

```bash
# 1. no selectors leaked into specs (expect: NONE)
grep -nE "getBy(TestId|Role|Text|Label|Placeholder)|\.locator\(|frameLocator|contentFrame|data-testid|waitForTimeout" tests/paywall/*.spec.ts || echo NONE
# 2. assertions vs steps per spec
for f in tests/paywall/*.spec.ts; do echo "$(grep -cE 'expect(\.poll)?\(' $f) expects, $(grep -c 'test.step(' $f) steps  $f"; done
```

```powershell
npx tsc --noEmit
npm run test:paywall -- --reporter=list   # full suite, serial
npm run test:smoke   -- --reporter=list   # regression check for shared page objects / setup
```

Then:

1. Update [TEST_PLAN.md](../../../tests/paywall/TEST_PLAN.md): implementation-status table (case → spec → ✅/not started) and "what the product taught us" (every assumption the live site corrected).
2. Delete or archive the placeholder spec / raw codegen files only with the user's OK.
3. Report to the user: pass counts, what each spec proves, the surprises and how the tests adapted, any repo changes outside the new files, shared-state side effects (prices left on the live page, test accounts created), and what's next in build order. Don't commit unless asked.

---

## Repo-specific gotchas (learned the hard way)

- **Windows:** node isn't on the Git-Bash PATH → run node/npx from PowerShell with `C:\Program Files\nodejs` prepended. Python isn't installed — use the Edit tool for file surgery. `npm run test:fast` uses POSIX env syntax; set `$env:HEADED='0'; $env:SLOWMO='0'` instead.
- **Setup shares one context across roles** — each login must start from a cleared session (already fixed in `tests/setup/auth.setup.ts`).
- **Second contexts (`openAnonymousPage`) re-render the cookie banner** after navigation; it covers bottom-of-page links. `VideoPage.goto()/reload()` dismiss it.
- **Video paywall facts:** Save in Video Settings persists without Publish (Save is disabled until the form is dirty); product name = video title; price visible only after login (checkout panel); `priceInput-0` duplicated (scope it); Stripe card iframe mounts only after billing is filled; caniplay needs `Origin` + `x-maestro-client-id: <siteId>`; non-entitled → `401 {"access":"no_entitlement"}`, entitled → `200 {"contentCheck":{"access":"full"}}`; entitled landing shows "Watch Now" instead of "Get Access"; decline → "Oh Snap!" dialog, Ok returns to the same checkout with billing kept.
- **Dev `load` can hang.** Minimize full page loads in setup/fixtures (`waitUntil: 'commit'` when you only need the origin).
- **Shared live page:** all paywall specs mutate one gate → `--workers=1` (guarded by `requireSingleWorker`).

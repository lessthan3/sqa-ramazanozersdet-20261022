// probe-lib.cjs — exploration helpers for the codegen → automation workflow.
//
// NOT part of the test suite. Require it from a throwaway script in the
// scratchpad to discover selectors, DOM structure and network behavior that a
// codegen recording didn't capture. Run with NODE_PATH pointing at the repo's
// node_modules so `patchright` resolves:
//
//   $env:NODE_PATH = "$PWD\node_modules"; & "C:\Program Files\nodejs\node.exe" <script> <outDir>
//
// Same launch shape as src/fixtures/base.ts: real Chrome via
// launchPersistentContext + channel 'chrome' (bundled Chromium is detected and
// redirected to the marketing site), consent pre-seeded so the cookie banner
// never covers controls.

const { chromium } = require('patchright');
const os = require('os');
const path = require('path');
const fs = require('fs');

const BASE_URL = process.env.BASE_URL || 'https://dev.web.maestro.io/barbara-paxico';
const SITE_ID = process.env.SITE_ID || '6018a870f23c26002e185161';
const TARGET_URL = process.env.TARGET_URL || `${BASE_URL}/v/6a036b749a999d97198446a9`;

/**
 * Launch headless real Chrome. Pass a storageState path (e.g. .auth/admin.json)
 * to start authenticated; omit for an anonymous viewer.
 */
async function launch(authFile, { headless = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  const ctx = await chromium.launchPersistentContext(dir, {
    channel: 'chrome',
    headless,
    viewport: { width: 1440, height: 900 },
  });
  await ctx.addInitScript(
    ([key]) => {
      try { localStorage.setItem(key, '-1'); } catch {}
    },
    [`maestro__${SITE_ID}__AcceptedTermsVersion`],
  );
  if (authFile) {
    // launchPersistentContext ignores storageState — hydrate by hand.
    const state = JSON.parse(fs.readFileSync(authFile, 'utf8'));
    await ctx.addCookies(state.cookies || []);
    const p = await ctx.newPage();
    for (const origin of state.origins || []) {
      const url = new URL(BASE_URL).origin === origin.origin ? BASE_URL : origin.origin;
      await p.goto(url);
      await p.evaluate((entries) => entries.forEach((e) => localStorage.setItem(e.name, e.value)), origin.localStorage);
    }
    await p.close();
  }
  const page = await ctx.newPage();
  return { ctx, page };
}

/** Print URL, tail of visible text and visible testids; save a screenshot to outDir/<label>.png. */
async function dump(page, label, outDir = process.cwd()) {
  const text = (await page.locator('body').innerText()).replace(/\n+/g, ' | ');
  const tids = await page.$$eval('[data-testid]', (els) => [
    ...new Set(els.filter((e) => e.offsetParent !== null).map((e) => e.getAttribute('data-testid'))),
  ]);
  console.log(`\n##### ${label}\nURL: ${page.url()}\nTEXT: ${text.slice(-3000)}\nVISIBLE TESTIDS: ${tids.join(', ')}`);
  await page.screenshot({ path: path.join(outDir, `${label}.png`) });
}

/** Visible interactive controls with role, nearest testid, name/aria and state — locator raw material. */
async function controls(page, scope = 'body') {
  return page.locator(scope).locator('input, select, textarea, button, [role], iframe').evaluateAll((els) =>
    els
      .filter((e) => e.offsetParent !== null || e.tagName === 'IFRAME')
      .map((e) => {
        const tid = e.getAttribute('data-testid') || e.closest('[data-testid]')?.getAttribute('data-testid');
        const state = e.getAttribute('aria-checked') ?? e.getAttribute('aria-selected') ?? (e.disabled ? 'disabled' : '');
        const label = (e.innerText || e.value || e.placeholder || '').slice(0, 50).replace(/\n/g, ' / ');
        return `${e.tagName}${e.type ? `[${e.type}]` : ''} role=${e.getAttribute('role')} tid=${tid} name=${e.getAttribute('name')} aria=${e.getAttribute('aria-label')} title=${e.getAttribute('title')} state=${state} text=${label}`;
      }),
  );
}

/**
 * Structural HTML of the element containing `anchor` (a locator), with
 * classes/styles/svg bodies stripped — for designing locators on components
 * that have no testids.
 */
async function structure(anchor, containsText) {
  return anchor.evaluate((el, needle) => {
    let n = el;
    while (n && needle && !(n.innerText || '').includes(needle)) n = n.parentElement;
    const clone = (n || el).cloneNode(true);
    clone.querySelectorAll('*').forEach((e) => {
      e.removeAttribute('class');
      e.removeAttribute('style');
      if (e.tagName === 'svg' || e.tagName === 'path') e.innerHTML = '';
    });
    return clone.outerHTML.replace(/></g, '>\n<');
  }, containsText);
}

/** Record non-GET API calls (status, method, url, request + response bodies). Read `.log` later. */
function captureMutations(page, apiPattern = /api\.maestro\.io/) {
  const log = [];
  page.on('response', async (r) => {
    const req = r.request();
    if (!apiPattern.test(r.url()) || req.method() === 'GET' || /active\/v2/.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 800); } catch {}
    log.push(`${r.status()} ${req.method()} ${r.url().slice(0, 160)}\n  REQ: ${(req.postData() || '').slice(0, 800)}\n  RES: ${body}`);
  });
  return { log, print: () => console.log('MUTATIONS:\n' + log.join('\n')) };
}

/** Record responses whose URL matches `pattern`, with status and body — find the server-side oracle. */
function captureResponses(page, pattern) {
  const log = [];
  page.on('response', async (r) => {
    if (!pattern.test(r.url())) return;
    let body = '';
    try { body = (await r.text()).slice(0, 800); } catch {}
    log.push(`${r.status()} ${r.request().method()} ${r.url().slice(0, 180)}\n  ${body}`);
  });
  return { log, print: () => console.log('RESPONSES:\n' + log.join('\n')) };
}

module.exports = { BASE_URL, SITE_ID, TARGET_URL, launch, dump, controls, structure, captureMutations, captureResponses };

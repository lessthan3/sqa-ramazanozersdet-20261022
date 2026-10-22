// playwright.config.ts
//
// Senior QA challenge template — mirrors the maestro-web e2e architecture.
//
// 4-project layout. Storage-state is loaded AT LAUNCH per role-bound
// project — no per-test injection, no cross-test state churn. The `setup`
// project runs once at the start of every `yarn test` invocation, performs
// API logins for each role, dumps `.auth/<role>.json`, and the role-bound
// projects depend on it.
//
//   Projects:
//     1. setup                — API login + storageState dump
//     2. chromium-anonymous   — no storageState; specs that need a fresh
//                               anonymous session
//     3. chromium-admin       — loads .auth/admin.json at launch. Your
//                               paywall/entitlement specs run here: they are
//                               admin-driven mutations, and the viewer-side
//                               legs spawn a second context via the
//                               incognito factory INSIDE the test
//                               (openAnonymousPage / openViewerPage).
//     4. chromium-viewer      — loads .auth/viewer.json at launch
//
// Reliability stance: mutation specs (tests/paywall/) run with strict
// no-retry — a retry on a mutation spec masks data-race or contention bugs.
// Smoke specs opt into retries:1 per-file via
// `test.describe.configure({ retries: 1 })` (environmental-blip absorption).

import { defineConfig, devices } from 'patchright/test';
import 'dotenv/config';

const isCI = !!process.env.CI;
const headed = process.env.HEADED === '1' || process.env.HEADED === 'true';

export default defineConfig({
  testDir: './tests',
  testIgnore: [
    '**/node_modules/**',
    '**/_archive/**',
    // _probe-*.spec.ts files are exploratory specs (selector discovery,
    // environment audits) — never part of a normal run. Opt in with
    // RUN_PROBES=1 and an explicit file path.
    ...(process.env.RUN_PROBES === '1' ? [] : ['**/_probe-*.spec.ts']),
  ],
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  // PW_WORKERS overrides the count. Local default is 1: runs are headed +
  // slowMo by design (see src/utils/env.ts), and parallel headed windows
  // are unwatchable. `npm run test:fast` restores headless parallelism.
  workers: process.env.PW_WORKERS ? process.env.PW_WORKERS : isCI ? 4 : 1,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { outputFolder: 'reports/html', open: 'never' }],
    ['junit', { outputFile: 'reports/junit/results.xml' }],
    ['json', { outputFile: 'reports/json/results.json' }],
  ],
  outputDir: 'reports/test-artifacts',

  use: {
    baseURL: process.env.BASE_URL,
    headless: !headed,
    trace: isCI ? 'retain-on-failure' : 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    // The first `page.goto(env.BASE_URL)` per test does a full cold load
    // (Stripe iframes, analytics scripts, fonts) — give it a real budget
    // while still bounding hung navigations as failures.
    navigationTimeout: 60_000,
  },

  projects: [
    {
      // 1. Setup — API login per role, dump storageState. Runs first; the
      // role-bound projects depend on it.
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      // 2. Anonymous — for specs that explicitly need an unauthenticated
      // starting point. Does NOT depend on setup; the lack of storageState
      // is intentional.
      name: 'chromium-anonymous',
      testMatch: [/tests\/smoke\/anonymous\.spec\.ts/],
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      // 3. Admin — pre-authenticated as admin via .auth/admin.json.
      //
      // The paywall surface lives here: entitlement setup is an
      // admin-driven mutation, so it belongs on this project. Specs that
      // need a viewer or anonymous PERSPECTIVE spawn a second context via
      // the incognito factory inside the test (openAnonymousPage /
      // openViewerPage from src/fixtures) — they do not move to another
      // project.
      name: 'chromium-admin',
      testMatch: [
        /tests\/paywall\/.*\.spec\.ts/,
        /tests\/smoke\/admin\.spec\.ts/,
      ],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: '.auth/admin.json',
      },
      dependencies: ['setup'],
    },
    {
      // 4. Viewer — pre-authenticated as viewer via .auth/viewer.json.
      name: 'chromium-viewer',
      testMatch: [/tests\/smoke\/viewer\.spec\.ts/],
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        storageState: '.auth/viewer.json',
      },
      dependencies: ['setup'],
    },
  ],
});

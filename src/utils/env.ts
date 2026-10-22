// src/utils/env.ts
//
// Typed env access. Required keys throw at first access (fail loudly).
// Optional keys soft-warn once on first miss.
//
// Loading order: `./loadEnvFiles` runs dotenv at import time, so every
// import path through src/* picks up `.env` without each consumer having
// to import dotenv. playwright.config.ts also imports dotenv/config
// explicitly — dotenv is idempotent so double-loading is harmless.
//
// Other env vars read directly via `process.env` (runner knobs consumed
// before/outside this module): CI, DEBUG, HEADED, PW_WORKERS, SLOWMO,
// TEST_ENV, RUN_PROBES, API_HOST / API_SITE_URL (src/api/auth.ts override),
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.

import './loadEnvFiles';
import { testData } from '../test-data';

const REQUIRED_KEYS = ['ADMIN_USER', 'DEFAULT_PASS'] as const;
const OPTIONAL_KEYS = ['VIEWER_USER', 'VIEWER_PASS'] as const;

type RequiredKey = typeof REQUIRED_KEYS[number];
type OptionalKey = typeof OPTIONAL_KEYS[number];

const softWarned = new Set<string>();

function readRequired(key: RequiredKey): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error(
      `[env] Missing required env var '${key}'. ` +
        `Create a .env file at the repo root with ${key}=<value>. ` +
        `Access (accounts, passwords, and anything else you need) is ` +
        `provided by your interviewer on request — asking for it is part ` +
        `of the exercise.`,
    );
  }
  return v;
}

function readOptional(key: OptionalKey): string | undefined {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    if (!softWarned.has(key)) {
      softWarned.add(key);
      // eslint-disable-next-line no-console
      console.warn(
        `[env] Optional env var '${key}' is not set. ` +
          `Features depending on it will soft-skip or no-op.`,
      );
    }
    return undefined;
  }
  return v;
}

/** BASE_URL override wins; otherwise the committed profile's site. */
function readBaseUrl(): string {
  const v = process.env.BASE_URL;
  if (v && v.trim() !== '') return v;
  return testData.baseUrl;
}

export const env = {
  get BASE_URL(): string {
    return readBaseUrl();
  },
  get ADMIN_USER(): string {
    // Profile fallback only when the profile actually commits an email —
    // this template intentionally does NOT (candidates request access), so
    // an unset ADMIN_USER throws the readRequired guidance.
    const fromEnv = process.env.ADMIN_USER?.trim();
    if (fromEnv) return fromEnv;
    if (testData.accounts.admin.email) return testData.accounts.admin.email;
    return readRequired('ADMIN_USER');
  },
  get DEFAULT_PASS(): string {
    return readRequired('DEFAULT_PASS');
  },
  get VIEWER_USER(): string {
    return process.env.VIEWER_USER?.trim() || testData.accounts.viewer.email;
  },
  get VIEWER_PASS(): string | undefined {
    return readOptional('VIEWER_PASS') ?? process.env.DEFAULT_PASS;
  },
  /**
   * Headed by DEFAULT in this template — runs are meant to be watched.
   * Set HEADED=0 (or false) to go headless; CI is headless automatically.
   */
  get HEADED(): boolean {
    const v = process.env.HEADED?.trim();
    if (v === '0' || v === 'false') return false;
    if (v === '1' || v === 'true') return true;
    return !process.env.CI;
  },
  /**
   * Milliseconds of pause between every driver action, so watched runs move
   * at human speed. DEFAULT 500 locally (0 in CI); SLOWMO=0 for full speed.
   */
  get SLOWMO(): number {
    const v = process.env.SLOWMO?.trim();
    if (v !== undefined && v !== '') {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    }
    return process.env.CI ? 0 : 500;
  },
};

export type Env = typeof env;

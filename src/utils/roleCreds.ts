// src/utils/roleCreds.ts
//
// Role identity + credential resolution — RUNNER-NEUTRAL by construction
// (env reads only, no patchright/@playwright imports).
//
// Extracted from src/fixtures/auth.ts 2026-08-26: `src/api/auth.ts` needs
// credsForRole, but importing it from the fixtures pulls patchright/test
// transitively, which aborts the VANILLA-runner lanes (tests/webkit-smoke,
// tests/firefox-smoke) with "Requiring @playwright/test second time". The
// interim fix was a lazy `await import('../fixtures/auth')`, which then
// tripped TS2835 (node16 module resolution requires an explicit extension
// on relative dynamic imports). Living in a neutral module solves both:
// api/auth imports it statically, the fixtures re-export it, and no lane
// loads a runner it does not own.

import { env } from './env';

export type Role = 'admin' | 'viewer';

export interface RoleCreds {
  user: string;
  pass: string;
}

/**
 * Credentials for a role, from `.env`. Throws loudly when a role's keys are
 * missing — a silent fallback would authenticate as the wrong account and
 * produce confusing downstream failures.
 */
export function credsForRole(role: Role): RoleCreds {
  switch (role) {
    case 'admin':
      // Admin password is DEFAULT_PASS (there is no ADMIN_PASS env key).
      return {
        user: env.ADMIN_USER.trim(),
        pass: env.DEFAULT_PASS.trim(),
      };
    case 'viewer': {
      const user = env.VIEWER_USER?.trim();
      const pass = env.VIEWER_PASS?.trim();
      if (!user || !pass) {
        throw new Error(
          '[utils/roleCreds] viewer role requested but VIEWER_USER / ' +
            'VIEWER_PASS not set in .env (VIEWER_PASS defaults to DEFAULT_PASS).',
        );
      }
      return { user, pass };
    }
    default:
      throw new Error(`[utils/roleCreds] unknown role: ${String(role)}`);
  }
}

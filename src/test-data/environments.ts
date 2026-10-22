// src/test-data/environments.ts
//
// Non-secret, per-environment test data. Committed on purpose: a site's
// slug, id, account emails, and the page under test are identifiers, not
// secrets, and they change with the environment rather than with the deploy.
//
// Secrets never live here. Passwords come from env — DEFAULT_PASS.
//
// A new environment is a new profile object — not a new env var.

/**
 * One role's login identity. Email is committed; the password is not.
 *
 * No per-role password field. Every role shares DEFAULT_PASS. Password
 * varies by environment, not by role — put it on the profile if a second
 * environment ever needs its own.
 */
export interface RoleAccount {
  email: string;
}

/** One environment's committed test data. */
export interface TestEnvironment {
  /** Site URL including the channel path segment. */
  baseUrl: string;
  /** Mongo site id used by the API clients. */
  siteId: string;
  /** Trailing path segment of baseUrl. */
  siteSlug: string;
  /**
   * API origin, no trailing slash. Omit to derive it from baseUrl via
   * resolveApiHost(). Set it only when a host breaks that mapping.
   */
  apiHost?: string;
  accounts: {
    admin: RoleAccount;
    viewer: RoleAccount;
  };
}

/**
 * barbara-paxico on the dev CDN — the challenge target site.
 *
 * siteId discovered from the served page HTML (the same
 * `siteId":"<24 hex>"` pattern the production suite's
 * discoverSiteIdFromHtml uses), 2026-08-31.
 *
 * Account identities are intentionally NOT committed. Access — the admin
 * login, its password, and any other role you need — is provided by your
 * interviewer ON REQUEST: asking for the access you need is part of the
 * exercise. Put what you're given in .env (ADMIN_USER / DEFAULT_PASS /
 * VIEWER_USER / VIEWER_PASS); the env layer throws loudly if a required
 * value is missing.
 *
 * An empty viewer email ⇒ the viewer setup step and the viewer smoke
 * soft-skip (see tests/setup/auth.setup.ts and tests/smoke/viewer.spec.ts).
 */
const barbaraPaxicoAccounts: TestEnvironment['accounts'] = {
  admin: { email: '' },
  viewer: { email: '' },
};

export const environments = {
  /** Default (and only) profile: barbara-paxico on the dev CDN. */
  dev: {
    baseUrl: 'https://dev.web.maestro.io/barbara-paxico',
    siteId: '6018a870f23c26002e185161',
    siteSlug: 'barbara-paxico',
    accounts: barbaraPaxicoAccounts,
  },
} satisfies Record<string, TestEnvironment>;

export type EnvironmentName = keyof typeof environments;

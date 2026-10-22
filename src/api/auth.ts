// src/api/auth.ts
//
// Phase 5B (2026-05-22). API-based login that bypasses the browser auth-modal
// entirely. Architectural sibling of `src/api/channels.ts` — Node-side HTTP
// via Playwright `request.newContext()`, no browser, no CORS preflight, no
// dependence on the auth-modal UI being deterministic.
//
// Why this exists. Phase 5A.2 prototyped six in-browser CORS-bypass variants
// against the email-lookup step. All six failed identically. The root cause
// wasn't a missing CORS header — staging API
// `https://api.us-central1-staging.gcp.maestro.io/` was returning nginx 503
// with no upstream attached, and nginx's default 503 page carries NO
// Access-Control-Allow-* headers. Chromium presents that as a CORS preflight
// failure even though the real problem is upstream-down. Lifting auth into a
// Node HTTP client sidesteps the entire CORS layer (it's a browser-only
// security boundary) and is the canonical Playwright pattern for API-side
// session bootstrap.
//
// ──────────────────────────────────────────────────────────────────────────
// Phase 5B.1 status — COMPLETE (2026-05-25)
// ──────────────────────────────────────────────────────────────────────────
//
// What was discovered (Phase 5B.1 probe, 2026-05-25):
//
//   Login endpoint — the canonical one, accepts a direct POST.
//     POST https://{API_HOST}/auth/v2/login
//     Headers: content-type: application/json;charset=UTF-8
//              origin:       https://pearl.maestro.io
//              referer:      https://pearl.maestro.io/
//     Body:    { email, password, siteId }
//     Returns 200 + { jwt, refreshToken, service }
//
//     Verified end-to-end against staging via
//     `tests/_proto-auth-network-probe.spec.ts` (full UI login captured;
//     dump under `test-results/_proto-auth-probe-<timestamp>.json`) AND
//     via direct `fetch()` probe — the endpoint does NOT require the
//     prior email-lookup step, does NOT require `x-maestro-client-id`,
//     and does NOT require the mysterious `token` query param. The
//     email-lookup is purely UI-facing disambiguation (which auth
//     provider does this email use?); the login endpoint accepts a
//     direct call from any client that knows the email/password/siteId.
//
//   Why the response field is `jwt`, not `accessToken`
//     The server's contract names the bearer field `jwt`. The SDK's
//     localStorage key uses the legacy name `authData.v3.accessToken.v1`
//     — but the value stored is the same `jwt` string from this endpoint.
//     `buildStorageState` keeps the legacy key shape so role-bound
//     projects pick the state up unchanged.
//
//   Email lookup endpoint (kept for completeness — NOT called by this module)
//     GET https://{API_HOST}/account/v3/<email>?type=email&token=<TOKEN>
//     Headers required: x-maestro-client-id: <SITE_ID>
//     `token` is a JWT signed client-side; payload shape is
//     `{ data: "<siteId>/<timestampMs>/<random>", iat: <unixSec> }`.
//     It's an anti-bot/CSRF token minted by the SPA before the lookup
//     fires. We don't need it because we bypass the lookup entirely.
//
//   Auth storage model
//     Maestro stores the session ENTIRELY in localStorage, NOT cookies.
//     Verified via `.auth/admin.json` shape — only Stripe cookies are
//     present; the JWT lives at localStorage key
//     `maestro__<SITE_ID>__authData.v3.accessToken.v1` with a sibling
//     refreshToken and `service: "email"` marker.
//
//   Site-id resolution
//     The role-bound projects need an ADMIN-scope JWT. That requires the
//     SPECIFIC siteId the admin account is bound to. Calling /auth/v2/login
//     with a DIFFERENT siteId still returns 200 with a JWT, but the JWT
//     carries only viewer-scope roles — silently breaking the admin shell.
//
//     Resolution lives in `src/utils/siteId.ts`, shared with channels /
//     tickets / videos so every caller resolves the same way.
//
// ──────────────────────────────────────────────────────────────────────────
// Public surface (stable across Phase 5B → 5B.1 completion)
// ──────────────────────────────────────────────────────────────────────────
//
//   loginViaApi(role: Role): Promise<LoginResult>
//
//   LoginResult is shape-compatible with Playwright's storageState. The
//   caller can JSON.stringify it directly into `.auth/<role>.json` and
//   any chromium-<role> project will pick it up via
//   `use.storageState: '.auth/<role>.json'`.

// RUNNER-NEUTRALITY: this module is imported by src/api/videos.ts and
// src/api/ads.ts, which the VANILLA-runner lanes (tests/webkit-smoke,
// tests/firefox-smoke) load for API discovery and config. A static
// value-import of 'patchright/test' — or of fixtures/auth, which pulls it
// transitively — makes the vanilla runner require @playwright/test a second
// time and abort with "Requiring @playwright/test second time … No tests
// found" (observed 2026-08-25). So: role credentials come from the neutral
// src/utils/roleCreds.ts, and the only runner-bound value (`request`) is
// imported LAZILY inside loginViaApi, which runs solely under the
// patchright setup project.
import type { APIRequestContext } from 'patchright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { env } from '../utils/env';
import { testData } from '../test-data';
import { resolveDefaultSiteId } from '../utils/siteId';
import { credsForRole, type Role } from '../utils/roleCreds';

/**
 * Derive the API host from BASE_URL.
 * - web.us-central1-*.gcp.maestro.io → api.us-central1-*.gcp.maestro.io (replace web. with api.)
 * - maestro.tv (custom prod domain)  → api.us-central1-master.gcp.maestro.io
 * - pearl.maestro.io (staging CDN)   → api.us-central1-staging.gcp.maestro.io
 * - dev.web.maestro.io (dev CDN)     → dev.api.maestro.io
 * Exported so channels / tickets / accounts / channelLifecycle can reuse it.
 */
export function resolveApiHost(): string {
  // Explicit override (e.g. point APIs at us-central1-dev while iterating).
  const override =
    process.env.API_HOST?.trim() || process.env.API_SITE_URL?.trim();
  if (override) {
    return override.replace(/\/$/, '');
  }

  // Profile pin beats inference. Set it only when a host breaks the mapping.
  if (testData.apiHost) {
    return testData.apiHost.replace(/\/$/, '');
  }

  const baseUrl = env.BASE_URL;
  try {
    const { hostname } = new URL(baseUrl);
    if (hostname === 'maestro.tv') {
      return 'https://api.us-central1-master.gcp.maestro.io';
    }
    // Friendly CDN aliases (must be checked before the generic web.* rule —
    // hostname is "dev.web.maestro.io", which does NOT start with "web.").
    if (hostname === 'dev.web.maestro.io') {
      return 'https://dev.api.maestro.io';
    }
    // CDN front doors: dev.web.maestro.io / staging.web.maestro.io / …
    const webCdn = hostname.match(
      /^(dev|staging|prod)\.web\.maestro\.io$/i,
    );
    if (webCdn) {
      const envName = webCdn[1].toLowerCase();
      const project =
        envName === 'prod' ? 'master' : envName === 'staging' ? 'staging' : 'dev';
      return `https://api.us-central1-${project}.gcp.maestro.io`;
    }
    // pearl.maestro.io is the staging CDN frontend
    if (hostname === 'pearl.maestro.io') {
      return 'https://api.us-central1-staging.gcp.maestro.io';
    }
    // GCP env hostnames (dev / staging / master) when BASE_URL is the API
    // or another non-web front door for that project.
    const gcpMatch = hostname.match(
      /^(?:api\.)?us-central1-(dev|staging|master)\.gcp\.maestro\.io$/i,
    );
    if (gcpMatch) {
      return `https://api.us-central1-${gcpMatch[1].toLowerCase()}.gcp.maestro.io`;
    }
    // Generic GCP web front door, e.g. web.us-central1-dev.gcp.maestro.io
    if (hostname.startsWith('web.')) {
      return `https://${hostname.replace('web.', 'api.')}`;
    }
  } catch {
    // fall through to default
  }
  return 'https://api.us-central1-staging.gcp.maestro.io';
}

/** Default API host. Mirrors the env wiring in `src/api/channels.ts`. */
const API_HOST_DEFAULT = resolveApiHost();

const SITE_ID_DEFAULT = resolveDefaultSiteId();

/**
 * Origin header sent to the API. Derived from BASE_URL so requests look
 * like they come from the correct SPA host for the target environment.
 */
export function resolveOriginHeader(): string {
  const baseUrl = env.BASE_URL;
  try {
    const { hostname, origin } = new URL(baseUrl);
    if (hostname === 'maestro.tv' || hostname.includes('us-central1-master')) {
      return 'https://maestro.tv';
    }
    // For web.us-central1-* clusters, use the actual web origin
    if (hostname.startsWith('web.')) {
      return `https://${hostname}`;
    }
    return origin;
  } catch {
    return 'https://pearl.maestro.io';
  }
}

/** Origin we present to the API. */
const ORIGIN_HEADER = resolveOriginHeader();

/** Path to the admin storageState dump — written by `tests/setup/auth.setup.ts`.
 *  Shared by `readAdminAuth` (the API clients' admin-token reader). */
const ADMIN_STATE = resolve('.auth/admin.json');

// Playwright's storageState shape. Replicating the relevant subset so we
// don't have to import Playwright's private types.

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface LocalStorageEntry {
  name: string;
  value: string;
}

export interface OriginStorage {
  origin: string;
  localStorage: LocalStorageEntry[];
}

export interface LoginResult {
  /** Browser cookies. Maestro auth doesn't use cookies for the session
   *  itself; this is reserved for any Set-Cookie the lookup/login flow
   *  emits (e.g. CSRF, analytics). Empty array is valid. */
  cookies: Cookie[];
  /** localStorage entries keyed by origin. The pearl.maestro.io origin
   *  carries the authData.v3.* keys (accessToken, refreshToken, service)
   *  that the SDK reads on shell boot to recognise an authenticated user. */
  origins: OriginStorage[];
}

/**
 * Decoded JWT payload from `authData.v3.accessToken.v1`. The fields we use:
 *   - `siteId` — outranks env siteId (the JWT is the source of truth for
 *     which site this admin can actually write to). Matches the resolution
 *     order in `src/api/channels.ts.readAdminAuth`.
 *   - `exp`   — Unix seconds expiry. JWT lifetime is ~30 days; consumers
 *     should re-run setup if expiry is within 24 hours.
 */
interface JwtPayload {
  _id: string;
  email: string;
  siteId: string;
  exp: number;
  service: string;
  uid: string;
}

/**
 * Decode the middle (payload) segment of a JWT. Base64url, no signature
 * verification — the server's signature is trusted; we just need the
 * claims for the storageState envelope.
 */
export function decodeJwtPayload(jwt: string): JwtPayload {
  const segs = jwt.split('.');
  if (segs.length !== 3) {
    throw new Error(
      `[api/auth] decodeJwtPayload: expected 3 JWT segments, got ${segs.length}`,
    );
  }
  const payloadB64 = segs[1].replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (payloadB64.length % 4)) % 4);
  const json = Buffer.from(payloadB64 + padding, 'base64').toString('utf8');
  return JSON.parse(json) as JwtPayload;
}

/**
 * Admin Bearer token + creator/owner user-id + siteId, read from the
 * storageState dump. The JWT payload carries the user `_id` and `siteId`
 * so callers do not have to thread them through env.
 */
export interface AdminAuth {
  accessToken: string;
  userId: string;
  siteId: string;
}

/**
 * Read the admin Bearer token + user-id + siteId from the storageState dump
 * (`.auth/admin.json`, written by the setup project). The JWT payload carries
 * `_id` and `siteId`; `siteId` is the source of truth for which site this
 * admin can write to (it outranks the env var).
 *
 * Shared by `src/api/channels.ts` and `src/api/tickets.ts` — both API clients
 * need the same admin token and resolution order. Extracted here (alongside
 * `decodeJwtPayload`) so the file-read + JWT-decode logic lives once.
 *
 * Throws loudly on any failure — missing file, missing key, malformed JWT,
 * expired token. Soft-fail is wrong: a test that needs the admin token cannot
 * proceed without it, and the failure must surface at call time, not midway
 * through the suite.
 */
export async function readAdminAuth(): Promise<AdminAuth> {
  let raw: string;
  try {
    raw = await readFile(ADMIN_STATE, 'utf8');
  } catch (err) {
    throw new Error(
      `[api/auth] Cannot read admin storageState at ${ADMIN_STATE}. ` +
        `Was the setup project run? Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: {
    origins?: Array<{
      localStorage?: Array<{ name: string; value: string }>;
    }>;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `[api/auth] admin storageState at ${ADMIN_STATE} is not JSON. ` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const all = parsed?.origins?.flatMap((o) => o.localStorage ?? []) ?? [];
  const tokenEntry = all.find((e) =>
    /^maestro__[a-f0-9]+__authData\.v3\.accessToken\.v1$/i.test(e.name),
  );
  if (!tokenEntry) {
    throw new Error(
      `[api/auth] No accessToken found in ${ADMIN_STATE} localStorage. ` +
        `Re-run setup project (yarn test --project=setup).`,
    );
  }
  // The value is JSON-stringified ("eyJ..."), strip the quotes.
  const accessToken = JSON.parse(tokenEntry.value) as string;

  const payload = decodeJwtPayload(accessToken);
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
    throw new Error(
      `[api/auth] accessToken is expired (exp=${payload.exp}). ` +
        `Re-run setup project.`,
    );
  }
  if (!payload._id || !payload.siteId) {
    throw new Error(
      `[api/auth] JWT payload missing _id or siteId. Re-run setup project.`,
    );
  }
  return {
    accessToken,
    userId: payload._id,
    siteId: payload.siteId,
  };
}

/**
 * Build the storageState envelope Playwright expects, given a fresh JWT
 * and refreshToken. The siteId is taken from the JWT — that's the
 * authoritative binding (an admin's session is locked to ONE site).
 */
export function buildStorageState(
  accessToken: string,
  refreshToken: string,
  service: string,
  jwtPayload: JwtPayload,
): LoginResult {
  const siteId = jwtPayload.siteId;
  if (!siteId) {
    throw new Error(
      '[api/auth] buildStorageState: JWT payload has no siteId claim — ' +
        'cannot key the localStorage entries.',
    );
  }
  // Key shape lifted from a known-working `.auth/admin.json`:
  //   maestro__<SITE_ID>__authData.v3.accessToken.v1
  //   maestro__<SITE_ID>__authData.v3.refreshToken
  //   maestro__<SITE_ID>__authData.v3.service
  const prefix = `maestro__${siteId}__authData.v3`;
  // Use the SPA's actual serving origin (from BASE_URL) for localStorage entries.
  // ORIGIN_HEADER is only for the HTTP Origin request header (API CORS); it is
  // 'pearl.maestro.io' on dev/staging, while the SPA runs on a different origin
  // (e.g. web.us-central1-dev.gcp.maestro.io). localStorage is same-origin-only,
  // so tokens stored under the wrong origin are invisible to the app.
  const spaOrigin = new URL(env.BASE_URL).origin;
  // GDPR banner (`gdprSaga`) shows only when AcceptedTermsVersion is missing /
  // non-numeric. Seed the same key Accept writes (GDPR_CURRENT_VERSION = 2)
  // so the bottom toolbar is never covered in e2e — no click-dismiss needed.
  const gdprKey = `maestro__${siteId}__AcceptedTermsVersion`;
  return {
    cookies: [],
    origins: [
      {
        origin: spaOrigin,
        localStorage: [
          // Values are JSON-stringified (the wrapping quotes are part of
          // the stored value). The SDK does `JSON.parse(localStorage.getItem(...))`
          // on read.
          {
            name: `${prefix}.accessToken.v1`,
            value: JSON.stringify(accessToken),
          },
          {
            name: `${prefix}.refreshToken`,
            value: JSON.stringify(refreshToken),
          },
          { name: `${prefix}.service`, value: JSON.stringify(service) },
          { name: gdprKey, value: JSON.stringify(2) },
        ],
      },
    ],
  };
}

/**
 * Email-lookup step.
 *
 * Calls `GET {API_HOST}/account/v3/<email>?type=email&token=<CSRF_JWT>`.
 * Returns a small `{ email, name, success }` object that the SPA uses to
 * decide whether to render the password-input view or the registration
 * view.
 *
 * NOT CALLED by `loginViaApi`. Phase 5B.1 probe confirmed the password
 * endpoint accepts a direct POST without the lookup; calling lookup
 * would require minting the `token` JWT client-side, which needs the
 * SPA's signing secret. Kept exported for any future caller that wants
 * to disambiguate provider (email vs SSO) without attempting a password
 * POST first.
 *
 * NOTE: this stub remains a deliberate throw — wiring it would require
 * the token-minting path, which we have not yet reverse-engineered.
 * The throw documents the precondition.
 */
export async function lookupEmail(
  _ctx: APIRequestContext,
  _email: string,
  _siteId: string,
): Promise<{ exists: boolean; service: string }> {
  throw new Error(
    '[api/auth] lookupEmail: not implemented — the `token` query param ' +
      "requires a JWT signed with the SPA's client-side secret. " +
      'loginViaApi bypasses lookup entirely and calls /auth/v2/login ' +
      'directly; use that instead.',
  );
}

/**
 * Password-submit step. Direct POST to `/auth/v2/login`.
 *
 * Endpoint shape (Phase 5B.1 probe, 2026-05-25):
 *   POST {API_HOST}/auth/v2/login
 *   Content-Type: application/json;charset=UTF-8
 *   Body:    { email, password, siteId }
 *   Returns: 200 + { jwt, refreshToken, service }
 *
 * The endpoint does NOT require:
 *   - the email-lookup step that the SPA does first
 *   - the `x-maestro-client-id` header (the siteId is in the body)
 *   - the anti-bot `token` JWT used by the lookup
 *
 * Response field naming: the server uses `jwt`, not `accessToken`. We
 * normalise to `{ accessToken, refreshToken, service }` here so the
 * caller (`loginViaApi`) and `buildStorageState` see a single canonical
 * shape — keeping the legacy localStorage key `authData.v3.accessToken.v1`
 * meaningful even though the wire field is `jwt`.
 */
export async function submitPassword(
  ctx: APIRequestContext,
  email: string,
  password: string,
  siteId: string,
): Promise<{
  accessToken: string;
  refreshToken: string;
  service: string;
}> {
  const resp = await ctx.post('/auth/v2/login', {
    headers: {
      'content-type': 'application/json;charset=UTF-8',
      accept: 'application/json, text/plain, */*',
    },
    data: { email, password, siteId },
  });
  if (!resp.ok()) {
    const text = await resp.text().catch(() => '<unreadable>');
    throw new Error(
      `[api/auth] submitPassword: POST /auth/v2/login failed: ` +
        `${resp.status()} ${resp.statusText()} — ${text}`,
    );
  }
  let body: { jwt?: string; refreshToken?: string; service?: string };
  try {
    body = (await resp.json()) as typeof body;
  } catch (err) {
    throw new Error(
      `[api/auth] submitPassword: response was not JSON. ` +
        `Original: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!body.jwt || !body.refreshToken || !body.service) {
    throw new Error(
      `[api/auth] submitPassword: response missing required fields. ` +
        `Got keys: ${Object.keys(body).join(', ')}`,
    );
  }
  return {
    accessToken: body.jwt,
    refreshToken: body.refreshToken,
    service: body.service,
  };
}

/**
 * Top-level API login. Calls `submitPassword` directly (no email-lookup
 * step needed — see Phase 5B.1 header notes) and packages the result as a
 * Playwright storageState envelope.
 *
 * Throws on:
 *   - missing siteId (BASE_URL is not int-automation and env has no value)
 *   - missing env (BASE_URL, ADMIN_USER, DEFAULT_PASS, role creds)
 *   - submitPassword failure (network error, 4xx/5xx, malformed response)
 *   - JWT decode failure
 *
 * Soft-fail is the wrong default here: this function is fixture setup,
 * not test body. A silent failure produces a "no storageState" runtime
 * that all role-bound projects then trip over with confusing errors. We
 * want the failure to surface AT setup time.
 */
export async function loginViaApi(role: Role): Promise<LoginResult> {
  // credsForRole comes from the runner-neutral utils module (static import
  // above). Only `request` is runner-bound, and a BARE specifier dynamic
  // import carries no node16 extension requirement.
  const { request } = await import('patchright/test');
  const { user, pass } = credsForRole(role);
  if (!SITE_ID_DEFAULT) {
    throw new Error(
      '[api/auth] loginViaApi: could not resolve a siteId. BASE_URL does ' +
        'not point at the committed profile site (src/test-data/' +
        'environments.ts). Unset BASE_URL to use the profile, or add a ' +
        'profile for the site you are targeting.',
    );
  }

  const ctx = await request.newContext({
    baseURL: API_HOST_DEFAULT,
    extraHTTPHeaders: {
      Origin: ORIGIN_HEADER,
      Referer: `${ORIGIN_HEADER}/`,
    },
  });

  try {
    // Phase 5B.1: the email-lookup step is intentionally skipped — the
    // /auth/v2/login endpoint accepts a direct POST with credentials +
    // siteId and returns the JWT triple in one round-trip. Lookup is a
    // UI disambiguation step only (which provider does this email use?),
    // and skipping it removes the need to mint the anti-bot `token` JWT.
    const auth = await submitPassword(ctx, user, pass, SITE_ID_DEFAULT);

    // Decode JWT for the siteId claim, then assemble storageState.
    const payload = decodeJwtPayload(auth.accessToken);
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) {
      throw new Error(
        `[api/auth] loginViaApi(${role}): server returned a JWT that is ` +
          `already expired (exp=${payload.exp}). Clock skew or stale ` +
          `server response — re-run setup.`,
      );
    }
    // Diagnostic: log JWT siteId so CI output shows whether the dev API returns
    // the expected siteId (615bd47e9120a2002daf5b33 for /dodwmd channel).
    // If the dev cluster returns a DIFFERENT siteId the admin bar won't show —
    // the SPA keys its localStorage reads off the siteId it receives from the
    // channel config API, not the one embedded in the JWT.
    // eslint-disable-next-line no-console
    console.log(
      `[api/auth] loginViaApi(${role}): JWT siteId=${payload.siteId} ` +
        `(expected siteId=${SITE_ID_DEFAULT ?? 'unset'}) ` +
        `storageOrigin=${new URL(env.BASE_URL).origin}`,
    );
    return buildStorageState(
      auth.accessToken,
      auth.refreshToken,
      auth.service,
      payload,
    );
  } finally {
    await ctx.dispose();
  }
}

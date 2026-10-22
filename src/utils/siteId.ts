// src/utils/siteId.ts
//
// Single source of truth for "which siteId does this BASE_URL belong to".
// Leaf module: api/auth.ts imports fixtures/auth.ts, so anything the fixtures
// also need must live outside api/ to avoid an import cycle.

import { env } from './env';
import { testData } from '../test-data';

/**
 * siteId for API calls — the committed profile's, when BASE_URL points at
 * the profile's site. Returns undefined for any other site — callers throw
 * loudly in that case (retargeting means adding a profile to
 * src/test-data/environments.ts, not pointing env vars at an undeclared
 * site).
 */
export function resolveDefaultSiteId(): string | undefined {
  if (env.BASE_URL.includes(`/${testData.siteSlug}`)) return testData.siteId;
  return undefined;
}

/**
 * siteId of the site BASE_URL serves — the one whose consent key the
 * browser reads. Same resolution as resolveDefaultSiteId in this template.
 */
export function resolveBrowserSiteId(): string | undefined {
  return resolveDefaultSiteId();
}

/**
 * localStorage key the app writes when the terms/cookie banner is answered.
 * Value is the accepted terms version, or `-1` for rejected.
 */
export function acceptedTermsKey(siteId: string): string {
  return `maestro__${siteId}__AcceptedTermsVersion`;
}

/** Rejected-consent value. Privacy-preserving default for test runs. */
export const TERMS_REJECTED = '-1';

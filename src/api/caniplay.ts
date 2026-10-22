// src/api/caniplay.ts
//
// The server-side access oracle for the paywall.
//
// Every video page load asks `GET /caniplay/v1/<videoId>?kind=video&intent=…`
// whether the current viewer may play. Observed 2026-10-22 on dev:
//
//   non-entitled (anonymous or logged in): 401 {"access":"no_entitlement","paywallSource":"video"}
//   entitled buyer:                        200 {"contentCheck":{"access":"full",…,"video":{…}}}
//
// The UI paywall is only half the story — an overlay can be hidden while the
// server still says no (lockout), or the server can say yes while the overlay
// lingers. Specs assert BOTH: the page object for what the viewer sees, this
// module for what the server decided.
//
// Two ways in:
//   * captureAccessCheck(page, action) — passively records the request the
//     SPA itself makes while `action` navigates/reloads. No auth plumbing of
//     our own, so it checks exactly what the real client is told.
//   * requestAccessWithoutAuth(intent) — Node-side call with no session at
//     all, to prove the gate is enforced server-side (P1-3).

import type { APIRequestContext, Page, Response } from 'patchright/test';
import { resolveApiHost, resolveOriginHeader } from './auth';
import { videoPage } from '../utils/videoPage';
import { testData } from '../test-data';

/** The `access` value the server returns for a viewer without entitlement. */
export const NO_ENTITLEMENT = 'no_entitlement';
/** The `contentCheck.access` value for a viewer allowed to watch the whole video. */
export const FULL_ACCESS = 'full';

export type AccessIntent = 'check' | 'play';

export interface AccessDecision {
  status: number;
  /** `access` (denials) or `contentCheck.access` (grants) — undefined when neither is present. */
  access: string | undefined;
  body: unknown;
  url: string;
}

/** One-line evidence for assertion messages: status + body. */
export function describeDecision(decision: AccessDecision): string {
  return `caniplay ${decision.status} ${JSON.stringify(decision.body).slice(0, 300)}`;
}

/** True only for an explicit full grant — an unknown body shape is NOT access. */
export function isGranted(decision: AccessDecision): boolean {
  return decision.status >= 200 && decision.status < 300 && decision.access === FULL_ACCESS;
}

function isAccessCheck(response: Response, videoId: string): boolean {
  const url = response.url();
  return url.includes(`/caniplay/v1/${videoId}`) && response.request().method() === 'GET';
}

async function toDecision(response: { status(): number; url(): string; text(): Promise<string> }): Promise<AccessDecision> {
  const text = await response.text().catch(() => '');
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Non-JSON body — keep the raw text for the failure message.
  }
  const shaped = (body && typeof body === 'object' ? body : {}) as {
    access?: unknown;
    contentCheck?: { access?: unknown };
  };
  const raw = shaped.access ?? shaped.contentCheck?.access;
  const access = raw === undefined ? undefined : String(raw);
  return { status: response.status(), access, body, url: response.url() };
}

/**
 * Run `action` (a goto / reload / login) and return the access decision the
 * page received for the video under test during it.
 */
export async function captureAccessCheck(
  page: Page,
  action: () => Promise<unknown>,
  videoId = videoPage.videoId,
): Promise<AccessDecision> {
  const responsePromise = page.waitForResponse((r) => isAccessCheck(r, videoId), {
    timeout: 60_000,
  });
  await action();
  return toDecision(await responsePromise);
}

/**
 * Ask caniplay directly with no session (no cookies, no bearer token) —
 * what a scraper or a hand-rolled curl would get.
 */
export async function requestAccessWithoutAuth(
  intent: AccessIntent,
  videoId = videoPage.videoId,
): Promise<AccessDecision> {
  const { request } = await import('patchright/test');
  const origin = resolveOriginHeader();
  // Both headers are required just to reach the gate: without them the API
  // answers 400 ("origin header is required" / "Missing x-maestro-client-id
  // header") and the call would prove nothing about entitlement.
  const ctx: APIRequestContext = await request.newContext({
    baseURL: resolveApiHost(),
    extraHTTPHeaders: {
      Origin: origin,
      Referer: `${origin}/`,
      'x-maestro-client-id': testData.siteId,
    },
  });
  try {
    const response = await ctx.get(`/caniplay/v1/${videoId}`, {
      params: { kind: 'video', intent, slug: videoId },
      failOnStatusCode: false,
    });
    return await toDecision(response);
  } finally {
    await ctx.dispose();
  }
}

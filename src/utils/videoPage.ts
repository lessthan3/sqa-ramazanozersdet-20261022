// src/utils/videoPage.ts
//
// The one place the paywalled video page URL is built. Specs and page objects
// call videoPageUrl() — the id lives on the environment profile
// (src/test-data/environments.ts), so a new target page is a one-line change.

import { testData } from '../test-data';
import { env } from './env';

/** The video page under test, as committed on the active profile. */
export const videoPage = testData.videoPage;

/** Absolute URL of the paywalled video page on the active environment. */
export function videoPageUrl(): string {
  return `${env.BASE_URL.replace(/\/$/, '')}/v/${videoPage.videoId}`;
}

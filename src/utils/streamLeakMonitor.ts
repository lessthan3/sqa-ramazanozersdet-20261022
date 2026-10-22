// src/utils/streamLeakMonitor.ts
//
// Records every sign that the protected video stream reached the browser:
// a request to the stream host / an HLS manifest, or an API response body
// that embeds the stream URL. The video record carries the raw Mux URL
// (`https://stream.mux.com/<id>.m3u8`, seen in the admin's video/v3 payload),
// so a paywall that only hides the player while the API still serves that
// URL is a revenue leak anyone with DevTools can exploit.
//
// Used both ways so the negative assertion is never vacuous:
//   * non-entitled viewer → expect no leaks
//   * entitled viewer     → expect stream traffic (proves the monitor sees it)

import type { Page } from 'patchright/test';

const STREAM_URL = /stream\.mux\.com|\.m3u8(\?|$)/i;

export class StreamLeakMonitor {
  private readonly seen = new Set<string>();

  constructor(page: Page) {
    page.on('request', (request) => {
      if (STREAM_URL.test(request.url())) this.seen.add(`request ${request.url()}`);
    });
    page.on('response', async (response) => {
      const type = response.headers()['content-type'] ?? '';
      if (!/json|text\/plain/.test(type)) return;
      const body = await response.text().catch(() => '');
      if (STREAM_URL.test(body)) this.seen.add(`response body ${response.url()}`);
    });
  }

  /** Everything observed so far, as `request <url>` / `response body <url>`. */
  get leaks(): string[] {
    return [...this.seen];
  }
}

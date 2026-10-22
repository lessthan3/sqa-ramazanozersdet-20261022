// src/utils/paywallData.ts
//
// Run-unique test data for the paywall suite.
//
// Why unique data matters here:
//   * Purchases are PERMANENT on an account — a reused viewer is already
//     entitled next run and would turn every "buy unlocks playback" assertion
//     into a false pass. Every purchase test registers a fresh viewer.
//   * The one-time/rental products are named after the video (the checkout
//     shows "androidpauses.mp4"), so the product name cannot prove THIS run's
//     config reached the viewer. A run-unique PRICE can: a stale config shows
//     a different number.

import { faker } from '@faker-js/faker';
import { videoPage } from './videoPage';

export interface ViewerCredentials {
  email: string;
  password: string;
  name: string;
}

/**
 * Fresh, never-registered viewer. The dev site accepts unverified sign-ups on
 * any domain (verified 2026-10-22); `dummy123.com` matches the interviewer's
 * viewer account so the test accounts are easy to spot and purge.
 */
export function newViewerCredentials(): ViewerCredentials {
  const tag = `${Date.now()}${faker.string.alphanumeric({ length: 5, casing: 'lower' })}`;
  return {
    email: `qa.paywall.${tag}@dummy123.com`,
    password: `Qa-${faker.string.alphanumeric(10)}9$`,
    name: `QA ${faker.person.firstName()}`.slice(0, 20),
  };
}

/**
 * A price in [6.01, 9.99] that differs from every price in `avoid` (e.g. the
 * currently saved one), so a passing assertion cannot be satisfied by stale
 * config. Stays above the €5.00 rental baseline so the two never collide.
 */
export function uniquePrice(...avoid: number[]): number {
  for (;;) {
    const price = faker.number.float({ min: 6.01, max: 9.99, fractionDigits: 2 });
    if (!avoid.some((p) => Math.abs(p - price) < 0.005)) return price;
  }
}

/** Format a price the way the checkout renders it: `EUR €7.37`. */
export function formatPrice(value: number, currency = videoPage.currency): string {
  const symbol = currency === 'EUR' ? '€' : currency === 'USD' ? '$' : '';
  return `${currency} ${symbol}${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Parse a rendered amount (`EUR €1,234.56`) back to a number. */
export function parsePrice(text: string): number {
  const match = text.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) throw new Error(`[paywallData] no amount in "${text}"`);
  return Number(match[0]);
}

/** Stripe test cards — https://docs.stripe.com/testing. */
export const STRIPE_CARDS = {
  success: '4242 4242 4242 4242',
  declined: '4000 0000 0000 0002',
} as const;

/** A card expiry safely in the future, in Stripe's `MM / YY` shape. */
export function futureExpiry(): string {
  const yy = String((new Date().getFullYear() + 3) % 100).padStart(2, '0');
  return `12 / ${yy}`;
}

/** Billing address the checkout requires before Stripe accepts the card. */
export const BILLING = {
  country: 'United States',
  state: 'California',
  zip: '94301',
  cvc: '123',
} as const;

# The Challenge — Video Page Paywall (Admin + Viewer Flows)

## Background — the feature

Maestro sites host **video pages**. A site admin can put a **paywall** on a
video page so that only viewers holding an **entitlement** can watch.

- **The admin side.** The admin configures the paywall on the video page
  itself. There are several ways to monetize the same video — a one-time
  purchase price, a timed rental, a recurring membership, or a ticket — and
  they can be combined. Entitlement products can be attached from the site's
  existing catalog or created on the spot.
- **The viewer side.** A viewer without an entitlement doesn't get playback —
  they land on the paywall: the video's marketing copy, the price, and a
  purchase CTA. Buying (checkout is Stripe-backed) grants the entitlement,
  and the page unlocks. Entitlements belong to the viewer's account, so
  access persists across reloads and fresh logins.

You'll be exploring the real feature on a live dev site. Ask your
interviewer anything about how it works — product questions are expected and
free. **All tools are allowed**: DevTools, Playwright codegen, AI assistants
(Copilot, Cursor, Claude, ChatGPT, …) — whatever you'd use on the job.

**What we evaluate is your judgment, not your tooling — and planning is the
heart of it.** Before you write a line of code, explore the feature and form
a test plan, and walk your interviewer through it:

- What matters most to test here, and **why**? Where can this feature break
  in ways that cost real money or lock out paying viewers?
- What did you deliberately decide *not* to cover in the timebox, and what
  makes that an acceptable risk?
- In what order do you build, so that the highest-value coverage exists even
  if time runs out?

Then build it. We're watching how the plan holds up on contact with the real
product — how you adapt when the feature surprises you, the trade-offs you
make in the suite's design, and the reasoning behind every one of them.

## The page under test

The target site (`barbara-paxico` on the dev CDN) is committed in
src/test-data/environments.ts. The specific **video page URL is provided by
your interviewer** — where you keep it, and how you keep it out of
copy-paste across specs, is your call and part of what we look at.

## Your task

**Everything is already set up for you** — authentication, role fixtures,
browser plumbing, and runnable smoke tests are working out of the box; you
are writing tests against the live site, not building a framework. Put your
specs in this directory (`tests/paywall/`); add page objects under
`src/pages/`, helpers under `src/utils/`, and API clients under `src/api/`
as you see fit.

Cover these two flows well rather than broadly:

1. **Admin flow.** As admin, configure the paywall on the target video page:
   create/attach an entitlement (ticket, membership, rental and/or a
   one-time-purchase price) and save. Verify the setup persists — a reload
   should still show it, and a non-entitled viewer should now hit the
   paywall instead of playback.
2. **Viewer flow.** As a fresh (anonymous or newly-registered) viewer, land
   on the paywalled video page, see the paywall — price, product name,
   purchase CTA — complete the purchase with a Stripe **test card**
   (e.g. `4242 4242 4242 4242`, any future expiry, any CVC), and verify the
   entitlement takes effect: playback is now available, and it survives a
   reload / fresh login.

Within those two flows, negative and edge cases you think matter are
welcome — tell us why you picked them.

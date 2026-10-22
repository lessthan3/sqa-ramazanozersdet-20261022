# Maestro Senior QA Challenge — Paywall Entitlements E2E

Welcome! This repo is a slimmed-down snapshot of Maestro's production
Playwright + Patchright e2e framework. The substrate — auth bootstrap,
role-bound projects, fixtures, and a few reference page objects — is built
and working. **Your job is to design and write the e2e tests for the paywall
feature on video pages.** The assignment lives in
[tests/paywall/CHALLENGE.md](tests/paywall/CHALLENGE.md).

## Prerequisites

- Node 20+
- npm (a `package-lock.json` is committed; `npm ci` gives you the exact tested versions)
- Google Chrome installed (the framework launches real Chrome via
  `channel: 'chrome'`, not bundled Chromium)
- A code editor of your choice (VS Code, Cursor, WebStorm, …)

## Setup

```bash
npm ci
npm run test:smoke   # green = your machine is wired correctly
```

No credentials ship with this repo — your first run will tell you exactly
what's missing. Ask your interviewer for access and put it in a `.env` file
at the repo root.

## Running tests

Runs are **headed and slowed down by default** so you can watch them
(`HEADED=0` / `SLOWMO=0` to override).

```bash
npm run test:paywall   # your specs (tests/paywall/)
npm test               # everything
npm run test:fast      # headless, full speed, parallel
npm run test:report    # HTML report of the last run
```

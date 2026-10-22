// src/utils/workerProfile.ts
//
// Per-worker user-data-dir management for Patchright's
// `launchPersistentContext`. Each Playwright worker calls `acquire()` once
// at worker startup and `release()` at teardown. Lock-safe across parallel
// workers because every dir name is unique (mkdtemp + workerIndex prefix).
//
// Why not under `.profiles/` at repo root: tmpdir is per-OS-user, gets
// cleaned by the OS, and avoids polluting the repo with parallel-test scratch.
// `.profiles/` remains a gitignored *placeholder* in case a future
// debugging workflow wants a stable, named profile — out of scope for Phase 1.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Allocate a fresh user-data-dir under the OS tmpdir. Prefix includes the
 * worker index so leftover dirs are debuggable if cleanup is skipped
 * (Ctrl-C, SIGKILL, etc.).
 */
export async function acquireWorkerProfile(
  workerIndex: number,
): Promise<string> {
  const prefix = `maestro-e2e-w${workerIndex}-`;
  return mkdtemp(join(tmpdir(), prefix));
}

/**
 * Best-effort cleanup with a hard timeout.
 *
 * Phase 3.5 diagnosis (2026-05-22): `fs.rm` on the worker tmpdir can hang
 * indefinitely on macOS when Chrome's SingletonLock / SingletonCookie /
 * SingletonSocket files still have open handles from a Chrome process that
 * was force-terminated (via `browser.close()` + `connection.close()` in the
 * base.ts teardown). The OS file-table eventually releases the handles, but
 * not within Playwright's worker-teardown budget — and an awaited `rm` blocks
 * the fixture function from returning, which Playwright reports as
 * "Worker teardown timeout of 90000ms exceeded".
 *
 * Fix: race `rm` against a 10s deadline. If it doesn't finish, log loudly
 * and let the OS reap the tmpdir on its own schedule (macOS prunes
 * `/var/folders/.../T/` periodically; on CI runners the runner cleans tmpdir
 * between jobs). The leak is bounded by tmpdir's natural lifetime; the alt
 * — blocking the worker — is worse for every downstream consumer.
 */
export async function releaseWorkerProfile(dir: string): Promise<void> {
  const deadlineMs = 10_000;
  const rmPromise = rm(dir, { recursive: true, force: true });
  // Suppress unhandled-rejection if the dangling promise rejects after race.
  rmPromise.catch(() => undefined);
  let timeoutId: NodeJS.Timeout | undefined;
  const result = await Promise.race([
    rmPromise.then(() => 'removed' as const).catch(() => 'errored' as const),
    new Promise<'timeout'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timeout'), deadlineMs);
    }),
  ]);
  if (timeoutId) clearTimeout(timeoutId);
  if (result === 'timeout') {
    // eslint-disable-next-line no-console
    console.warn(
      `[workerProfile] rm did not finish in ${deadlineMs}ms for ${dir} — ` +
        `letting OS tmpdir reaper handle it. Possible cause: Chrome ` +
        `SingletonLock handles still open after browser.close().`,
    );
  } else if (result === 'errored') {
    // eslint-disable-next-line no-console
    console.warn(
      `[workerProfile] rm errored for ${dir} — likely already gone (ENOENT) ` +
        `or held by another process. Non-fatal.`,
    );
  }
}

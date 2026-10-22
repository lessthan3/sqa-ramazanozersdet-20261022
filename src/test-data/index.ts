// src/test-data/index.ts
//
// Resolves the active environment profile. TEST_ENV is the single axis of
// variation; it defaults to `dev` (barbara-paxico on the dev CDN), the only
// committed profile in this template.
//
// Individual env vars still win over the profile — see src/utils/env.ts.
// That keeps ad-hoc targeting (a branch deploy, a local proxy) working
// without inventing a profile for it.

import '../utils/loadEnvFiles';
import { environments, type EnvironmentName, type TestEnvironment } from './environments';

export const DEFAULT_TEST_ENV: EnvironmentName = 'dev';

function readTestEnv(): EnvironmentName {
  const raw = process.env.TEST_ENV?.trim();
  if (!raw) return DEFAULT_TEST_ENV;
  if (Object.hasOwn(environments, raw)) return raw as EnvironmentName;
  throw new Error(
    `[test-data] TEST_ENV='${raw}' is not a known environment. ` +
      `Known: ${Object.keys(environments).join(', ')}. ` +
      'Add a profile to src/test-data/environments.ts rather than ' +
      'pointing env vars at an undeclared environment.',
  );
}

/** Active environment name. */
export const TEST_ENV: EnvironmentName = readTestEnv();

/** Active profile. Non-secret test data for TEST_ENV. */
export const testData: TestEnvironment = environments[TEST_ENV];

export { environments };
export type { EnvironmentName, TestEnvironment, RoleAccount } from './environments';

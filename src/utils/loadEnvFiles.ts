// src/utils/loadEnvFiles.ts
//
// Side-effect import. Loads .env then .env.local, in that order.
//
// Import this FIRST in any module that reads process.env at module scope.
// Babel emits requires in source order, so a first-position import runs
// before the importing module's own body -- which a bare dotenv call
// placed between imports does not.

import 'dotenv/config';
import { config } from 'dotenv';

// .env.local overrides .env. Gitignored, for per-machine credentials.
// cwd is e2e/ when Playwright runs.
config({ path: '.env.local', override: true });

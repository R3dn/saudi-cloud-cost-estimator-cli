import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'saudi-cloud-costs-vitest-'));
process.env['SAUDI_CLOUD_COSTS_CACHE_DIR'] = dir;
process.env['NODE_ENV'] = 'test';

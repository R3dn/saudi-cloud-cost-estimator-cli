import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist', 'index.js');
let PRELOAD_DIR: string;
let PRELOAD: string;

/**
 * CLI end-to-end smoke tests: run the built binary with fetch mocked via
 * module preload. Verifies command routing, exit codes and the JSON contract
 * that CI consumers rely on. Builds dist/ first if it is not present, so a
 * bare `npm test` works in CI and fresh checkouts.
 */

async function ensureDistBuilt(): Promise<void> {
  if (existsSync(DIST)) return;
  await new Promise<void>((resolve, reject) => {
    execFileSync('npm', ['run', 'build'], {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 180_000,
      shell: process.platform === 'win32',
    });
    if (existsSync(DIST)) resolve();
    else reject(new Error('npm run build completed but dist/index.js is missing'));
  });
}

function mockFetchScript(): string {
  const ociList = {
    items: [
      {
        partNumber: 'B93113',
        displayName: 'Compute OCPU',
        metricName: 'OCPU Per Hour',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] }],
      },
      {
        partNumber: 'B93114',
        displayName: 'Compute Memory',
        metricName: 'Gigabyte Per Hour',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] }],
      },
      {
        partNumber: 'B96545',
        displayName: 'OKE Enhanced Cluster',
        metricName: 'Cluster Per Hour',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.37504 }] }],
      },
      {
        partNumber: 'B93456',
        displayName: 'Outbound Data Transfer MEA',
        metricName: 'Gigabyte Outbound Data Transfer Per Month',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.18752 }] }],
      },
      {
        partNumber: 'B93030',
        displayName: 'Load Balancer Base',
        metricName: 'Load Balancer',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.04237952 }] }],
      },
      {
        partNumber: 'B91628',
        displayName: 'Object Storage',
        metricName: 'Gigabyte Storage Capacity Per Month',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0956352 }] }],
      },
      {
        partNumber: 'B91961',
        displayName: 'Block Storage',
        metricName: 'Gigabyte Storage Capacity Per Month',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0956352 }] }],
      },
      {
        partNumber: 'B89057',
        displayName: 'File Storage',
        metricName: 'Gigabyte Storage Capacity Per Month',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 1.12512 }] }],
      },
      {
        partNumber: 'B112725',
        displayName: 'Base Database Standard ECPU',
        metricName: 'ECPU Per Hour',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.20177152 }] }],
      },
      {
        partNumber: 'B111584',
        displayName: 'Base Database Storage',
        metricName: 'Gigabyte (GB) Storage Capacity Per Month',
        currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.450048 }] }],
      },
    ],
  };
  const fx = { rates: { SAR: 3.75 } };
  const body = JSON.stringify({ ociList, fx });
  return `
const { ociList, fx } = ${body};
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('apexapps.oracle.com')) {
    return { ok: true, json: async () => ociList };
  }
  if (u.includes('open.er-api.com')) {
    return { ok: true, json: async () => fx };
  }
  throw new Error('unexpected fetch in smoke test: ' + u);
};
`;
}

function runCli(args: string[], env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  const cacheDir = mkdtempSync(join(tmpdir(), 'scc-smoke-'));
  try {
    const stdout = execFileSync(
      process.execPath,
      ['--no-warnings', `--import=${pathToFileURL(PRELOAD).href}`, DIST, ...args],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          SAUDI_CLOUD_COSTS_CACHE_DIR: cacheDir,
          GOOGLE_CLOUD_API_KEY: '',
          NO_COLOR: '1',
          ...env,
        },
        timeout: 60_000,
      },
    );
    return { status: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
    return { status: e.status ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? e.message };
  }
}

describe('CLI smoke (built dist)', () => {
  beforeAll(async () => {
    await ensureDistBuilt();
    PRELOAD_DIR = mkdtempSync(join(tmpdir(), 'scc-smoke-preload-'));
    PRELOAD = join(PRELOAD_DIR, 'preload.mjs');
    writeFileSync(PRELOAD, mockFetchScript(), 'utf8');
  });

  afterAll(() => {
    if (PRELOAD_DIR) rmSync(PRELOAD_DIR, { recursive: true, force: true });
  });

  it('regions command lists all providers and exits 0', () => {
    const r = runCli(['regions']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Oracle Cloud Infrastructure');
    expect(r.stdout).toContain('me-riyadh-1');
    expect(r.stdout).toContain('Middle East (Bahrain)');
  });

  it('--help exits 0 and lists service commands', () => {
    const r = runCli(['--help']);
    expect(r.status).toBe(0);
    for (const cmd of ['compute', 'storage', 'database', 'k8s', 'network', 'tco', 'regions']) {
      expect(r.stdout).toContain(cmd);
    }
  });

  it('compute estimate emits the documented JSON envelope with provenance', () => {
    const r = runCli(['compute', 'estimate', '-p', 'oci', '-s', 'medium', '--json']);
    expect(r.status).toBe(0);
    const est = JSON.parse(r.stdout) as Record<string, unknown>;
    expect(est['source']).toBe('live');
    expect(typeof est['monthlyVat']).toBe('number');
    expect(est['currency']).toBe('SAR');
  });

  it('storage compare resolves each provider region and never fabricates a GCP row', () => {
    const r = runCli(['storage', 'compare', '--block', '10', '--json']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { rows: { provider: string; monthly: number | null; error: string | null }[] };
    const providersSeen = out.rows.map((x) => x.provider).sort();
    expect(providersSeen).toEqual(['aws', 'azure', 'gcp', 'oci']);
    const gcp = out.rows.find((x) => x.provider === 'gcp')!;
    expect(gcp.monthly).toBeNull();
    expect(gcp.error).toBeTruthy();
  });

  it('k8s estimate respects -p (single provider, no cross-provider table)', () => {
    const r = runCli(['k8s', 'estimate', '-p', 'oci', '--nodes', '2', '--json']);
    expect(r.status).toBe(0);
    const est = JSON.parse(r.stdout) as { provider: string; components: Record<string, { source: string }> };
    expect(est.provider).toBe('oci');
    expect(est.components.nodes).toBeDefined();
  });

  it('tco with db none yields exactly zero database and kubernetes lines', () => {
    const r = runCli(['tco', '-p', 'oci', '--db-engine', 'none', '--k8s-nodes', '0', '--json']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { services: Record<string, { monthly: number }> };
    expect(out.services.database.monthly).toBe(0);
    expect(out.services.kubernetes.monthly).toBe(0);
  });

  it('tco --hours propagates to compute', () => {
    const r = runCli([
      'tco', '-p', 'oci', '--hours', '100', '--db-engine', 'none', '--k8s-nodes', '0',
      '--network-egress', '0', '--network-lb', '0', '--storage-block', '0', '--json',
    ]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { services: { compute: { monthly: number } } };
    expect(out.services.compute.monthly).toBeCloseTo(46.50496, 3);
  });

  it('invalid size exits non-zero with a usage error', () => {
    const r = runCli(['compute', 'compare', '-s', 'enormous', '--json']);
    expect(r.status).not.toBe(0);
  });

  it('compute estimate prices a custom OCI flex shape via --ocpus/--memory', () => {
    const r = runCli(['compute', 'estimate', '-p', 'oci', '--ocpus', '6', '--memory', '48', '--json']);
    expect(r.status).toBe(0);
    const est = JSON.parse(r.stdout) as Record<string, unknown>;
    // 6 * 0.09376 + 48 * 0.0056256 = 0.56256 + 0.2700288
    expect(est['hourly']).toBeCloseTo(0.8325888, 6);
    expect(est['source']).toBe('live');
  });

  it('compute estimate accepts the 2xlarge profile', () => {
    const r = runCli(['compute', 'estimate', '-p', 'oci', '-s', '2xlarge', '--json']);
    expect(r.status).toBe(0);
    const est = JSON.parse(r.stdout) as Record<string, unknown>;
    // 32 * 0.09376 + 128 * 0.0056256 = 3.00032 + 0.7200768
    expect(est['hourly']).toBeCloseTo(3.7203968, 6);
    expect(est['vcpu']).toBe(32);
  });

  it('compute estimate rejects --instance on OCI with a pointing error', () => {
    const r = runCli(['compute', 'estimate', '-p', 'oci', '--instance', 'VM.Standard.E4.Flex', '--json']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('--ocpus');
  });

  it('compute estimate rejects --instance combined with --size', () => {
    const r = runCli(['compute', 'estimate', '-p', 'oci', '-s', 'medium', '--instance', 'x', '--json']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('cannot be combined');
  });

  it('compute compare json lists every profile row for medium', () => {
    const r = runCli(['compute', 'compare', '-s', 'mem-medium', '--json']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { input: { profile: string }; rows: { provider: string; region: string }[] };
    expect(out.input.profile).toBe('mem-medium');
    expect(out.rows.map((x) => x.provider).sort()).toEqual(['aws', 'azure', 'gcp', 'oci']);
    expect(out.rows.every((x) => typeof x.region === 'string' && x.region.length > 0)).toBe(true);
  });

  it('unknown region exits non-zero', () => {
    const r = runCli(['compute', 'estimate', '-p', 'oci', '-r', 'not-a-region', '--json']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('Unknown');
  });

  it('compare JSON includes source provenance per row', () => {
    const r = runCli(['compute', 'compare', '--json']);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as { rows: { provider: string; source: string | null; error: string | null }[] };
    const oci = out.rows.find((x) => x.provider === 'oci')!;
    expect(oci.source).toBe('live');
  });
});

#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import pc from 'picocolors';
import { readFileSync } from 'node:fs';
import type { Currency, ProviderId, SizeProfile } from './core/types.js';
import { providers } from './providers/index.js';
import { DEFAULT_HOURS, SIZE_PROFILES, resolveSize } from './data/sizes.js';
import { interactiveMode } from './cli/interactive.js';
import { interactiveStorage } from './cli/interactive-storage.js';
import { interactiveDatabase } from './cli/interactive-database.js';
import { interactiveK8s } from './cli/interactive-k8s.js';
import { interactiveNetwork } from './cli/interactive-network.js';
import { interactiveTco } from './cli/interactive-tco.js';
import { runEstimate } from './cli/estimate.js';
import { runCompare, parseProfile } from './cli/compare.js';
import { runRegions } from './cli/regions.js';
import { cachePath, clearCache } from './core/cache.js';
import { storageCompare } from './services/storage/compare.js';
import { storageEstimate } from './services/storage/estimate.js';
import { k8sCompare } from './services/kubernetes/compare.js';
import { k8sEstimate } from './services/kubernetes/estimate.js';
import { runDatabaseEstimate } from './services/database/estimate.js';
import { runDatabaseCompare } from './services/database/compare.js';
import { runNetworkEstimate } from './services/network/estimate.js';
import { runNetworkCompare } from './services/network/compare.js';
import { runTco } from './services/tco/estimate.js';
import type { ServiceEstimateOptions } from './core/types.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

const program = new Command();

program
  .name('saudi-cloud-costs')
  .description('Estimate and compare cloud costs for Saudi Arabia regions — in SAR, with 15% Saudi VAT.')
  .version(pkg.version);

function parseHours(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError('Must be a positive number');
  return n;
}

function parseNonNegative(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new InvalidArgumentError('Must be a non-negative number');
  return n;
}

function parsePositive(v: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new InvalidArgumentError('Must be a positive number');
  return n;
}

function parseCurrency(v: string): Currency {
  if (v !== 'SAR' && v !== 'USD') throw new InvalidArgumentError('Must be SAR or USD');
  return v;
}

function parseProvider(v: string): ProviderId {
  if (!(v in providers)) {
    throw new InvalidArgumentError(`Must be one of: ${Object.keys(providers).join(', ')}`);
  }
  return v as ProviderId;
}

interface GlobalOpts {
  currency: Currency;
  hours?: number;
  vat: boolean;
  noCache: boolean;
  gcpKey?: string;
  gcpKeyFile?: string;
}

function baseOpts(opts: GlobalOpts): ServiceEstimateOptions {
  return {
    currency: opts.currency,
    hours: opts.hours ?? DEFAULT_HOURS,
    vat: opts.vat,
    noCache: opts.noCache,
    gcpKey: opts.gcpKeyFile ? readFileSync(opts.gcpKeyFile, 'utf8').trim() : opts.gcpKey,
  };
}

function resolveRegion(providerId: ProviderId, region: string | undefined): string {
  if (region) return region;
  return providers[providerId]!.regions[0]!.id;
}

type OutputFormat = 'table' | 'json' | 'csv';

function outputFormat(json: boolean | undefined, csv: boolean | undefined): OutputFormat {
  if (json && csv) throw new InvalidArgumentError('--json and --csv are mutually exclusive');
  if (json) return 'json';
  if (csv) return 'csv';
  return 'table';
}

/** Common flags shared by every pricing command — defined once, wired everywhere. */
function commonFlags(cmd: Command): Command {
  cmd.option('--currency <currency>', 'display currency', parseCurrency, 'SAR');
  cmd.option('--hours <hours>', 'hours per month (used for ALL hourly-billed services)', parseHours, DEFAULT_HOURS);
  cmd.option('--no-vat', 'exclude 15% Saudi VAT from totals');
  cmd.option('--no-cache', 'bypass the 24h price cache');
  cmd.option('--gcp-key <key>', 'Google Cloud API key (or set GOOGLE_CLOUD_API_KEY)');
  cmd.option('--gcp-key-file <path>', 'read the Google Cloud API key from a file');
  return cmd;
}

function outputFlags(cmd: Command, withCsv: boolean): Command {
  cmd.option('--json', 'output JSON instead of a table');
  if (withCsv) cmd.option('--csv', 'output CSV instead of a table');
  return cmd;
}

function wireComputeEstimate(cmd: Command): Command {
  cmd
    .option('-p, --provider <provider>', 'cloud provider (oci|aws|azure|gcp)', parseProvider)
    .option('-r, --region <region>', 'region id, e.g. me-riyadh-1')
    .option('-s, --size <size>', `size profile (${SIZE_PROFILES.join('|')})`, parseProfile as (v: string) => SizeProfile)
    .option('--instance <sku>', 'price a specific provider SKU (AWS/Azure/GCP) instead of a size profile')
    .option('--ocpus <n>', 'OCI flex shape OCPUs (OCI only, with --memory)', parsePositive)
    .option('--memory <gb>', 'OCI flex shape memory GB (OCI only, with --ocpus)', parseNonNegative);
  outputFlags(cmd, false);
  commonFlags(cmd);
  cmd.action(async (opts) => {
    const estOpts = baseOpts(opts);
    estOpts.hours = opts.hours;
    if (!opts.provider) {
      await interactiveMode(estOpts);
      return;
    }
    const providerId = opts.provider as ProviderId;
    const regionId = resolveRegion(providerId, opts.region);
    const size = resolveSize({
      providerId,
      profile: opts.size as SizeProfile | undefined,
      instance: opts.instance,
      ocpus: opts.ocpus,
      memory: opts.memory,
    });
    await runEstimate(estOpts, { providerId, regionId, size, json: Boolean(opts.json) });
  });
  return cmd;
}

function wireComputeCompare(cmd: Command): Command {
  cmd
    .option('-s, --size <size>', `size profile (${SIZE_PROFILES.join('|')})`, parseProfile, 'medium' as SizeProfile);
  outputFlags(cmd, true);
  commonFlags(cmd);
  cmd.action(async (opts) => {
    const estOpts = baseOpts(opts);
    estOpts.hours = opts.hours;
    await runCompare(estOpts, opts.size as SizeProfile, outputFormat(opts.json, opts.csv));
  });
  return cmd;
}

// ─── COMPUTE ───
const compute = program.command('compute').description('Compute / VM estimation');
wireComputeEstimate(compute.command('estimate').description('Estimate the monthly cost of a single instance (interactive when no options given)'));
wireComputeCompare(compute.command('compare').description('Compare all providers side-by-side for a size profile'));

// ─── STORAGE ───
const storage = program.command('storage').description('Storage cost estimation');

const storageEstimateCmd = storage
  .command('estimate')
  .description('Estimate storage costs for a provider (interactive when no provider given)')
  .option('-p, --provider <provider>', 'cloud provider', parseProvider)
  .option('-r, --region <region>', 'region id')
  .option('--object <gb>', 'object storage GB', parseNonNegative, 0)
  .option('--block <gb>', 'block storage GB', parseNonNegative, 0)
  .option('--file <gb>', 'file storage GB', parseNonNegative, 0);
outputFlags(storageEstimateCmd, false);
commonFlags(storageEstimateCmd);
storageEstimateCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  if (!opts.provider) {
    await interactiveStorage(estOpts);
    return;
  }
  const providerId = opts.provider as ProviderId;
  const region = resolveRegion(providerId, opts.region);
  const input = {
    region,
    objectGb: Number(opts.object) || 0,
    blockGb: Number(opts.block) || 0,
    fileGb: Number(opts.file) || 0,
  };
  const est = await storageEstimate(providerId, input, estOpts);
  if (opts.json) {
    console.log(JSON.stringify(est, null, 2));
    return;
  }
  const { renderServiceEstimate } = await import('./ui/tables.js');
  renderServiceEstimate(est, [
    ['Object', `${input.objectGb} GB`],
    ['Block', `${input.blockGb} GB`],
    ['File', `${input.fileGb} GB`],
  ]);
});

const storageCompareCmd = storage
  .command('compare')
  .description('Compare storage costs across all providers')
  .option('--object <gb>', 'object storage GB', parseNonNegative, 0)
  .option('--block <gb>', 'block storage GB', parseNonNegative, 0)
  .option('--file <gb>', 'file storage GB', parseNonNegative, 0);
outputFlags(storageCompareCmd, true);
commonFlags(storageCompareCmd);
storageCompareCmd.action(async (opts) => {
  await storageCompare(
    {
      region: '', // each provider resolves its own first region when empty
      objectGb: Number(opts.object) || 0,
      blockGb: Number(opts.block) || 0,
      fileGb: Number(opts.file) || 0,
    },
    baseOpts(opts),
    outputFormat(opts.json, opts.csv),
  );
});

// ─── DATABASE ───
const database = program.command('database').description('Database cost estimation');

const DB_ENGINES = ['postgresql', 'mysql', 'sqlserver', 'oracle'] as const;
const DB_TIERS = ['small', 'medium', 'large'] as const;

function parseEngine(v: string) {
  if (!DB_ENGINES.includes(v as (typeof DB_ENGINES)[number])) {
    throw new InvalidArgumentError(`Must be one of: ${DB_ENGINES.join(', ')}`);
  }
  return v as (typeof DB_ENGINES)[number];
}

function parseDbTier(v: string) {
  if (!DB_TIERS.includes(v as (typeof DB_TIERS)[number])) {
    throw new InvalidArgumentError(`Must be one of: ${DB_TIERS.join(', ')}`);
  }
  return v as (typeof DB_TIERS)[number];
}

const databaseEstimateCmd = database
  .command('estimate')
  .description('Estimate database costs (interactive when no provider given)')
  .option('-p, --provider <provider>', 'cloud provider', parseProvider)
  .option('-r, --region <region>', 'region id')
  .option('-e, --engine <engine>', `database engine (${DB_ENGINES.join('|')})`, parseEngine, 'postgresql')
  .option('-t, --tier <tier>', `tier (${DB_TIERS.join('|')})`, parseDbTier, 'medium')
  .option('--storage <gb>', 'storage GB', parseNonNegative, 100)
  .option('--ha', 'enable high availability');
outputFlags(databaseEstimateCmd, false);
commonFlags(databaseEstimateCmd);
databaseEstimateCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  if (!opts.provider) {
    await interactiveDatabase(estOpts);
    return;
  }
  const providerId = opts.provider as ProviderId;
  const region = resolveRegion(providerId, opts.region);
  await runDatabaseEstimate(estOpts, {
    providerId,
    input: {
      region,
      engine: opts.engine,
      tier: opts.tier,
      storageGb: Number(opts.storage) || 100,
      ha: Boolean(opts.ha),
    },
    json: Boolean(opts.json),
  });
});

const databaseCompareCmd = database
  .command('compare')
  .description('Compare database costs across all providers')
  .option('-e, --engine <engine>', `engine (${DB_ENGINES.join('|')})`, parseEngine, 'postgresql')
  .option('-t, --tier <tier>', `tier (${DB_TIERS.join('|')})`, parseDbTier, 'medium')
  .option('--storage <gb>', 'storage GB', parseNonNegative, 100)
  .option('--ha', 'enable HA');
outputFlags(databaseCompareCmd, true);
commonFlags(databaseCompareCmd);
databaseCompareCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  await runDatabaseCompare(
    estOpts,
    {
      region: '', // each provider resolves its own first region when empty
      engine: opts.engine,
      tier: opts.tier,
      storageGb: Number(opts.storage) || 100,
      ha: Boolean(opts.ha),
    },
    outputFormat(opts.json, opts.csv),
  );
});

// ─── KUBERNETES ───
const k8s = program.command('k8s').description('Kubernetes cost estimation');

const k8sEstimateCmd = k8s
  .command('estimate')
  .description('Estimate Kubernetes costs for one provider (interactive when no provider given)')
  .option('-p, --provider <provider>', 'cloud provider', parseProvider)
  .option('-r, --region <region>', 'region id')
  .option('--nodes <n>', 'node count', parseNonNegative, 3)
  .option('--node-size <size>', `node size (${SIZE_PROFILES.join('|')})`, parseProfile, 'medium')
  .option('--control-plane', 'managed control plane', false);
outputFlags(k8sEstimateCmd, false);
commonFlags(k8sEstimateCmd);
k8sEstimateCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  if (!opts.provider) {
    await interactiveK8s(estOpts);
    return;
  }
  const providerId = opts.provider as ProviderId;
  const region = resolveRegion(providerId, opts.region);
  const est = await k8sEstimate(providerId, {
    region,
    nodeCount: Number(opts.nodes) || 0,
    nodeProfile: (opts.nodeSize as SizeProfile) || 'medium',
    controlPlane: Boolean(opts.controlPlane),
  }, estOpts);
  if (opts.json) {
    console.log(JSON.stringify(est, null, 2));
    return;
  }
  const { renderServiceEstimate } = await import('./ui/tables.js');
  renderServiceEstimate(est, [
    ['Nodes', `${opts.nodes} × ${opts.nodeSize}`],
    ['Control Plane', opts.controlPlane ? 'Yes' : 'No'],
  ]);
});

const k8sCompareCmd = k8s
  .command('compare')
  .description('Compare Kubernetes costs across all providers')
  .option('--nodes <n>', 'node count', parseNonNegative, 3)
  .option('--node-size <size>', `node size (${SIZE_PROFILES.join('|')})`, parseProfile, 'medium')
  .option('--control-plane', 'managed control plane');
outputFlags(k8sCompareCmd, true);
commonFlags(k8sCompareCmd);
k8sCompareCmd.action(async (opts) => {
  await k8sCompare(
    {
      region: '', // each provider resolves its own first region when empty
      nodeCount: Number(opts.nodes) || 3,
      nodeProfile: (opts.nodeSize as SizeProfile) || 'medium',
      controlPlane: Boolean(opts.controlPlane),
    },
    baseOpts(opts),
    outputFormat(opts.json, opts.csv),
  );
});

// ─── NETWORK ───
const network = program.command('network').description('Network cost estimation');

const networkEstimateCmd = network
  .command('estimate')
  .description('Estimate network costs (interactive when no provider given)')
  .option('-p, --provider <provider>', 'cloud provider', parseProvider)
  .option('-r, --region <region>', 'region id')
  .option('--egress <gb>', 'egress GB', parseNonNegative, 0)
  .option('--lb <n>', 'load balancer count', parseNonNegative, 0)
  .option('--nat', 'include NAT gateway');
outputFlags(networkEstimateCmd, false);
commonFlags(networkEstimateCmd);
networkEstimateCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  if (!opts.provider) {
    await interactiveNetwork(estOpts);
    return;
  }
  const providerId = opts.provider as ProviderId;
  const region = resolveRegion(providerId, opts.region);
  await runNetworkEstimate(estOpts, {
    providerId,
    regionId: region,
    input: {
      region,
      egressGb: Number(opts.egress) || 0,
      loadBalancers: Number(opts.lb) || 0,
      nat: Boolean(opts.nat),
    },
    json: Boolean(opts.json),
  });
});

const networkCompareCmd = network
  .command('compare')
  .description('Compare network costs across all providers')
  .option('--egress <gb>', 'egress GB', parseNonNegative, 0)
  .option('--lb <n>', 'load balancer count', parseNonNegative, 0)
  .option('--nat', 'include NAT');
outputFlags(networkCompareCmd, true);
commonFlags(networkCompareCmd);
networkCompareCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  const input = {
    region: '', // each provider resolves its own first region when empty
    egressGb: Number(opts.egress) || 0,
    loadBalancers: Number(opts.lb) || 0,
    nat: Boolean(opts.nat),
  };
  await runNetworkCompare(estOpts, input, outputFormat(opts.json, opts.csv));
});

// ─── TCO ───
const tcoCmd = program
  .command('tco')
  .description('Total cost of ownership: compute + storage + database (optional) + k8s (optional) + network')
  .option('-p, --provider <provider>', 'cloud provider', parseProvider)
  .option('-r, --region <region>', 'region id')
  .option('--compute-size <size>', `size profile (${SIZE_PROFILES.join('|')})`, parseProfile, 'medium')
  .option('--storage-object <gb>', 'object storage GB', parseNonNegative, 0)
  .option('--storage-block <gb>', 'block storage GB', parseNonNegative, 100)
  .option('--storage-file <gb>', 'file storage GB', parseNonNegative, 0)
  .option('--db-engine <engine>', `database engine (${[...DB_ENGINES, 'none'].join('|')})`, (v: string) => {
    if (v !== 'none' && !DB_ENGINES.includes(v as (typeof DB_ENGINES)[number])) {
      throw new InvalidArgumentError(`Must be one of: ${[...DB_ENGINES, 'none'].join(', ')}`);
    }
    return v;
  }, 'postgresql')
  .option('--db-tier <tier>', `db tier (${DB_TIERS.join('|')})`, parseDbTier, 'medium')
  .option('--db-storage <gb>', 'db storage GB', parseNonNegative, 100)
  .option('--db-ha', 'db high availability')
  .option('--k8s-nodes <n>', 'k8s node count (0 = none)', parseNonNegative, 0)
  .option('--k8s-node-size <size>', `k8s node size (${SIZE_PROFILES.join('|')})`, parseProfile, 'medium')
  .option('--k8s-control-plane', 'managed k8s control plane')
  .option('--network-egress <gb>', 'network egress GB', parseNonNegative, 100)
  .option('--network-lb <n>', 'load balancer count', parseNonNegative, 1)
  .option('--network-nat', 'include NAT gateway')
  .option('--json', 'output JSON');
commonFlags(tcoCmd);
tcoCmd.action(async (opts) => {
  const estOpts = baseOpts(opts);
  if (!opts.provider) {
    await interactiveTco(estOpts);
    return;
  }
  const providerId = opts.provider as ProviderId;
  const region = resolveRegion(providerId, opts.region);
  const result = await runTco(
    {
      providerId,
      region,
      computeProfile: (opts.computeSize as SizeProfile) || 'medium',
      hours: Number(opts.hours) || DEFAULT_HOURS,
      storage: {
        region,
        objectGb: opts.storageObject ?? 0,
        blockGb: opts.storageBlock ?? 100,
        fileGb: opts.storageFile ?? 0,
      },
      dbEngine: (opts.dbEngine as 'postgresql' | 'mysql' | 'sqlserver' | 'oracle' | 'none') || 'postgresql',
      dbTier: opts.dbTier,
      dbStorageGb: opts.dbStorage ?? 100,
      dbHa: Boolean(opts.dbHa),
      k8sNodes: opts.k8sNodes ?? 0,
      k8sNodeProfile: (opts.k8sNodeSize as SizeProfile) || 'medium',
      k8sControlPlane: Boolean(opts.k8sControlPlane),
      networkEgressGb: opts.networkEgress ?? 100,
      networkLoadBalancers: opts.networkLb ?? 1,
      networkNat: Boolean(opts.networkNat),
    },
    estOpts,
  );
  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const sym = result.currency === 'SAR' ? 'SAR ' : '$';
  const vatNote = result.totalMonthlyVat !== result.totalMonthly ? ' (incl. 15% VAT*)' : ' (excl. VAT)';
  console.log(`\n${pc.bold(result.providerName)} — ${pc.cyan(result.regionName)}`);
  console.log(`  ${pc.bold('Total Monthly:')} ${sym}${result.totalMonthlyVat.toFixed(2)}${pc.dim(vatNote)}`);
  console.log(`  Compute:      ${sym}${result.services.compute.monthlyVat.toFixed(2)}`);
  console.log(`  Storage:      ${sym}${result.services.storage.monthlyVat.toFixed(2)}`);
  if (result.services.database.monthly > 0 || result.services.database.monthlyVat > 0) {
    console.log(`  Database:     ${sym}${result.services.database.monthlyVat.toFixed(2)}`);
  }
  if (result.services.kubernetes.monthly > 0 || result.services.kubernetes.monthlyVat > 0) {
    console.log(`  Kubernetes:   ${sym}${result.services.kubernetes.monthlyVat.toFixed(2)}`);
  }
  console.log(`  Network:      ${sym}${result.services.network.monthlyVat.toFixed(2)}`);
  for (const w of result.warnings) console.log(pc.yellow(`  Note: ${w}`));
  if (result.warnings.length > 0) console.log('');
});

// ─── BACKWARD COMPATIBLE TOP-LEVEL ALIASES ───
wireComputeEstimate(
  program
    .command('estimate')
    .description('Alias for "compute estimate"'),
);
wireComputeCompare(
  program
    .command('compare')
    .description('Alias for "compute compare"'),
);

// ─── REGIONS & CACHE ───
const regionsCmd = program
  .command('regions')
  .description('List supported regions and their KSA availability notes')
  .option('--json', 'output JSON');
regionsCmd.action((opts) => {
  runRegions(Boolean(opts.json));
});

const cache = program.command('cache').description('cache utilities');

cache
  .command('info')
  .description('show cache location')
  .action(() => {
    console.log(`Price cache directory: ${cachePath()}`);
  });

cache
  .command('clear')
  .description('delete all cached prices')
  .action(() => {
    const removed = clearCache();
    console.log(removed > 0 ? `Removed ${removed} cache file(s) from ${cachePath()}` : 'Cache is already empty.');
  });

program.parseAsync().catch((err: unknown) => {
  console.error(pc.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
  process.exitCode = 1;
});

import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ServiceEstimateOptions, ProviderId } from '../core/types.js';
import { providers } from '../providers/index.js';
import { databaseEstimate } from '../services/database/estimate.js';
import type { DatabaseInput } from '../services/database/types.js';
import { renderServiceEstimate } from '../ui/tables.js';

function unpack<T>(value: T): asserts value is Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(1);
  }
}

const DB_ENGINES = [
  { value: 'postgresql' as const, label: 'PostgreSQL' },
  { value: 'mysql' as const, label: 'MySQL' },
  { value: 'sqlserver' as const, label: 'SQL Server' },
  { value: 'oracle' as const, label: 'Oracle' },
];

const DB_TIERS = [
  { value: 'small' as const, label: 'Small (2 vCPU / 8 GB)' },
  { value: 'medium' as const, label: 'Medium (4 vCPU / 16 GB)' },
  { value: 'large' as const, label: 'Large (8 vCPU / 32 GB)' },
];

export async function interactiveDatabase(opts: ServiceEstimateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Database Cost Estimator ')));

  const providerIdRaw = await p.select({
    message: 'Which cloud provider?',
    options: Object.values(providers).map((prov) => ({
      value: prov.id,
      label: prov.name,
      hint: prov.regions.map((r) => r.name).join(', '),
    })),
  });
  unpack(providerIdRaw);
  const providerId = providerIdRaw as ProviderId;

  const provider = providers[providerId]!;
  const regionIdRaw = await p.select({
    message: 'Which region?',
    options: provider.regions.map((r) => ({
      value: r.id,
      label: r.name,
      hint: r.note,
    })),
  });
  unpack(regionIdRaw);
  const regionId = regionIdRaw as string;

  const engineRaw = await p.select({
    message: 'Which database engine?',
    options: DB_ENGINES,
  });
  unpack(engineRaw);

  const tierRaw = await p.select({
    message: 'Which tier?',
    options: DB_TIERS,
  });
  unpack(tierRaw);

  const storageGbRaw = await p.text({
    message: 'Storage GB?',
    placeholder: '100',
    defaultValue: '100',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number';
    },
  });
  unpack(storageGbRaw);

  const haRaw = await p.confirm({
    message: 'Enable high availability?',
    initialValue: false,
  });
  unpack(haRaw);

  const s = p.spinner();
  s.start('Fetching database pricing');
  try {
    const input: DatabaseInput = {
      region: regionId,
      engine: engineRaw as DatabaseInput['engine'],
      tier: tierRaw as DatabaseInput['tier'],
      storageGb: Number(storageGbRaw) || 100,
      ha: Boolean(haRaw),
    };
    const result = await databaseEstimate(providerId, input, opts);
    s.stop('Done');
    renderServiceEstimate(result, [
      ['Engine', input.engine],
      ['Tier', input.tier],
      ['Storage', `${input.storageGb} GB`],
      ['HA', input.ha ? 'Yes' : 'No'],
    ]);
  } catch (err) {
    s.stop(pc.red('Failed'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  p.outro('Prices are indicative on-demand rates. Actual pricing may vary.');
}

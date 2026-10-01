import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ServiceEstimateOptions, ProviderId } from '../core/types.js';
import { providers } from '../providers/index.js';
import { runTco } from '../services/tco/estimate.js';
import type { TcoInput } from '../services/tco/types.js';
import { SIZE_PROFILES, DEFAULT_HOURS } from '../data/sizes.js';

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
  { value: 'none' as const, label: 'No database' },
];

const DB_TIERS = [
  { value: 'small' as const, label: 'Small' },
  { value: 'medium' as const, label: 'Medium' },
  { value: 'large' as const, label: 'Large' },
];

const nonNegative = (v: string | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative number';
  return undefined;
};

export async function interactiveTco(opts: ServiceEstimateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Total Cost of Ownership Estimator ')));

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

  const computeProfileRaw = await p.select({
    message: 'Compute instance size?',
    options: SIZE_PROFILES.map((s) => ({ value: s, label: s })),
  });
  unpack(computeProfileRaw);

  const hoursRaw = await p.text({
    message: 'Hours per month?',
    placeholder: String(DEFAULT_HOURS),
    defaultValue: String(DEFAULT_HOURS),
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number';
      return undefined;
    },
  });
  unpack(hoursRaw);

  const storageBlockRaw = await p.text({
    message: 'Block storage GB?',
    placeholder: '100',
    defaultValue: '100',
    validate: nonNegative,
  });
  unpack(storageBlockRaw);

  const storageObjectRaw = await p.text({
    message: 'Object storage GB?',
    placeholder: '0',
    defaultValue: '0',
    validate: nonNegative,
  });
  unpack(storageObjectRaw);

  const dbEngineRaw = await p.select({
    message: 'Database engine?',
    options: DB_ENGINES,
  });
  unpack(dbEngineRaw);

  let dbTier: TcoInput['dbTier'] = 'medium';
  let dbStorageGb = 100;
  let dbHa = false;
  if (dbEngineRaw !== 'none') {
    const dbTierRaw = await p.select({ message: 'Database tier?', options: DB_TIERS });
    unpack(dbTierRaw);
    dbTier = dbTierRaw as TcoInput['dbTier'];

    const dbStorageRaw = await p.text({
      message: 'Database storage GB?',
      placeholder: '100',
      defaultValue: '100',
      validate: (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number';
        return undefined;
      },
    });
    unpack(dbStorageRaw);
    dbStorageGb = Number(dbStorageRaw) || 100;

    const dbHaRaw = await p.confirm({ message: 'Database high availability?', initialValue: false });
    unpack(dbHaRaw);
    dbHa = Boolean(dbHaRaw);
  }

  const k8sNodesRaw = await p.text({
    message: 'Kubernetes worker nodes (0 for none)?',
    placeholder: '0',
    defaultValue: '0',
    validate: nonNegative,
  });
  unpack(k8sNodesRaw);

  let k8sControlPlane = false;
  if (Number(k8sNodesRaw) > 0) {
    const k8sControlPlaneRaw = await p.confirm({ message: 'Managed Kubernetes control plane?', initialValue: false });
    unpack(k8sControlPlaneRaw);
    k8sControlPlane = Boolean(k8sControlPlaneRaw);
  }

  const networkEgressRaw = await p.text({
    message: 'Network egress GB/month?',
    placeholder: '100',
    defaultValue: '100',
    validate: nonNegative,
  });
  unpack(networkEgressRaw);

  const networkLbRaw = await p.text({
    message: 'Load balancer count?',
    placeholder: '1',
    defaultValue: '1',
    validate: nonNegative,
  });
  unpack(networkLbRaw);

  const networkNatRaw = await p.confirm({ message: 'NAT gateway?', initialValue: false });
  unpack(networkNatRaw);

  const s = p.spinner();
  s.start('Calculating total cost of ownership');
  try {
    const input: TcoInput = {
      providerId,
      region: regionId,
      computeProfile: computeProfileRaw as TcoInput['computeProfile'],
      hours: Number(hoursRaw) || DEFAULT_HOURS,
      storage: {
        region: regionId,
        objectGb: Number(storageObjectRaw) || 0,
        blockGb: Number(storageBlockRaw) || 100,
        fileGb: 0,
      },
      dbEngine: dbEngineRaw as TcoInput['dbEngine'],
      dbTier,
      dbStorageGb,
      dbHa,
      k8sNodes: Number(k8sNodesRaw) || 0,
      k8sNodeProfile: 'medium',
      k8sControlPlane,
      networkEgressGb: Number(networkEgressRaw) || 100,
      networkLoadBalancers: Number(networkLbRaw) || 1,
      networkNat: Boolean(networkNatRaw),
    };
    const result = await runTco(input, { ...opts, hours: input.hours });
    s.stop('Done');

    const sym = result.currency === 'SAR' ? 'SAR ' : '$';
    const vatNote =
      result.totalMonthlyVat !== result.totalMonthly
        ? pc.dim(' (incl. 15% VAT*)')
        : pc.dim(' (excl. VAT)');
    console.log(`\n  ${pc.bold(result.providerName)} — ${pc.cyan(result.regionName)}`);
    console.log(`  ${pc.bold('Total Monthly:')} ${sym}${result.totalMonthlyVat.toFixed(2)}${vatNote}`);
    console.log(`    Compute:      ${sym}${result.services.compute.monthlyVat.toFixed(2)}`);
    console.log(`    Storage:      ${sym}${result.services.storage.monthlyVat.toFixed(2)}`);
    if (result.services.database.monthly > 0 || result.services.database.monthlyVat > 0) {
      console.log(`    Database:     ${sym}${result.services.database.monthlyVat.toFixed(2)}`);
    }
    if (result.services.kubernetes.monthly > 0 || result.services.kubernetes.monthlyVat > 0) {
      console.log(`    Kubernetes:   ${sym}${result.services.kubernetes.monthlyVat.toFixed(2)}`);
    }
    console.log(`    Network:      ${sym}${result.services.network.monthlyVat.toFixed(2)}`);
    for (const w of result.warnings) console.log(pc.yellow(`  Note: ${w}`));
    console.log('');
  } catch (err) {
    s.stop(pc.red('Failed'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  p.outro('Prices are indicative on-demand rates. Actual pricing may vary.');
}

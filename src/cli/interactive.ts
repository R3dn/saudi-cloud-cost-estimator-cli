import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { EstimateOptions, ProviderId, SizeProfile } from '../core/types.js';
import { providers } from '../providers/index.js';
import { SIZE_PROFILES, SKU_MAP } from '../data/sizes.js';
import { runEstimate } from './estimate.js';

function unpack<T>(value: T): asserts value is Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(1);
  }
}

export async function interactiveMode(opts: EstimateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Saudi Cloud Cost Estimator ')));

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

  const profileRaw = await p.select({
    message: 'What instance size?',
    options: SIZE_PROFILES.map((s) => ({
      value: s,
      label: `${s} (${SKU_MAP[providerId]![s]!.vcpu} vCPU / ${SKU_MAP[providerId]![s]!.gb} GB)`,
    })),
  });
  unpack(profileRaw);
  const profile = profileRaw as SizeProfile;

  const hoursAnswer = await p.text({
    message: 'Hours per month?',
    placeholder: '730',
    defaultValue: '730',
    validate: (v) => {
      if (!v) return;
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number';
    },
  });
  unpack(hoursAnswer);

  const s = p.spinner();
  s.start('Fetching live pricing');
  try {
    const hours = Number(hoursAnswer) || 730;
    await runEstimate(
      { ...opts, hours },
      { providerId, regionId, size: SKU_MAP[providerId]![profile]!, interactive: true },
    );
    s.stop('Done');
  } catch (err) {
    s.stop(pc.red('Failed'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  p.outro('Prices are indicative on-demand Linux rates. Disk, network and OS licenses not included.');
}

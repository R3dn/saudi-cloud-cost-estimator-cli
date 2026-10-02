import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { EstimateOptions, ProviderId, SizeProfile } from '../core/types.js';
import { providers } from '../providers/index.js';
import { SIZE_PROFILES, SKU_MAP, PROFILE_SPECS } from '../data/sizes.js';
import { runEstimate } from './estimate.js';

function unpack<T>(value: T): asserts value is Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(1);
  }
}

const PROFILE_GROUPS: { title: string; profiles: SizeProfile[] }[] = [
  { title: 'General purpose', profiles: ['small', 'medium', 'large', 'xlarge', '2xlarge', '3xlarge'] },
  { title: 'Memory optimized', profiles: ['mem-medium', 'mem-large', 'mem-xlarge', 'mem-2xlarge'] },
  { title: 'Compute optimized', profiles: ['cpu-medium', 'cpu-large', 'cpu-xlarge', 'cpu-2xlarge'] },
  { title: 'GPU', profiles: ['gpu-medium', 'gpu-large'] },
];

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

  const profileOptions: { value: SizeProfile; label: string; hint?: string }[] = [];
  for (const group of PROFILE_GROUPS) {
    for (const s of group.profiles) {
      if (!SIZE_PROFILES.includes(s)) continue;
      const spec = PROFILE_SPECS[s]!;
      profileOptions.push({
        value: s,
        label: `${s} (${spec.vcpu} vCPU / ${spec.gb} GB${s.startsWith('gpu-') ? ', GPU' : ''})`,
        hint: group.title,
      });
    }
  }
  const profileRaw = await p.select({
    message: 'What instance size?',
    options: profileOptions,
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

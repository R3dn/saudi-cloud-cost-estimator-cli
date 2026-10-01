import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ServiceEstimateOptions, ProviderId } from '../core/types.js';
import { providers } from '../providers/index.js';
import { networkEstimate } from '../services/network/estimate.js';
import type { NetworkInput } from '../services/network/types.js';
import { renderServiceEstimate } from '../ui/tables.js';

function unpack<T>(value: T): asserts value is Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(1);
  }
}

export async function interactiveNetwork(opts: ServiceEstimateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Network Cost Estimator ')));

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

  const egressGbRaw = await p.text({
    message: 'Egress data transfer (GB/month)?',
    placeholder: '0',
    defaultValue: '0',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative number';
    },
  });
  unpack(egressGbRaw);

  const lbCountRaw = await p.text({
    message: 'Number of load balancers?',
    placeholder: '0',
    defaultValue: '0',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative number';
    },
  });
  unpack(lbCountRaw);

  const natRaw = await p.confirm({
    message: 'Include NAT gateway?',
    initialValue: false,
  });
  unpack(natRaw);

  const s = p.spinner();
  s.start('Fetching network pricing');
  try {
    const input: NetworkInput = {
      region: regionId,
      egressGb: Number(egressGbRaw) || 0,
      loadBalancers: Number(lbCountRaw) || 0,
      nat: Boolean(natRaw),
    };
    const result = await networkEstimate(providerId, input, opts);
    s.stop('Done');
    renderServiceEstimate(result, [
      ['Egress', `${input.egressGb} GB`],
      ['Load Balancers', String(input.loadBalancers)],
      ['NAT Gateway', input.nat ? 'Yes' : 'No'],
    ]);
  } catch (err) {
    s.stop(pc.red('Failed'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  p.outro('Prices are indicative on-demand rates. Actual pricing may vary.');
}

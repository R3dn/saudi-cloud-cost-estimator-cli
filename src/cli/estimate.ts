import pc from 'picocolors';
import type { EstimateOptions, ProviderId, SizeSpec } from '../core/types.js';
import { providers } from '../providers/index.js';
import { getSarPerUsd } from '../core/fx.js';
import { normalizeQuote } from '../core/pricing.js';
import { renderEstimate } from '../ui/tables.js';

export interface EstimateArgs {
  providerId: ProviderId;
  regionId: string;
  size: SizeSpec;
  interactive?: boolean;
  json?: boolean;
}

export async function runEstimate(opts: EstimateOptions, args: EstimateArgs): Promise<void> {
  const provider = providers[args.providerId]!;
  const region = provider.regions.find((r) => r.id === args.regionId);
  if (!region) {
    const ids = provider.regions.map((r) => r.id).join(', ');
    throw new Error(`Unknown ${provider.name} region "${args.regionId}". Supported: ${ids}`);
  }

  const fx = await getSarPerUsd(opts.noCache);
  const quote = await provider.getHourlyPrice(args.regionId, args.size, opts);
  const result = normalizeQuote(
    {
      quote,
      providerName: provider.name,
      regionName: region.name,
      currency: opts.currency,
      hours: opts.hours,
      sarPerUsd: fx.sarPerUsd,
    },
    opts.vat,
  );

  if ('json' in args && args.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderEstimate(result);
    if (region.note && !args.interactive) console.log(pc.dim(`  Note: ${region.note}\n`));
  }
}


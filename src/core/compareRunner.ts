import type { ProviderId, ServiceEstimate, ServiceEstimateOptions } from './types.js';
import type { CompareRowInput } from './envelope.js';
import { providers } from '../providers/index.js';

/**
 * Runs an estimator for every provider concurrently, capturing per-provider
 * failures as row errors (a provider outage never aborts the comparison).
 * Each provider resolves its own region when the input region is empty.
 */
export async function runAcrossProviders<TInput extends { region: string }>(
  input: TInput,
  opts: ServiceEstimateOptions,
  estimate: (providerId: ProviderId, input: TInput, opts: ServiceEstimateOptions) => Promise<ServiceEstimate>,
): Promise<{ id: ProviderId; est: ServiceEstimate | null; error: string | null; region: string }[]> {
  const entries = await Promise.all(
    (Object.keys(providers) as ProviderId[]).map(async (id) => {
      const provider = providers[id]!;
      const region = input.region || provider.regions[0]!.id;
      try {
        const est = await estimate(id, { ...input, region }, opts);
        return { id, est, error: null as string | null, region };
      } catch (err) {
        return { id, est: null, error: err instanceof Error ? err.message : String(err), region };
      }
    }),
  );
  return entries;
}

export function toCompareRows(
  entries: { id: ProviderId; est: ServiceEstimate | null; error: string | null; region: string }[],
  opts: ServiceEstimateOptions,
): CompareRowInput[] {
  return entries.map((e) => {
    const provider = providers[e.id]!;
    if (e.error || !e.est) {
      return {
        provider: e.id,
        providerName: provider.name,
        region: e.region,
        regionName: provider.regions[0]!.name,
        monthly: null,
        monthlyVat: null,
        currency: opts.currency,
        components: null,
        warnings: [],
        error: e.error ?? 'unknown error',
      };
    }
    const est = e.est;
    return {
      provider: e.id,
      providerName: est.providerName,
      region: est.region,
      regionName: est.regionName,
      monthly: est.monthly,
      monthlyVat: est.monthlyVat,
      currency: est.currency,
      components: est.components,
      warnings: est.warnings,
      error: null,
    };
  });
}

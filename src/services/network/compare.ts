import pc from 'picocolors';
import type { ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { providers } from '../../providers/index.js';
import type { NetworkInput } from './types.js';
import { networkEstimate } from './estimate.js';
import { renderEstimateList } from '../../ui/tables.js';

export async function runNetworkCompare(
  opts: ServiceEstimateOptions,
  input: NetworkInput,
  json: boolean,
): Promise<void> {
  const entries = await Promise.all(
    (Object.keys(providers) as ProviderId[]).map(async (id) => {
      const provider = providers[id]!;
      const region = input.region || provider.regions[0]!.id;
      try {
        const est = await networkEstimate(id, { ...input, region }, opts);
        return { id, est, error: null as string | null };
      } catch (err) {
        return { id, est: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  if (json) {
    console.log(
      JSON.stringify(
        {
          input: { ...input, region: input.region || undefined },
          currency: opts.currency,
          vat: opts.vat,
          hours: opts.hours,
          rows: entries.map((e) => {
            const provider = providers[e.id]!;
            if (e.error || !e.est) {
              return {
                provider: e.id,
                providerName: provider.name,
                region: input.region || provider.regions[0]!.id,
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
              components: Object.fromEntries(
                Object.entries(est.components).map(([k, c]) => [k, { monthly: c.monthly, source: c.source, skuRef: c.skuRef }]),
              ),
              warnings: est.warnings,
              error: null,
            };
          }),
        },
        null,
        2,
      ),
    );
    return;
  }

  const spec = `${input.egressGb} GB egress, ${input.loadBalancers} LB(s), NAT: ${input.nat ? 'Yes' : 'No'}`;
  console.log(`\n${pc.bold('Network cost comparison')} — ${pc.cyan(spec)}`);
  renderEstimateList(
    entries.map((e) => {
      const provider = providers[e.id]!;
      if (e.error || !e.est) {
        return {
          providerName: provider.name,
          regionName: provider.regions[0]!.name,
          monthly: 0,
          monthlyVat: 0,
          currency: opts.currency,
          warnings: [],
          error: e.error ?? 'unknown error',
        };
      }
      const est = e.est;
      return {
        providerName: est.providerName,
        regionName: est.regionName,
        monthly: est.monthly,
        monthlyVat: est.monthlyVat,
        currency: est.currency,
        warnings: est.warnings,
        error: undefined,
      };
    }),
    opts,
  );
}

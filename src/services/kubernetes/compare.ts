import pc from 'picocolors';
import type { ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { providers } from '../../providers/index.js';
import { k8sEstimate } from './estimate.js';
import type { K8sInput } from './types.js';
import { renderEstimateList } from '../../ui/tables.js';

export async function k8sCompare(input: K8sInput, opts: ServiceEstimateOptions, json: boolean): Promise<void> {
  const entries = await Promise.all(
    (Object.keys(providers) as ProviderId[]).map(async (id) => {
      const provider = providers[id]!;
      const region = input.region || provider.regions[0]!.id;
      try {
        const est = await k8sEstimate(id, { ...input, region }, opts);
        return { id, est, error: null as string | null };
      } catch (err) {
        return { id, est: null, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const label = input.controlPlane
    ? `Managed control plane + ${input.nodeCount} × ${input.nodeProfile} node(s)`
    : `Self-hosted (nodes only) — ${input.nodeCount} × ${input.nodeProfile} node(s)`;

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
            if (e.error) {
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
                error: e.error,
              };
            }
            const est = e.est!;
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

  console.log(`\n${pc.bold('Kubernetes cost comparison')} — ${pc.cyan(label)}`);
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

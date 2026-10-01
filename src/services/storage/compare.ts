import pc from 'picocolors';
import type { ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { providers } from '../../providers/index.js';
import { storageEstimate } from './estimate.js';
import type { StorageInput } from './types.js';
import { renderEstimateList } from '../../ui/tables.js';

export interface CompareJsonRow {
  provider: ProviderId;
  providerName: string;
  region: string;
  regionName: string;
  monthly: number | null;
  monthlyVat: number | null;
  currency: ServiceEstimateOptions['currency'];
  components: Record<string, { monthly: number; source: string; skuRef?: string }> | null;
  warnings: string[];
  error: string | null;
}

export async function storageCompare(input: StorageInput, opts: ServiceEstimateOptions, json: boolean): Promise<void> {
  const entries = await Promise.all(
    (Object.keys(providers) as ProviderId[]).map(async (id): Promise<CompareJsonRow> => {
      const provider = providers[id]!;
      const region = input.region || provider.regions[0]!.id;
      try {
        const est = await storageEstimate(id, { ...input, region }, opts);
        return {
          provider: id,
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
      } catch (err) {
        return {
          provider: id,
          providerName: provider.name,
          region,
          regionName: provider.regions[0]!.name,
          monthly: null,
          monthlyVat: null,
          currency: opts.currency,
          components: null,
          warnings: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  if (json) {
    console.log(
      JSON.stringify(
        {
          input,
          currency: opts.currency,
          vat: opts.vat,
          hours: opts.hours,
          rows: entries,
        },
        null,
        2,
      ),
    );
    return;
  }

  const spec = `${input.objectGb} GB object, ${input.blockGb} GB block, ${input.fileGb} GB file`;
  console.log(`\n${pc.bold('Storage cost comparison')} — ${pc.cyan(spec)}`);
  renderEstimateList(
    entries.map((r) => ({
      providerName: r.providerName,
      regionName: r.regionName,
      monthly: r.monthly ?? 0,
      monthlyVat: r.monthlyVat ?? 0,
      currency: r.currency,
      warnings: r.warnings,
      error: r.error ?? undefined,
    })),
    opts,
  );
}

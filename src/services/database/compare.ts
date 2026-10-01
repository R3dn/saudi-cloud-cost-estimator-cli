import pc from 'picocolors';
import type { ProviderId, ServiceEstimateOptions } from '../../core/types.js';
import { providers } from '../../providers/index.js';
import { databaseEstimate } from './estimate.js';
import type { DatabaseInput } from './types.js';

export async function runDatabaseCompare(opts: ServiceEstimateOptions, input: DatabaseInput, json?: boolean): Promise<void> {
  const results = await Promise.all(
    (Object.keys(providers) as ProviderId[]).map(async (id) => {
      const provider = providers[id]!;
      const region = input.region || provider.regions[0]!.id;
      try {
        const result = await databaseEstimate(id, { ...input, region }, opts);
        return { id, name: provider.name, result, error: undefined as string | undefined };
      } catch (err) {
        return { id, name: provider.name, result: undefined, error: err instanceof Error ? err.message : String(err) };
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
          rows: results.map((r) => ({
            provider: r.id,
            providerName: r.name,
            region: input.region || providers[r.id]!.regions[0]!.id,
            regionName: r.result?.regionName ?? providers[r.id]!.regions[0]!.name,
            monthly: r.error ? null : r.result!.monthly,
            monthlyVat: r.error ? null : r.result!.monthlyVat,
            components: r.error
              ? null
              : Object.fromEntries(
                  Object.entries(r.result!.components).map(([k, c]) => [k, { monthly: c.monthly, source: c.source, skuRef: c.skuRef }]),
                ),
            warnings: r.error ? [] : r.result!.warnings,
            error: r.error ?? null,
          })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `\n${pc.bold('Database cost comparison')} — ${pc.cyan(`${input.engine} ${input.tier}, ${input.storageGb} GB, HA=${input.ha}`)}`,
  );
  console.log(`${pc.dim(`Hours/month: ${opts.hours}  Currency: ${opts.currency}  VAT: ${opts.vat ? '15% (assumed)' : 'none'}`)}\n`);

  for (const r of results) {
    if (r.error) {
      console.log(`${pc.red(r.name)}: ${pc.dim(r.error)}`);
      continue;
    }
    const result = r.result!;
    console.log(
      `${pc.green(r.name)} — ${result.regionName}\n` +
        `  Monthly: ${pc.bold(`${result.monthlyVat.toFixed(2)} ${result.currency}`)}${opts.vat ? pc.dim(' (incl. 15% VAT, assumed)') : ''}\n` +
        `  Components: ${Object.entries(result.components)
          .map(([k, c]) => `${k}=${c.monthly.toFixed(2)}`)
          .join(', ')}\n` +
        `  Sources: ${Object.entries(result.components)
          .map(([k, c]) => `${k}=${c.source}`)
          .join(', ')}`,
    );
    for (const w of result.warnings) console.log(pc.yellow(`  Note: ${w}`));
    console.log();
  }
}

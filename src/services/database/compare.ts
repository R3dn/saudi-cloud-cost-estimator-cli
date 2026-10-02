import pc from 'picocolors';
import type { ServiceEstimateOptions } from '../../core/types.js';
import { compareEnvelope, type CompareRowInput } from '../../core/envelope.js';
import { runAcrossProviders, toCompareRows } from '../../core/compareRunner.js';
import type { DatabaseInput } from './types.js';
import { databaseEstimate } from './estimate.js';
import { renderCompareCsv } from '../../ui/csv.js';

export async function runDatabaseCompare(opts: ServiceEstimateOptions, input: DatabaseInput, format: 'table' | 'json' | 'csv' = 'table'): Promise<void> {
  const entries = await runAcrossProviders(input, opts, (id, i, o) => databaseEstimate(id, i, o));
  const rows: CompareRowInput[] = toCompareRows(entries, opts);

  if (format === 'json') {
    console.log(JSON.stringify(compareEnvelope({ ...input, region: input.region || undefined }, opts, rows), null, 2));
    return;
  }
  if (format === 'csv') {
    renderCompareCsv(rows, opts);
    return;
  }

  console.log(
    `\n${pc.bold('Database cost comparison')} â€” ${pc.cyan(`${input.engine} ${input.tier}, ${input.storageGb} GB, HA=${input.ha}`)}`,
  );
  console.log(`${pc.dim(`Hours/month: ${opts.hours}  Currency: ${opts.currency}  VAT: ${opts.vat ? '15% (assumed)' : 'none'}`)}\n`);

  for (const r of rows) {
    if (r.error) {
      console.log(`${pc.red(r.providerName)}: ${pc.dim(r.error)}`);
      continue;
    }
    console.log(
      `${pc.green(r.providerName)} â€” ${r.regionName}\n` +
        `  Monthly: ${pc.bold(`${(r.monthlyVat ?? 0).toFixed(2)} ${r.currency}`)}${opts.vat ? pc.dim(' (incl. 15% VAT, assumed)') : ''}\n` +
        `  Components: ${Object.entries(r.components ?? {})
          .map(([k, c]) => `${k}=${c.monthly.toFixed(2)}`)
          .join(', ')}\n` +
        `  Sources: ${Object.entries(r.components ?? {})
          .map(([k, c]) => `${k}=${c.source}`)
          .join(', ')}`,
    );
    for (const w of r.warnings) console.log(pc.yellow(`  Note: ${w}`));
    console.log();
  }
}

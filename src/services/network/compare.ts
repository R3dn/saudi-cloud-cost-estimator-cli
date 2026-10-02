import pc from 'picocolors';
import type { ServiceEstimateOptions } from '../../core/types.js';
import { compareEnvelope, type CompareRowInput } from '../../core/envelope.js';
import { runAcrossProviders, toCompareRows } from '../../core/compareRunner.js';
import type { NetworkInput } from './types.js';
import { networkEstimate } from './estimate.js';
import { renderEstimateList } from '../../ui/tables.js';
import { renderCompareCsv } from '../../ui/csv.js';

export async function runNetworkCompare(
  opts: ServiceEstimateOptions,
  input: NetworkInput,
  format: 'table' | 'json' | 'csv' = 'table',
): Promise<void> {
  const entries = await runAcrossProviders(input, opts, (id, i, o) => networkEstimate(id, i, o));
  const rows: CompareRowInput[] = toCompareRows(entries, opts);

  if (format === 'json') {
    console.log(JSON.stringify(compareEnvelope({ ...input, region: input.region || undefined }, opts, rows), null, 2));
    return;
  }
  if (format === 'csv') {
    renderCompareCsv(rows, opts);
    return;
  }

  const spec = `${input.egressGb} GB egress, ${input.loadBalancers} LB(s), NAT: ${input.nat ? 'Yes' : 'No'}`;
  console.log(`\n${pc.bold('Network cost comparison')} â€” ${pc.cyan(spec)}`);
  renderEstimateList(
    rows.map((r) => ({
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

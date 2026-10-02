import pc from 'picocolors';
import type { ServiceEstimateOptions } from '../../core/types.js';
import { compareEnvelope, type CompareRowInput } from '../../core/envelope.js';
import { runAcrossProviders, toCompareRows } from '../../core/compareRunner.js';
import type { K8sInput } from './types.js';
import { k8sEstimate } from './estimate.js';
import { renderEstimateList } from '../../ui/tables.js';
import { renderCompareCsv } from '../../ui/csv.js';

export async function k8sCompare(input: K8sInput, opts: ServiceEstimateOptions, format: 'table' | 'json' | 'csv' = 'table'): Promise<void> {
  const entries = await runAcrossProviders(input, opts, (id, i, o) => k8sEstimate(id, i, o));
  const rows: CompareRowInput[] = toCompareRows(entries, opts);

  const label = input.controlPlane
    ? `Managed control plane + ${input.nodeCount} Ã— ${input.nodeProfile} node(s)`
    : `Self-hosted (nodes only) â€” ${input.nodeCount} Ã— ${input.nodeProfile} node(s)`;

  if (format === 'json') {
    console.log(JSON.stringify(compareEnvelope({ ...input, region: input.region || undefined }, opts, rows), null, 2));
    return;
  }
  if (format === 'csv') {
    renderCompareCsv(rows, opts);
    return;
  }

  console.log(`\n${pc.bold('Kubernetes cost comparison')} â€” ${pc.cyan(label)}`);
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

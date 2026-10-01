import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ServiceEstimateOptions, ProviderId } from '../core/types.js';
import { providers } from '../providers/index.js';
import { k8sEstimate } from '../services/kubernetes/estimate.js';
import type { K8sInput } from '../services/kubernetes/types.js';
import { SIZE_PROFILES } from '../data/sizes.js';
import { renderServiceEstimate } from '../ui/tables.js';

function unpack<T>(value: T): asserts value is Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(1);
  }
}

const NODE_PROFILES = SIZE_PROFILES.map((s) => ({
  value: s,
  label: `${s}`,
}));

export async function interactiveK8s(opts: ServiceEstimateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Kubernetes Cost Estimator ')));

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

  const nodeCountRaw = await p.text({
    message: 'Number of worker nodes?',
    placeholder: '3',
    defaultValue: '3',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) return 'Enter a positive number';
    },
  });
  unpack(nodeCountRaw);

  const nodeProfileRaw = await p.select({
    message: 'Node size?',
    options: NODE_PROFILES,
  });
  unpack(nodeProfileRaw);

  const controlPlaneRaw = await p.confirm({
    message: 'Managed control plane?',
    initialValue: true,
  });
  unpack(controlPlaneRaw);

  const s = p.spinner();
  s.start('Fetching Kubernetes pricing');
  try {
    const input: K8sInput = {
      region: regionId,
      nodeCount: Number(nodeCountRaw) || 3,
      nodeProfile: nodeProfileRaw as K8sInput['nodeProfile'],
      controlPlane: Boolean(controlPlaneRaw),
    };
    const result = await k8sEstimate(providerId, input, opts);
    s.stop('Done');
    renderServiceEstimate(result, [
      ['Nodes', `${input.nodeCount} × ${input.nodeProfile}`],
      ['Control Plane', input.controlPlane ? 'Yes' : 'No'],
    ]);
  } catch (err) {
    s.stop(pc.red('Failed'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  p.outro('Prices are indicative on-demand rates. Actual pricing may vary.');
}

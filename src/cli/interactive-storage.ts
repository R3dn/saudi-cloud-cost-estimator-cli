import * as p from '@clack/prompts';
import pc from 'picocolors';
import type { ServiceEstimateOptions, ProviderId } from '../core/types.js';
import { providers } from '../providers/index.js';
import { storageEstimate } from '../services/storage/estimate.js';
import type { StorageInput } from '../services/storage/types.js';
import { renderServiceEstimate } from '../ui/tables.js';

function unpack<T>(value: T): asserts value is Exclude<T, symbol> {
  if (p.isCancel(value)) {
    p.cancel('Aborted.');
    process.exit(1);
  }
}

export async function interactiveStorage(opts: ServiceEstimateOptions): Promise<void> {
  p.intro(pc.bgCyan(pc.black(' Storage Cost Estimator ')));

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

  const objectGbRaw = await p.text({
    message: 'Object storage GB?',
    placeholder: '0',
    defaultValue: '0',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative number';
    },
  });
  unpack(objectGbRaw);

  const blockGbRaw = await p.text({
    message: 'Block storage GB?',
    placeholder: '100',
    defaultValue: '100',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative number';
    },
  });
  unpack(blockGbRaw);

  const fileGbRaw = await p.text({
    message: 'File storage GB?',
    placeholder: '0',
    defaultValue: '0',
    validate: (v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return 'Enter a non-negative number';
    },
  });
  unpack(fileGbRaw);

  const s = p.spinner();
  s.start('Fetching storage pricing');
  try {
    const input: StorageInput = {
      region: regionId,
      objectGb: Number(objectGbRaw) || 0,
      blockGb: Number(blockGbRaw) || 0,
      fileGb: Number(fileGbRaw) || 0,
    };
    const result = await storageEstimate(providerId, input, opts);
    s.stop('Done');
    renderServiceEstimate(result, [
      ['Object', `${input.objectGb} GB`],
      ['Block', `${input.blockGb} GB`],
      ['File', `${input.fileGb} GB`],
    ]);
  } catch (err) {
    s.stop(pc.red('Failed'));
    p.cancel(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
  p.outro('Prices are indicative on-demand rates. Actual pricing may vary by region and tier.');
}

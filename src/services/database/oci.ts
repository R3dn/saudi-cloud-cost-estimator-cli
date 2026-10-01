import type { Currency, ServiceEstimateOptions } from '../../core/types.js';
import type { DatabaseInput } from './types.js';
import {
  fetchOciPriceList,
  ociCurrency,
  ociPartProduct,
  OCI_PARTS,
  paygRate,
  paygTiers,
  tieredCost,
} from '../../providers/ociCatalog.js';

const TIER_OCPU: Record<string, number> = {
  small: 1,
  medium: 2,
  large: 4,
};

export async function estimateOciDatabase(
  input: DatabaseInput,
  opts: ServiceEstimateOptions,
): Promise<{
  computeMonthly: number;
  storageMonthly: number;
  haMonthly: number;
  iopsMonthly: number;
  listedCurrency: Currency;
  skuRefs: { compute: string; storage: string };
  warnings: string[];
}> {
  const currency = ociCurrency(opts.currency);
  const ocpus = TIER_OCPU[input.tier];
  if (!ocpus) throw new Error(`Unknown tier "${input.tier}"`);

  const products = await fetchOciPriceList(opts.noCache);
  const warnings: string[] = [];

  let computeHourly: number;
  let storageCost: number;
  let computePart: string;
  let storagePart: string;

  if (input.engine === 'oracle') {
    const ecpu = ociPartProduct(products, OCI_PARTS.exascaleDbOcpu);
    const storage = ociPartProduct(products, OCI_PARTS.exascaleDbStorage);
    computeHourly = ocpus * paygRate(ecpu, currency);
    computePart = OCI_PARTS.exascaleDbOcpu;
    storagePart = OCI_PARTS.exascaleDbStorage;
    const storageTiers = paygTiers(storage, currency);
    storageCost = tieredCost(storageTiers, input.storageGb);
  } else {
    const ocpu = ociPartProduct(products, OCI_PARTS.baseDbOcpu);
    const storage = ociPartProduct(products, OCI_PARTS.baseDbStorage);
    computeHourly = ocpus * paygRate(ocpu, currency);
    computePart = OCI_PARTS.baseDbOcpu;
    storagePart = OCI_PARTS.baseDbStorage;
    const storageTiers = paygTiers(storage, currency);
    storageCost = tieredCost(storageTiers, input.storageGb);
  }

  const haHourly = input.ha ? computeHourly : 0;
  warnings.push('HA modelled as a full standby replica at 100% of compute cost (assumption).');

  return {
    computeMonthly: computeHourly * opts.hours,
    storageMonthly: storageCost,
    haMonthly: haHourly * opts.hours,
    iopsMonthly: 0,
    listedCurrency: currency,
    skuRefs: { compute: computePart, storage: storagePart },
    warnings,
  };
}

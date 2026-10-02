import type { Currency, ServiceEstimateOptions } from '../../core/types.js';
import type { DatabaseInput } from './types.js';
import { fetchAzureItems } from '../../providers/azureCatalog.js';

const SERVICE_MAP: Record<string, string> = {
  postgresql: 'Azure Database for PostgreSQL',
  mysql: 'Azure Database for MySQL',
  sqlserver: 'SQL Database',
};

const TIER_SKU: Record<string, Record<string, string>> = {
  postgresql: { small: 'B1ms', medium: 'B2ms', large: 'D2ds_v4' },
  mysql: { small: 'B1ms', medium: 'B2ms', large: 'D2ds_v4' },
  sqlserver: { small: 'S0', medium: 'S2', large: 'P1' },
};

export async function estimateAzureDatabase(
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
  const serviceName = SERVICE_MAP[input.engine];
  const skuName = TIER_SKU[input.engine]?.[input.tier];
  if (!serviceName || !skuName) {
    throw new Error(`Azure does not support engine ${input.engine} or tier ${input.tier}`);
  }

  const filter = `serviceName eq '${serviceName}' and armRegionName eq '${input.region}' and priceType eq 'Consumption'`;
  const items = await fetchAzureItems(filter, opts.noCache);

  const computeItem = items.find(
    (i) => (i.skuName === skuName || i.skuName.endsWith(skuName)) && i.unitOfMeasure === '1 Hour',
  );
  if (!computeItem) throw new Error(`Azure ${skuName} not found in ${input.region} for ${serviceName}`);

  let storage: number | null = null;
  for (const i of items) {
    if (/storage|data stored/i.test(i.meterName) && /gb/i.test(i.unitOfMeasure) && !/hour/i.test(i.unitOfMeasure)) {
      if (i.retailPrice <= 0) continue;
      if (storage === null || i.retailPrice < storage) storage = i.retailPrice;
    }
  }
  if (storage === null) {
    throw new Error(`Azure DB storage price not found in ${input.region} for ${serviceName}`);
  }

  const haHourly = input.ha ? computeItem.retailPrice : 0;
  return {
    computeMonthly: computeItem.retailPrice * opts.hours,
    storageMonthly: storage * input.storageGb,
    haMonthly: haHourly * opts.hours,
    iopsMonthly: 0,
    listedCurrency: 'USD',
    skuRefs: { compute: `${skuName} (${serviceName})`, storage: 'DB storage per GB-month' },
    warnings: ['HA modelled as a full standby replica at 100% of compute cost (assumption).'],
  };
}

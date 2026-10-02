import type { ServiceEstimateOptions } from '../../core/types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly } from '../../core/normalization.js';
import { providers } from '../../providers/index.js';
import { assertRegion } from '../../core/regions.js';
import { SKU_MAP } from '../../data/sizes.js';
import { storageEstimate } from '../storage/estimate.js';
import { databaseEstimate } from '../database/estimate.js';
import { k8sEstimate } from '../kubernetes/estimate.js';
import { networkEstimate } from '../network/estimate.js';
import type { TcoInput, TcoResult, TcoServiceLine } from './types.js';

export async function runTco(input: TcoInput, opts: ServiceEstimateOptions): Promise<TcoResult> {
  const provider = providers[input.providerId]!;
  assertRegion(provider.regions, input.region, provider.name);
  const region = provider.regions.find((r) => r.id === input.region);
  const fx = await getSarPerUsd(opts.noCache);
  const warnings: string[] = [];

  // Compute
  const size = SKU_MAP[input.providerId]![input.computeProfile]!;
  const computeQuote = await provider.getHourlyPrice(input.region, size, opts);
  const computeMonthly = computeQuote.hourly * input.hours;
  const computeNorm = normalizeMonthly({
    monthly: computeMonthly,
    listedCurrency: computeQuote.listedCurrency,
    displayCurrency: opts.currency,
    fxRate: fx.sarPerUsd,
    withVat: opts.vat,
    country: region?.country,
  });
  const compute: TcoServiceLine = { monthly: computeNorm.monthly, monthlyVat: computeNorm.monthlyVat, warnings: [] };

  // Storage (egress is billed once, under network â€” never under storage)
  const storage = await storageEstimate(input.providerId, {
    region: input.region,
    objectGb: input.storage.objectGb,
    blockGb: input.storage.blockGb,
    fileGb: input.storage.fileGb,
  }, opts);
  warnings.push(...storage.warnings);

  // Database (optional: dbEngine 'none' skips the line entirely)
  let database: TcoServiceLine = { monthly: 0, monthlyVat: 0, warnings: [] };
  if (input.dbEngine !== 'none') {
    const db = await databaseEstimate(input.providerId, {
      region: input.region,
      engine: input.dbEngine,
      tier: input.dbTier,
      storageGb: input.dbStorageGb,
      ha: input.dbHa,
    }, opts);
    database = { monthly: db.monthly, monthlyVat: db.monthlyVat, warnings: db.warnings };
    warnings.push(...db.warnings);
  }

  // Kubernetes (optional: 0 nodes skips the line)
  let kubernetes: TcoServiceLine = { monthly: 0, monthlyVat: 0, warnings: [] };
  if (input.k8sNodes > 0) {
    const k8s = await k8sEstimate(input.providerId, {
      region: input.region,
      nodeCount: input.k8sNodes,
      nodeProfile: input.k8sNodeProfile,
      controlPlane: input.k8sControlPlane,
    }, opts);
    kubernetes = { monthly: k8s.monthly, monthlyVat: k8s.monthlyVat, warnings: k8s.warnings };
    warnings.push(...k8s.warnings);
  }

  // Network
  const network = await networkEstimate(input.providerId, {
    region: input.region,
    egressGb: input.networkEgressGb,
    loadBalancers: input.networkLoadBalancers,
    nat: input.networkNat,
  }, opts);
  warnings.push(...network.warnings);

  const totalMonthly = compute.monthly + storage.monthly + database.monthly + kubernetes.monthly + network.monthly;
  const totalMonthlyVat = compute.monthlyVat + storage.monthlyVat + database.monthlyVat + kubernetes.monthlyVat + network.monthlyVat;

  return {
    provider: input.providerId,
    providerName: provider.name,
    region: input.region,
    regionName: region?.name ?? input.region,
    services: {
      compute,
      storage: { monthly: storage.monthly, monthlyVat: storage.monthlyVat, warnings: storage.warnings },
      database,
      kubernetes,
      network: { monthly: network.monthly, monthlyVat: network.monthlyVat, warnings: network.warnings },
    },
    totalMonthly,
    totalMonthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    warnings,
  };
}


import type { ServiceEstimateOptions } from '../../core/types.js';
import type { NetworkEstimate, NetworkInput } from './types.js';
import { getSarPerUsd } from '../../core/fx.js';
import { normalizeMonthly, componentConverter } from '../../core/normalization.js';
import { ASSUMED_RATES } from '../../core/assumptions.js';
import { fetchOciPriceList, ociCurrency, ociPartProduct, OCI_PARTS, paygRate, paygTiers, tieredCost } from '../../providers/ociCatalog.js';
import { providers } from '../../providers/index.js';

export async function estimateOciNetwork(
  region: string,
  input: NetworkInput,
  opts: ServiceEstimateOptions,
): Promise<NetworkEstimate> {
  const currency = ociCurrency(opts.currency);
  const products = await fetchOciPriceList(opts.noCache);
  const fx = await getSarPerUsd(opts.noCache);

  const egressPart = ociPartProduct(products, OCI_PARTS.egressMea);
  const lbPart = ociPartProduct(products, OCI_PARTS.loadBalancer);

  const egressTiers = paygTiers(egressPart, currency);
  // The LB part is tiered in the price list: the first 744 LB-hours/month are
  // free (Always Free allowance) and hours beyond that bill at the headline
  // rate. tieredCost applies each tier only to the quantity inside its window,
  // so 1 LB at 730h is free and 2 LBs bill only the hours beyond the allowance.
  const lbTiers = paygTiers(lbPart, currency);

  // The OCI price list API does not expose a NAT Gateway part; fall back to the
  // published list price, explicitly labeled as an assumption.
  const natPart = products.find((p) => /NAT Gateway/i.test(p.displayName));
  const warnings: string[] = [];
  const natRateLive = natPart ? paygRate(natPart, currency) : null;
  const natRate = input.nat
    ? (natRateLive ?? (currency === 'SAR' ? ASSUMED_RATES.ociNatGatewayHourlyUsd.rate * fx.sarPerUsd : ASSUMED_RATES.ociNatGatewayHourlyUsd.rate))
    : 0;
  const natSource: 'live' | 'assumption' = natRateLive !== null ? 'live' : 'assumption';
  if (input.nat && natRateLive === null) {
    warnings.push(`OCI NAT Gateway is not exposed by the price list API; using ${ASSUMED_RATES.ociNatGatewayHourlyUsd.skuRef} (assumption, not an official API price).`);
  }

  const egressMonthly = tieredCost(egressTiers, input.egressGb);
  const lbHours = input.loadBalancers * opts.hours;
  const lbMonthly = tieredCost(lbTiers, lbHours);
  const natMonthly = input.nat ? natRate * opts.hours : 0;
  const totalMonthly = egressMonthly + lbMonthly + natMonthly;

  if (input.egressGb > 0 && egressTiers[0]!.rate === 0) {
    warnings.push(`Egress: first ${egressTiers[0]!.rangeMax} GB/month free, remainder billed at ${egressTiers[egressTiers.length - 1]!.rate} ${currency}/GB.`);
  }
  if (lbHours > 0 && lbTiers[0]!.rate === 0) {
    warnings.push(`Load Balancer: first ${lbTiers[0]!.rangeMax} LB-hours/month free (Always Free allowance), remainder billed at ${lbTiers[lbTiers.length - 1]!.rate} ${currency}/hr.`);
  }
  warnings.push('LB priced as the per-hour base shape; bandwidth beyond the included amount is billed separately.');

  const regionInfo = providers.oci.regions.find((r) => r.id === region);
  const normalized = normalizeMonthly({
    monthly: totalMonthly,
    listedCurrency: currency,
    displayCurrency: opts.currency,
    fxRate: fx.sarPerUsd,
    withVat: opts.vat,
    country: regionInfo?.country,
  });
  const conv = componentConverter(currency, opts.currency, fx.sarPerUsd);

  return {
    provider: 'oci',
    providerName: providers.oci.name,
    region,
    regionName: regionInfo?.name ?? region,
    monthly: normalized.monthly,
    monthlyVat: normalized.monthlyVat,
    currency: opts.currency,
    fxRate: fx.sarPerUsd,
    nativeSar: normalized.nativeSar,
    components: {
      egress: { monthly: conv(egressMonthly), source: 'live', skuRef: `${OCI_PARTS.egressMea} (MEA outbound data transfer)` },
      loadBalancer: { monthly: conv(lbMonthly), source: 'live', skuRef: `${OCI_PARTS.loadBalancer} (LB base)` },
      nat: {
        monthly: conv(natMonthly),
        source: natSource,
        skuRef: natPart ? natPart.partNumber : ASSUMED_RATES.ociNatGatewayHourlyUsd.skuRef,
      },
    },
    warnings,
  };
}

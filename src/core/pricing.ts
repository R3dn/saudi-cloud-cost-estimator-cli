import type { Currency, EstimateResult, PriceQuote } from '../core/types.js';
import { applyVat } from './vat.js';
import { usdToSar } from './fx.js';

export interface NormalizeInput {
  quote: PriceQuote;
  providerName: string;
  regionName: string;
  currency: Currency;
  hours: number;
  sarPerUsd: number;
}

/**
 * Converts a raw provider quote into display currency, computes monthly totals
 * and applies Saudi VAT when requested (vat flag handled by caller).
 */
export function normalizeQuote(input: NormalizeInput, withVat: boolean): EstimateResult {
  const { quote, currency, hours, sarPerUsd } = input;
  const nativeSar = quote.listedCurrency === 'SAR';

  const hourlyDisplay =
    currency === 'SAR'
      ? nativeSar
        ? quote.hourly
        : usdToSar(quote.hourly, sarPerUsd)
      : nativeSar
        ? quote.hourly / sarPerUsd
        : quote.hourly;

  const monthly = hourlyDisplay * hours;
  const monthlyVat = withVat ? applyVat(monthly) : monthly;

  return {
    provider: quote.provider,
    providerName: input.providerName,
    region: quote.region,
    regionName: input.regionName,
    instance: quote.instance,
    vcpu: quote.vcpu,
    gb: quote.gb,
    hourly: quote.hourly,
    hourlyDisplay,
    monthly,
    monthlyVat,
    currency,
    fxRate: sarPerUsd,
    listedCurrency: quote.listedCurrency,
    nativeSar,
    source: quote.source,
    skuRef: quote.skuRef,
    altHourly: currency === 'SAR' ? hourlyDisplay / sarPerUsd : hourlyDisplay * sarPerUsd,
  };
}

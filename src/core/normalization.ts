import type { Currency, CurrencyConversionOpts } from './types.js';
import { VAT_RATE, vatCountryNote } from './vat.js';

export function convertCurrency(opts: CurrencyConversionOpts): number {
  const { amount, listedCurrency, displayCurrency, fxRate } = opts;
  if (listedCurrency === displayCurrency) return amount;
  if (displayCurrency === 'SAR' && listedCurrency === 'USD') return amount * fxRate;
  if (displayCurrency === 'USD' && listedCurrency === 'SAR') return amount / fxRate;
  return amount;
}

export interface MonthlyNorm {
  monthly: number;
  monthlyVat: number;
  nativeSar: boolean;
  altMonthly: number;
  vatNote: string;
}

export function normalizeMonthly(params: {
  monthly: number;
  listedCurrency: Currency;
  displayCurrency: Currency;
  fxRate: number;
  withVat: boolean;
  /** Region country code, for the VAT applicability note. */
  country?: 'SA' | 'BH' | 'AE';
}): MonthlyNorm {
  const nativeSar = params.listedCurrency === 'SAR';
  const monthly = convertCurrency({
    amount: params.monthly,
    listedCurrency: params.listedCurrency,
    displayCurrency: params.displayCurrency,
    fxRate: params.fxRate,
  });
  const monthlyVat = params.withVat ? monthly * (1 + VAT_RATE) : monthly;
  const altMonthly =
    params.displayCurrency === 'SAR' ? monthly / params.fxRate : monthly * params.fxRate;
  return {
    monthly,
    monthlyVat,
    nativeSar,
    altMonthly,
    vatNote: vatCountryNote(params.country),
  };
}

/** Builds the component-level currency converter shared by every service estimator. */
export function componentConverter(
  listedCurrency: Currency,
  displayCurrency: Currency,
  fxRate: number,
): (amount: number) => number {
  return (amount: number) =>
    convertCurrency({ amount, listedCurrency, displayCurrency, fxRate });
}

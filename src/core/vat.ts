export const VAT_RATE = 0.15;

export function applyVat(amount: number, rate: number = VAT_RATE): number {
  return amount * (1 + rate);
}

export function vatAmount(amount: number, rate: number = VAT_RATE): number {
  return amount * rate;
}

/**
 * The tool applies 15% Saudi VAT by default, including on Bahrain/UAE consumption.
 * For services consumed outside KSA the applicable tax depends on the customer's VAT
 * registration (e.g. Bahrain 10%, UAE 5%, or reverse charge on import). This default
 * is a documented assumption, not a provider fact, so it is surfaced to the user.
 */
export function vatCountryNote(country?: 'SA' | 'BH' | 'AE'): string {
  if (country === 'BH') return 'Assumption: 15% Saudi VAT applied to Bahrain consumption; actual treatment depends on your VAT registration (Bahrain 10% / reverse charge).';
  if (country === 'AE') return 'Assumption: 15% Saudi VAT applied to UAE consumption; actual treatment depends on your VAT registration (UAE 5% / reverse charge).';
  return '';
}

export function vatLabel(withVat: boolean): string {
  return withVat ? 'incl. 15% VAT (assumed)' : 'excl. VAT';
}

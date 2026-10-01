export type ServiceId = 'compute' | 'storage' | 'database' | 'kubernetes' | 'network';

export type ProviderId = 'oci' | 'aws' | 'azure' | 'gcp';

export type Currency = 'SAR' | 'USD';

/** How a price used in an estimate was obtained. */
export type PriceSource =
  /** Fetched live from the provider's official pricing API (or served from the 24h cache of it). */
  | 'live'
  /** A built-in approximation used because the live source was unavailable. Never an official price. */
  | 'fallback'
  /** A documented modelling assumption the tool applies (e.g. published list fees without an API). */
  | 'assumption';

export interface RegionInfo {
  id: string;
  name: string;
  country: 'SA' | 'BH' | 'AE';
  note?: string;
}

export type SizeProfile = 'small' | 'medium' | 'large' | 'xlarge';

export interface SizeSpec {
  profile: SizeProfile;
  vcpu: number;
  gb: number;
  /** Provider-specific instance identifier (AWS instance type, Azure SKU, GCP machine type). */
  instance: string;
  /** OCI flexible shape parameters. */
  ocpus?: number;
}

export interface PriceQuote {
  provider: ProviderId;
  region: string;
  instance: string;
  /** Price per hour in the provider's native listing currency. */
  hourly: number;
  /** Currency the price was listed in (OCI can be SAR natively). */
  listedCurrency: Currency;
  vcpu: number;
  gb: number;
  source: PriceSource;
  /** Provider identifier of the SKU/part the price came from. */
  skuRef?: string;
}

export interface EstimateOptions {
  currency: Currency;
  /** Hours per month used for every hourly-billed resource (compute, DB instance, LB, NAT, control plane). */
  hours: number;
  vat: boolean;
  noCache: boolean;
  gcpKey?: string;
}

export interface EstimateResult {
  provider: ProviderId;
  providerName: string;
  region: string;
  regionName: string;
  instance: string;
  vcpu: number;
  gb: number;
  hourly: number;
  hourlyDisplay: number;
  /** Hourly equivalent in the alternate currency (USD equivalent when displaying SAR, SAR when USD). */
  altHourly: number;
  monthly: number;
  monthlyVat: number;
  currency: Currency;
  fxRate: number;
  listedCurrency: Currency;
  nativeSar: boolean;
  source: PriceSource;
  skuRef?: string;
}

/** One line item of an estimate, with provenance for the rate used. */
export interface Component {
  /** Monthly amount in display currency, before VAT. */
  monthly: number;
  source: PriceSource;
  /** Provider identifier of the SKU/part the rate came from (part number, SKU description, offer code...). */
  skuRef?: string;
  /** Human-readable provenance or derivation note. */
  note?: string;
}

export interface ServiceEstimate {
  provider: ProviderId;
  providerName: string;
  region: string;
  regionName: string;
  /** Monthly before VAT. */
  monthly: number;
  /** Monthly with VAT applied if requested. */
  monthlyVat: number;
  currency: Currency;
  fxRate: number;
  nativeSar: boolean;
  /** Line-item breakdown in display currency (before VAT), each with provenance. */
  components: Record<string, Component>;
  /** Non-fatal caveats the user must see (fallback prices, assumptions, derivations). */
  warnings: string[];
}

export interface ServiceEstimateOptions {
  currency: Currency;
  /** Hours per month for hourly-billed resources. */
  hours: number;
  vat: boolean;
  noCache: boolean;
  gcpKey?: string;
}

export interface CurrencyConversionOpts {
  amount: number;
  listedCurrency: Currency;
  displayCurrency: Currency;
  fxRate: number;
}

/** One pricing tier of a rate: rate applies from rangeMin (inclusive) up to rangeMax (exclusive) GB/hours/units. */
export interface PriceTier {
  rangeMin: number;
  rangeMax: number;
  rate: number;
}

export interface Provider {
  id: ProviderId;
  name: string;
  regions: RegionInfo[];
  /** Hourly on-demand Linux price for a size profile in a region. */
  getHourlyPrice(region: string, size: SizeSpec, opts: EstimateOptions): Promise<PriceQuote>;
}

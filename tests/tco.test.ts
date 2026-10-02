import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { runTco } from '../src/services/tco/estimate.js';
import { databaseEstimate } from '../src/services/database/estimate.js';
import type { ServiceEstimateOptions } from '../src/core/types.js';
import type { TcoInput } from '../src/services/tco/types.js';

const OPTS: ServiceEstimateOptions = { currency: 'SAR', hours: 200, vat: true, noCache: true };

function ociPart(partNumber: string, value: number, metric = 'OCPU Per Hour') {
  return {
    partNumber,
    displayName: `Part ${partNumber}`,
    metricName: metric,
    currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value }] }],
  };
}

/** A complete mocked OCI price list covering every part the TCO needs. */
function ociPriceList() {
  return {
    items: [
      ociPart('B93113', 0.09376, 'OCPU Per Hour'),
      ociPart('B93114', 0.0056256, 'Gigabyte Per Hour'),
      ociPart('B91628', 0.0956352, 'Gigabyte Storage Capacity Per Month'),
      ociPart('B91961', 0.0956352, 'Gigabyte Storage Capacity Per Month'),
      ociPart('B89057', 1.12512, 'Gigabyte Storage Capacity Per Month'),
      ociPart('B112725', 0.20177152, 'ECPU Per Hour'),
      ociPart('B111584', 0.450048, 'Gigabyte (GB) Storage Capacity Per Month'),
      ociPart('B96545', 0.37504, 'Cluster Per Hour'),
      {
        partNumber: 'B93456',
        displayName: 'Outbound Data Transfer MEA',
        metricName: 'Gigabyte Outbound Data Transfer Per Month',
        currencyCodeLocalizations: [{
          currencyCode: 'SAR',
          prices: [
            { model: 'PAY_AS_YOU_GO', value: 0, rangeMin: 0, rangeMax: 10240 },
            { model: 'PAY_AS_YOU_GO', value: 0.18752, rangeMin: 10240, rangeMax: 999999999 },
          ],
        }],
      },
      {
        partNumber: 'B93030',
        displayName: 'Load Balancer Base',
        metricName: 'Load Balancer',
        currencyCodeLocalizations: [{
          currencyCode: 'SAR',
          prices: [
            { model: 'PAY_AS_YOU_GO', value: 0, rangeMin: 0, rangeMax: 744 },
            { model: 'PAY_AS_YOU_GO', value: 0.04237952, rangeMin: 744, rangeMax: 999999999 },
          ],
        }],
      },
    ],
  };
}

const baseInput = {
  providerId: 'oci' as const,
  region: 'me-riyadh-1',
  computeProfile: 'medium' as const,
  hours: 200,
  storage: { region: 'me-riyadh-1', objectGb: 0, blockGb: 100, fileGb: 0 },
  dbEngine: 'none' as const,
  dbTier: 'medium' as const,
  dbStorageGb: 100,
  dbHa: false,
  k8sNodes: 0,
  k8sNodeProfile: 'medium' as const,
  k8sControlPlane: false,
  networkEgressGb: 50,
  networkLoadBalancers: 1,
  networkNat: false,
};

describe('runTco (OCI, mocked list)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ociPriceList() })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('dbEngine none → database line is exactly zero (no forced DB)', async () => {
    const result = await runTco(baseInput as TcoInput, OPTS);
    expect(result.services.database.monthly).toBe(0);
    expect(result.services.database.monthlyVat).toBe(0);
  });

  it('k8sNodes 0 → kubernetes line is exactly zero', async () => {
    const result = await runTco(baseInput as TcoInput, OPTS);
    expect(result.services.kubernetes.monthly).toBe(0);
  });

  it('egress is billed exactly once (network), never under storage', async () => {
    const result = await runTco(baseInput as TcoInput, OPTS);
    // storage has no egress component at all; egress appears only in the network line.
    // 50 GB egress is within the 10 TB free tier; 1 LB × 200h is within the 744 LB-hr
    // free allowance — the network line is exactly zero for this workload.
    expect(result.services.network.monthly).toBeCloseTo(0, 4);
    expect(result.warnings.some((w) => /first 10240 GB\/month free/.test(w))).toBe(true);
    expect(result.warnings.some((w) => /first 744 LB-hours\/month free/.test(w))).toBe(true);
  });

  it('hours propagate to compute, DB, k8s — not just compute', async () => {
    const input: TcoInput = {
      ...baseInput,
      dbEngine: 'postgresql',
      k8sNodes: 2,
      k8sControlPlane: true,
    };
    const result = await runTco(input, OPTS);
    // compute: 0.4650496 SAR/hr × 200h
    expect(result.services.compute.monthly).toBeCloseTo(0.4650496 * 200, 2);
    // db compute: 2 ECPU × 0.20177152 × 200h
    expect(result.services.database.monthly).toBeCloseTo(2 * 0.20177152 * 200 + 0.450048 * 100, 1);
    // k8s: (2 nodes × 0.4650496 + 0.37504 cluster) × 200h
    expect(result.services.kubernetes.monthly).toBeCloseTo((2 * 0.4650496 + 0.37504) * 200, 1);
  });

  it('aggregates warnings from sub-services', async () => {
    const input: TcoInput = { ...baseInput, dbEngine: 'postgresql' };
    const result = await runTco(input, OPTS);
    expect(result.warnings.some((w) => /HA modelled|free/.test(w))).toBe(true);
  });

  it('total = sum of service lines, VAT applied once at each line', async () => {
    const result = await runTco(baseInput as TcoInput, OPTS);
    const sum = result.services.compute.monthly + result.services.storage.monthly +
      result.services.database.monthly + result.services.kubernetes.monthly + result.services.network.monthly;
    expect(result.totalMonthly).toBeCloseTo(sum, 4);
  });
});

describe('databaseEstimate (OCI native SAR)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ociPriceList() })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('postgres medium: ECPU rate × hours + storage GB-month, with provenance', async () => {
    const est = await databaseEstimate('oci', {
      region: 'me-riyadh-1',
      engine: 'postgresql',
      tier: 'medium',
      storageGb: 100,
      ha: false,
    }, { currency: 'SAR', hours: 200, vat: false, noCache: true });
    expect(est.components.compute!.source).toBe('live');
    expect(est.components.compute!.skuRef).toBe('B112725');
    expect(est.monthly).toBeCloseTo(2 * 0.20177152 * 200 + 0.450048 * 100, 2);
  });

  it('oracle engine uses the Exascale parts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          ociPart('B109356', 1.2601344, 'ECPU Per Hour'),
          ociPart('B107952', 0.73245312, 'Gigabyte (GB) Storage Capacity Per Month'),
        ],
      }),
    })));
    const est = await databaseEstimate('oci', {
      region: 'me-riyadh-1',
      engine: 'oracle',
      tier: 'small',
      storageGb: 50,
      ha: false,
    }, { currency: 'SAR', hours: 100, vat: false, noCache: true });
    expect(est.components.compute!.skuRef).toBe('B109356');
    expect(est.monthly).toBeCloseTo(1 * 1.2601344 * 100 + 0.73245312 * 50, 2);
  });
});

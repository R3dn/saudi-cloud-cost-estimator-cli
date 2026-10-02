import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { k8sEstimate } from '../src/services/kubernetes/estimate.js';
import { estimateOciNetwork } from '../src/services/network/oci.js';
import type { ServiceEstimateOptions } from '../src/core/types.js';

const OPTS: ServiceEstimateOptions = { currency: 'SAR', hours: 100, vat: false, noCache: true };

function ociPart(partNumber: string, tiers: { value: number; rangeMin?: number; rangeMax?: number }[]) {
  return {
    partNumber,
    displayName: `Part ${partNumber}`,
    metricName: 'Cluster Per Hour',
    currencyCodeLocalizations: [
      {
        currencyCode: 'SAR',
        prices: tiers.map((t) => ({ model: 'PAY_AS_YOU_GO', value: t.value, rangeMin: t.rangeMin, rangeMax: t.rangeMax })),
      },
    ],
  };
}

function ociComputeParts() {
  return [
    {
      partNumber: 'B93113',
      displayName: 'Compute OCPU',
      metricName: 'OCPU Per Hour',
      currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.09376 }] }],
    },
    {
      partNumber: 'B93114',
      displayName: 'Compute Memory',
      metricName: 'Gigabyte Per Hour',
      currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.0056256 }] }],
    },
  ];
}

describe('k8sEstimate (OCI)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          ...ociComputeParts(),
          ociPart('B96545', [{ value: 0.37504 }]), // OKE enhanced cluster/hr SAR
        ],
      }),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prices nodes + live control plane, honoring --hours', async () => {
    const est = await k8sEstimate('oci', {
      region: 'me-riyadh-1',
      nodeCount: 3,
      nodeProfile: 'medium',
      controlPlane: true,
    }, OPTS);
    // node: 4*0.09376 + 16*0.0056256 = 0.4650496 SAR/hr; 3 nodes × 100h
    expect(est.components.nodes!.monthly).toBeCloseTo(0.4650496 * 3 * 100, 3);
    expect(est.components.controlPlane!.monthly).toBeCloseTo(0.37504 * 100, 3);
    expect(est.components.controlPlane!.source).toBe('live');
    expect(est.warnings.some((w) => /Enhanced Cluster/.test(w))).toBe(true);
  });

  it('skips control plane when not requested', async () => {
    const est = await k8sEstimate('oci', {
      region: 'me-riyadh-1',
      nodeCount: 1,
      nodeProfile: 'small',
      controlPlane: false,
    }, OPTS);
    expect(est.components.controlPlane!.monthly).toBeCloseTo(0);
  });
});

describe('estimateOciNetwork (MEA egress, tiers)', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        items: [
          ociPart('B93456', [
            { value: 0, rangeMin: 0, rangeMax: 10 },
            { value: 0.18752, rangeMin: 10, rangeMax: 999999999 },
          ]),
          {
            partNumber: 'B93030',
            displayName: 'Load Balancer Base',
            metricName: 'Load Balancer',
            currencyCodeLocalizations: [{
              currencyCode: 'SAR',
              // 744 free LB hours, then 0.04237952/hr
              prices: [
                { model: 'PAY_AS_YOU_GO', value: 0, rangeMin: 0, rangeMax: 744 },
                { model: 'PAY_AS_YOU_GO', value: 0.04237952, rangeMin: 744, rangeMax: 999999999 },
              ],
            }],
          },
          {
            partNumber: 'B96110',
            displayName: 'NAT Gateway',
            metricName: 'Hour',
            currencyCodeLocalizations: [{ currencyCode: 'SAR', prices: [{ model: 'PAY_AS_YOU_GO', value: 0.112512 }] }],
          },
        ],
      }),
    })));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prices egress beyond the 10 GB free tier and LB hours per --hours', async () => {
    const est = await estimateOciNetwork('me-riyadh-1', {
      region: 'me-riyadh-1',
      egressGb: 110,
      loadBalancers: 2,
      nat: true,
    }, { currency: 'SAR', hours: 100, vat: false, noCache: true });
    // egress: 100 GB paid × 0.18752 = 18.752
    expect(est.components.egress!.monthly).toBeCloseTo(18.752, 3);
    // LB: 2 × 100h = 200 LB-hours — entirely within the 744 h/month free
    // allowance (Oracle Always Free, verified against part B93030), so SAR 0
    expect(est.components.loadBalancer!.monthly).toBeCloseTo(0);
    // NAT: 0.112512 × 100
    expect(est.components.nat!.monthly).toBeCloseTo(11.2512, 3);
    expect(est.components.egress!.skuRef).toContain('B93456');
    expect(est.warnings.some((w) => /first 744 LB-hours\/month free/.test(w))).toBe(true);
  });

  it('bills LB hours only beyond the 744-hour free allowance', async () => {
    // 5 LBs × 200h = 1000 LB-hours → 744 free, 256 billed at 0.04237952 SAR/hr
    const est = await estimateOciNetwork('me-riyadh-1', {
      region: 'me-riyadh-1',
      egressGb: 0,
      loadBalancers: 5,
      nat: false,
    }, { currency: 'SAR', hours: 200, vat: false, noCache: true });
    expect(est.components.loadBalancer!.monthly).toBeCloseTo(256 * 0.04237952, 4);
  });
});

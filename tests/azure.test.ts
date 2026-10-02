import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { azureProvider, azureSpecsFromName } from '../src/providers/azure.js';
import type { EstimateOptions } from '../src/core/types.js';

const OPTS: EstimateOptions = { currency: 'SAR', hours: 730, vat: true, noCache: true };

describe('azureProvider', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('picks the Linux consumption price', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          {
            armSkuName: 'Standard_D4s_v5',
            skuName: 'Standard_D4s_v5',
            productName: 'Virtual Machines Dsv5 Series',
            retailPrice: 0.235,
            unitOfMeasure: '1 Hour',
            type: 'Consumption',
            armRegionName: 'uaenorth',
          },
          {
            armSkuName: 'Standard_D4s_v5',
            skuName: 'Standard_D4s_v5 Spot',
            productName: 'Virtual Machines Dsv5 Series',
            retailPrice: 0.05,
            unitOfMeasure: '1 Hour',
            type: 'Consumption',
            armRegionName: 'uaenorth',
          },
          {
            armSkuName: 'Standard_D4s_v5',
            skuName: 'Standard_D4s_v5',
            productName: 'Virtual Machines Dsv5 Series Windows',
            retailPrice: 0.4,
            unitOfMeasure: '1 Hour',
            type: 'Consumption',
            armRegionName: 'uaenorth',
          },
        ],
        NextPageLink: null,
      }),
    });
    const quote = await azureProvider.getHourlyPrice('uaenorth', {
      profile: 'medium',
      vcpu: 4,
      gb: 16,
      instance: 'Standard_D4s_v5',
    }, OPTS);
    expect(quote.hourly).toBeCloseTo(0.235);
    expect(quote.listedCurrency).toBe('USD');
  });

  it('rejects zero and missing prices', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          {
            armSkuName: 'Standard_D4s_v5',
            skuName: 'Standard_D4s_v5',
            productName: 'Virtual Machines Dsv5 Series',
            retailPrice: 0,
            unitOfMeasure: '1 Hour',
            type: 'Consumption',
          },
        ],
        NextPageLink: null,
      }),
    });
    await expect(
      azureProvider.getHourlyPrice('uaenorth', {
        profile: 'medium',
        vcpu: 4,
        gb: 16,
        instance: 'Standard_D4s_v5',
      }, OPTS),
    ).rejects.toThrow(/not found/);
  });

  it('follows NextPageLink pagination across multiple pages', async () => {
    let call = 0;
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          json: async () => ({
            Items: [
              {
                armSkuName: 'Standard_D4s_v5',
                skuName: 'Standard_D4s_v5',
                productName: 'Virtual Machines Dsv5 Series',
                retailPrice: 0.5,
                unitOfMeasure: '1 Hour',
                type: 'Consumption',
                armRegionName: 'uaenorth',
              },
            ],
            NextPageLink: 'https://prices.azure.com/api/retail/prices?page=2',
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          Items: [
            {
              armSkuName: 'Standard_D4s_v5',
              skuName: 'Standard_D4s_v5',
              productName: 'Virtual Machines Dsv5 Series',
              retailPrice: 0.22,
              unitOfMeasure: '1 Hour',
              type: 'Consumption',
              armRegionName: 'uaenorth',
            },
          ],
          NextPageLink: null,
        }),
      };
    });
    const quote = await azureProvider.getHourlyPrice('uaenorth', {
      profile: 'medium',
      vcpu: 4,
      gb: 16,
      instance: 'Standard_D4s_v5',
    }, OPTS);
    expect(quote.hourly).toBeCloseTo(0.22);
    expect(call).toBe(2);
  });
});

describe('azureSpecsFromName', () => {
  it('parses D/E/F family sizes', () => {
    expect(azureSpecsFromName('Standard_D4s_v5')).toEqual({ vcpu: 4, gb: 16 });
    expect(azureSpecsFromName('Standard_E4s_v5')).toEqual({ vcpu: 4, gb: 32 });
    expect(azureSpecsFromName('Standard_F4s_v2')).toEqual({ vcpu: 4, gb: 8 });
    expect(azureSpecsFromName('Standard_D32s_v5')).toEqual({ vcpu: 32, gb: 128 });
  });

  it('returns undefined for unknown families (caller keeps its own specs)', () => {
    expect(azureSpecsFromName('Standard_NC24lds_xl_RTXPRO6000BSE_v6')).toBeUndefined();
    expect(azureSpecsFromName('weird')).toBeUndefined();
  });
});

describe('azureProvider custom instance', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('derives specs from the SKU name when no profile is given', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({
        Items: [
          {
            armSkuName: 'Standard_E8s_v5',
            skuName: 'Standard_E8s_v5',
            productName: 'Virtual Machines Esv5 Series',
            retailPrice: 0.62,
            unitOfMeasure: '1 Hour',
            type: 'Consumption',
            armRegionName: 'uaenorth',
          },
        ],
        NextPageLink: null,
      }),
    });
    const quote = await azureProvider.getHourlyPrice('uaenorth', { vcpu: 0, gb: 0, instance: 'Standard_E8s_v5' }, OPTS);
    expect(quote.hourly).toBeCloseTo(0.62);
    expect(quote.vcpu).toBe(8);
    expect(quote.gb).toBe(64);
  });
});

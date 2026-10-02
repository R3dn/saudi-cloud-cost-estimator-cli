import type { EstimateOptions, PriceQuote, Provider, SizeSpec } from '../core/types.js';
import { assertRegion } from '../core/regions.js';
import {
  fetchOciPriceList,
  ociCurrency,
  ociPartProduct,
  OCI_PARTS,
  paygRate,
} from './ociCatalog.js';

export const ociProvider: Provider = {
  id: 'oci',
  name: 'Oracle Cloud Infrastructure',
  regions: [
    { id: 'me-riyadh-1', name: 'Saudi Arabia Central (Riyadh)', country: 'SA' },
    { id: 'me-jeddah-1', name: 'Saudi Arabia West (Jeddah)', country: 'SA' },
  ],
  async getHourlyPrice(region: string, size: SizeSpec, opts: EstimateOptions): Promise<PriceQuote> {
    assertRegion(ociProvider.regions, region, 'OCI');
    const products = await fetchOciPriceList(opts.noCache);
    const ocpuPart = ociPartProduct(products, OCI_PARTS.computeOcpu);
    const memPart = ociPartProduct(products, OCI_PARTS.computeMemory);
    const ocpus = size.ocpus ?? size.vcpu;
    const currency = ociCurrency(opts.currency);
    const ocpuRate = paygRate(ocpuPart, currency);
    const memRate = paygRate(memPart, currency);
    let hourly = ocpus * ocpuRate + size.gb * memRate;
    let instance = `VM.Standard.E4.Flex (${ocpus} OCPU / ${size.gb} GB)`;
    let skuRef = `${OCI_PARTS.computeOcpu}+${OCI_PARTS.computeMemory}`;
    if (size.gpu) {
      const gpuPart = ociPartProduct(products, OCI_PARTS.gpuA10);
      const gpuRate = paygRate(gpuPart, currency);
      hourly += size.gpu.count * gpuRate;
      instance = `${size.instance} (${ocpus} OCPU / ${size.gb} GB + ${size.gpu.count}× ${size.gpu.model})`;
      skuRef = `${OCI_PARTS.computeOcpu}+${OCI_PARTS.computeMemory}+${OCI_PARTS.gpuA10}`;
    }
    return {
      provider: 'oci',
      region,
      instance,
      hourly,
      listedCurrency: currency,
      vcpu: size.vcpu,
      gb: size.gb,
      source: 'live',
      skuRef,
    };
  },
};

import { providerList } from '../providers/index.js';
import { renderRegions } from '../ui/tables.js';
import pc from 'picocolors';

export function runRegions(json: boolean = false): void {
  if (json) {
    const payload = {
      providers: providerList.map((p) => ({
        provider: p.id,
        providerName: p.name,
        regions: p.regions.map((r) => ({
          id: r.id,
          name: r.name,
          country: r.country,
          note: r.note ?? null,
        })),
      })),
    };
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  console.log(pc.bold('\nRegions covered by this tool\n'));
  console.log(
    pc.dim(
      'Not in v1: AWS KSA region (announced, not live), Azure Saudi Arabia East (announced, not yet priced), Alibaba/Huawei Riyadh (no public pricing API).\n',
    ),
  );
  for (const provider of providerList) {
    renderRegions(provider.name, provider.regions);
  }
}

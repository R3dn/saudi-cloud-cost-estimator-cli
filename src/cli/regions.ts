import { providerList } from '../providers/index.js';
import { renderRegions } from '../ui/tables.js';
import pc from 'picocolors';

export function runRegions(): void {
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

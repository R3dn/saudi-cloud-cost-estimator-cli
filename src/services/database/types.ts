import type { ServiceEstimate } from '../../core/types.js';

export interface DatabaseEstimate extends ServiceEstimate {
  components: {
    compute: ServiceEstimate['components'][string];
    storage: ServiceEstimate['components'][string];
    iops: ServiceEstimate['components'][string];
    ha: ServiceEstimate['components'][string];
  };
}

export interface DatabaseInput {
  region: string;
  engine: 'postgresql' | 'mysql' | 'sqlserver' | 'oracle' | 'none';
  tier: 'small' | 'medium' | 'large';
  storageGb: number;
  ha: boolean;
  iops?: number;
}

import type { ProviderId } from '../../core/types.js';
import type { SizeProfile } from '../../core/types.js';

export type DbEngine = 'postgresql' | 'mysql' | 'sqlserver' | 'oracle' | 'none';

export interface TcoInput {
  providerId: ProviderId;
  region: string;
  computeProfile: SizeProfile;
  hours: number;
  storage: {
    region: string;
    objectGb: number;
    blockGb: number;
    fileGb: number;
  };
  dbEngine: DbEngine;
  dbTier: 'small' | 'medium' | 'large';
  dbStorageGb: number;
  dbHa: boolean;
  k8sNodes: number;
  k8sNodeProfile: SizeProfile;
  k8sControlPlane: boolean;
  networkEgressGb: number;
  networkLoadBalancers: number;
  networkNat: boolean;
}

export interface TcoServiceLine {
  monthly: number;
  monthlyVat: number;
  warnings: string[];
}

export interface TcoResult {
  provider: ProviderId;
  providerName: string;
  region: string;
  regionName: string;
  services: {
    compute: TcoServiceLine;
    storage: TcoServiceLine;
    database: TcoServiceLine;
    kubernetes: TcoServiceLine;
    network: TcoServiceLine;
  };
  totalMonthly: number;
  totalMonthlyVat: number;
  currency: 'SAR' | 'USD';
  fxRate: number;
  warnings: string[];
}

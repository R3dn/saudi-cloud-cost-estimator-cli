import type { ServiceEstimate } from '../../core/types.js';

export interface NetworkEstimate extends ServiceEstimate {
  components: {
    egress: ServiceEstimate['components'][string];
    loadBalancer: ServiceEstimate['components'][string];
    nat: ServiceEstimate['components'][string];
  };
}

export interface NetworkInput {
  region: string;
  egressGb: number;
  loadBalancers: number;
  nat: boolean;
}

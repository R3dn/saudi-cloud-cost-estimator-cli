import type { ServiceEstimate, SizeProfile } from '../../core/types.js';

export interface K8sEstimate extends ServiceEstimate {
  components: {
    controlPlane: ServiceEstimate['components'][string];
    nodes: ServiceEstimate['components'][string];
  };
}

export interface K8sInput {
  region: string;
  nodeCount: number;
  nodeProfile: SizeProfile;
  controlPlane: boolean;
}

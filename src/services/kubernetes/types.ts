import type { ServiceEstimate } from '../../core/types.js';

export interface K8sEstimate extends ServiceEstimate {
  components: {
    controlPlane: ServiceEstimate['components'][string];
    nodes: ServiceEstimate['components'][string];
  };
}

export interface K8sInput {
  region: string;
  nodeCount: number;
  nodeProfile: 'small' | 'medium' | 'large' | 'xlarge';
  controlPlane: boolean;
}

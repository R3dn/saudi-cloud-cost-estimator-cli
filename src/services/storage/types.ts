import type { ServiceEstimate } from '../../core/types.js';

export interface StorageEstimate extends ServiceEstimate {
  components: {
    objectStorage: ServiceEstimate['components'][string];
    blockStorage: ServiceEstimate['components'][string];
    fileStorage: ServiceEstimate['components'][string];
  };
}

export interface StorageInput {
  region: string;
  objectGb: number;
  blockGb: number;
  fileGb: number;
}

export interface DispatchSeal {
  _id: string;
  sealNumber: string;
  sourceHubId?: string;
  sourceHubName?: string;
  assignedHubName?: string;
  type?: string;
  isPassthroughSeal?: boolean;
  state?: string;
  createdAt?: string;
  openedAt?: string;
  closedAt?: string;
  updatedAt?: string;
  trackingNumberDetails?: Array<{ trackingNumber: string; scanTime?: string; businessName?: string }>;
  destinationWarehouseId?: string;
  destinationWarehouseName?: string;
  packagesCount?: number;
  trackingNumbers?: string[];
  lastUpdate?: string;
}

export interface DispatchDelivery {
  _id?: string;
  trackingNumber: string;
  type?: string;
  senderName?: string;
  state?: string;
  raw?: Record<string, unknown>;
}

export interface SealTrackingNumber {
  trackingNumber: string;
  scanTime: string;
}

export interface WarehouseTransferPayload {
  warehouseTransfer: {
    masterSealNumber: string;
    originWarehouseId: string;
    destinationWarehouseId: string;
    passthroughSealNumbers: string[];
    sealNumbers: string[];
  };
}

export interface MasterSealDispatch {
  _id: string;
  sealNumber: string;
  sourceHubName: string;
  destinationHubName: string;
  sourceHubId?: string;
  destinationHubId?: string;
  createdAt: string;
  openedAt?: string;
  normalSealsCount: number;
  bulkySealsCount: number;
  passthroughSealsCount: number;
  transitTime?: { days?: number; minutes?: number } | null;
  manifest?: MasterSealManifest;
  manifestError?: string;
  excludeFromAlex?: boolean;
}

export interface MasterSealManifestSeal {
  sealNumber: string;
  destinationHubName: string;
  sealType: string;
  expectedTrackingNumbersCount: number;
  receivedTrackingNumbersCount: number;
  missedTrackingNumberCount: number;
  trackingNumbers?: string[];
}

export interface MasterSealManifest {
  sealNumber: string;
  sourceHubName: string;
  destinationHubName: string;
  createdAt: string;
  expectedTrackingNumbersCount: number;
  receivedTrackingNumbersCount: number;
  missedTrackingNumberCount: number;
  seals: MasterSealManifestSeal[];
}

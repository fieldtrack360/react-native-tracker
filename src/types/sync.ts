// Sync. Config is mostly divergent; the two network gates are NOT unified — "any
// connectivity" and "unmetered only" are different policies. Both sit in their platform namespace.

export type SyncConfig = {
  // shared
  url: string;
  method?: string;
  headers?: Record<string, string>;
  autoSync?: boolean;
  batchSize?: number;
  ios?: {
    /** iOS network gate: any connectivity. Not the same field as Android's unmetered gate. */
    requiresNetworkConnectivity?: boolean;
    wipeOnAuthExpiry?: boolean;
    stopTrackingOnAuthExpiry?: boolean;
    backoffInitialSec?: number;
    backoffCeilingSec?: number;
    autoSyncCoalesceSec?: number;
  };
  android?: {
    /** Android network gate: unmetered only. Not the same field as iOS's connectivity gate. */
    requiresUnmeteredNetwork?: boolean;
  };
};

// Same four-case result on both platforms.
export type SyncResult =
  | { kind: 'uploaded'; count: number }
  | { kind: 'empty' }
  | { kind: 'retry'; reason: string }
  | { kind: 'authExpired' };

// iOS only (`ios.onSyncEvent`). Android has no sync event stream.
export type SyncEvent =
  | { type: 'httpResponse'; statusCode: number | null; count: number }
  | { type: 'uploaded'; count: number }
  | { type: 'retryScheduled'; afterSec: number; reason: string }
  | { type: 'authExpired' };

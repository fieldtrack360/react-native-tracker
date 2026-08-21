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

// Four cases on both platforms, plus an Android-only fifth.
export type SyncResult =
  | { kind: 'uploaded'; count: number }
  | { kind: 'empty' }
  | { kind: 'retry'; reason: string }
  | { kind: 'authExpired' }
  // ANDROID ONLY (HTTP 403). Deliberately NOT folded onto `authExpired`, because the two demand
  // opposite reactions: `authExpired` (401) is a teardown — Android stops tracking and clears the
  // queue — while `forbidden` keeps tracking running and every row queued, and only halts the
  // retry loop. The recovery is `configure()` with a credential that may write this resource, not
  // a re-login. The iOS SDK has no such case, so this kind never arrives there.
  | { kind: 'forbidden' };

// Sync event stream (`TrackerSync.onSyncEvent`). `httpResponse` arrives on BOTH platforms; the
// other three are iOS-only (the Android SDK's `SyncEvent` has the one case).
export type SyncEvent =
  | { type: 'httpResponse'; statusCode: number | null; count: number }
  /** iOS only. */
  | { type: 'uploaded'; count: number }
  /** iOS only. */
  | { type: 'retryScheduled'; afterSec: number; reason: string }
  /** iOS only. */
  | { type: 'authExpired' };

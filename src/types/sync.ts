// Sync. Config is mostly divergent; the two network gates are NOT unified — "any
// connectivity" and "unmetered only" are different policies. Both sit in their platform namespace.

export type SyncConfig = {
  // shared
  url: string;
  /** Default "POST". On Android ONLY `POST`, `PUT` or `PATCH` are accepted — the built-in transport
   *  is Retrofit, whose verb annotations are compile-time constants, so anything else rejects
   *  `invalidConfig` at configure() time. iOS passes the verb through unrestricted. */
  method?: string;
  headers?: Record<string, string>;
  /** Default TRUE on both platforms — upload as points arrive. Omitting it does NOT mean off.
   *  With it off the host drives uploads through `syncNow()` / `requestSync()`. */
  autoSync?: boolean;
  /** Default 100. Android additionally requires 1..1000 and rejects `invalidConfig` outside it. */
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
    /** Compress the JSON request body. Default false, and deliberately: there is no negotiation
     *  for request-body encoding, so a client sending `Content-Encoding: gzip` is asserting it and
     *  a server that does not expect it answers 400 or stores the compressed bytes as the payload.
     *  Turn it on only once the endpoint is known to decompress. */
    gzipRequestBody?: boolean;
    /** Permit an `http://` url. Default false. Android blocks cleartext from API 28, so without
     *  this an `http://` endpoint is accepted here and then fails at runtime as an ordinary network
     *  error — retried forever, on battery, with nothing in the logs naming the cause. Loopback
     *  hosts (`localhost`, `127.0.0.1`, `::1`, `10.0.2.2`) are exempt already and need no flag.
     *  Local development only. */
    allowCleartext?: boolean;
    /** Applied by the SDK's built-in transport; a custom `SyncTransport` owns the client that would
     *  honour them and ignores these. Defaults 5 s / 30 s / 20 s; each must be > 0. */
    timeouts?: {
      connectMs?: number;
      readMs?: number;
      writeMs?: number;
    };
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

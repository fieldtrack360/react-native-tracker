// Sync. Config is mostly divergent; the two network gates are NOT unified — "any
// connectivity" and "unmetered only" are different policies. Both sit in their platform namespace.

/** Any JSON value. Both SDKs take arbitrary JSON in `extraParams` and keep the type on the wire —
 *  a number stays a number, a boolean stays a boolean; nothing is stringified. */
export type SyncParamValue =
  | string
  | number
  | boolean
  | null
  | SyncParamValue[]
  | { [key: string]: SyncParamValue };

export type SyncConfig = {
  // shared
  url: string;
  /** Default "POST". On Android ONLY `POST`, `PUT` or `PATCH` are accepted — the built-in transport
   *  is Retrofit, whose verb annotations are compile-time constants, so anything else rejects
   *  `invalidConfig` at configure() time. iOS passes the verb through unrestricted. */
  method?: string;
  headers?: Record<string, string>;
  /** Merged into the TOP LEVEL of every request body, beside the `location` array and before it,
   *  in insertion order. For what belongs to the REQUEST rather than to any point — a tenant id, a
   *  device label, an API version — and that a header cannot carry because the endpoint reads its
   *  body. Static config, like `headers`: a rotating token belongs in a fresh `configure()` call.
   *  With none set the body is byte-identical to a build without this field, so it is additive and
   *  an existing backend needs no change.
   *
   *  `location` is RESERVED — it is the batch itself — and both SDKs refuse it.
   *
   *  `null` DIVERGES and is the one value that does not survive both crossings. iOS models it
   *  (`SyncValue.null`) and encodes JSON `null`; the Android SDK has no null value ("omit the key
   *  instead"), so the Android mapper DROPS a null-valued key. A null inside an ARRAY cannot be
   *  dropped without shifting every element after it, so Android rejects that as `invalidConfig`
   *  rather than silently renumbering. Send a sentinel if the key must reach both bodies.
   *
   *  Android additionally caps nesting at 10 levels and rejects an unserializable value at
   *  `configure()` time, naming the key, rather than failing mid-drain. */
  extraParams?: Record<string, SyncParamValue>;
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

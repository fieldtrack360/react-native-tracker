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

// ── Session logs — ANDROID ONLY, Android SDK 1.0.10 ──────────────────────────────
// A second, separate diagnostic channel with its own endpoint, its own database and its own
// worker. Points answer *where the device was*; this answers *why there is nothing there*.
//
// Off by default and entirely inside `fieldtrack-sync`. Nothing on this channel can reach
// `stop()`, the point queue, or a stored point: the log buffer is a DIFFERENT database file
// (`fieldtrack-logs-<package>.db`), which is what makes a credential failure on the log endpoint
// structurally unable to lose a position. The iOS SDK has no counterpart, so every method here
// lives under `TrackerSync.android.*` and REJECTS `unsupportedOnPlatform` on iOS.

/** Severity. Ordered — a recorder set to `warn` keeps `warn` and `error` and drops the rest. */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** What kind of entry this is; the second gate, because `decision` is three orders of magnitude
 *  noisier than the rest. `event` is `TrackerEvent` (permission and provider changes, errors,
 *  capture suspensions), `lifecycle` is the session/service/process phases, `message` is what the
 *  host writes through `log()`, and `decision` is the SDK's own per-fix decision log. */
export type LogType = 'event' | 'decision' | 'message' | 'lifecycle';

/** The phases `logLifecycle()` expects. Free strings are accepted — these are the SDK's own
 *  vocabulary, and matching it is what lets a dashboard line the host's entries up with the
 *  SDK's. */
export type LifecyclePhase =
  | 'session_start'
  | 'session_stop'
  | 'session_interrupted'
  | 'service_start'
  | 'service_stop'
  | 'process_start'
  | 'boot_completed'
  | 'config_changed';

export type LogSyncConfig = {
  /** Absolute log endpoint. **Omit it and the channel FOLLOWS the points endpoint** — the origin
   *  of the `SyncConfig` already in force plus `v1/logs/batch`. A relative path is resolved the
   *  same way. That default is the intended use. */
  url?: string;
  /** Omit to INHERIT `device_id` from the points `SyncConfig.extraParams`. Sending a different one
   *  produces two unrelated datasets, which is why inheriting is the default. */
  deviceId?: string;
  /** Default "POST". */
  method?: string;
  headers?: Record<string, string>;
  /** Default true — a 15-minute `LogSyncWorker` heartbeat. With it off the host drives uploads
   *  through `syncLogsNow()` / `requestLogSync()`. */
  autoSync?: boolean;
  /** Minimum severity KEPT. Default `info`. Filtering happens at RECORD time, not upload time:
   *  it keeps the buffer a strict FIFO the uploader settles with one cursor, and stops a device
   *  storing what it will never send. Raising it later does not retroactively drop what is
   *  already buffered. */
  level?: LogLevel;
  /** Which kinds are kept. Default `['event','lifecycle','message']` — note `decision` is NOT in
   *  it. Turning `decision` on is roughly 29 000 entries per device per shift: enable it for a
   *  named device with a ticket open, not for a fleet. The first `configureLogs` that enables it
   *  moves the watermark to the newest row, so an opt-in ships the next drive rather than the
   *  last three days. */
  types?: LogType[];
  /** Rows held before the oldest are dropped. Default 5000. */
  bufferCapacity?: number;
  /** Default 72. */
  retentionHours?: number;
  /** Entries per upload. Default 200; the endpoint's ceiling is 500 and a batch over it is
   *  rejected permanently rather than retried. */
  batchSize?: number;
  requiresUnmeteredNetwork?: boolean;
  /** Default TRUE here — the inverse of the points channel, where it defaults false. */
  gzipRequestBody?: boolean;
  allowCleartext?: boolean;
  timeouts?: { connectMs?: number; readMs?: number; writeMs?: number };
  /** Heartbeat cadence. Default 15, and 15 is also the floor — `WorkManager` will not run a
   *  periodic job more often. */
  uploadIntervalMinutes?: number;
  /** The prompt half of the channel: an entry at this level or worse asks for an upload straight
   *  away instead of waiting out the heartbeat. Default `warn`; `null` disables it. A burst inside
   *  the cooldown is DEFERRED to its end rather than dropped. */
  nudgeLevel?: LogLevel | null;
  /** Throttle on the above. Default 30 000. */
  nudgeCooldownMs?: number;
  /** Merged into the top level of every log request body — same shape and rules as the points
   *  channel's `extraParams`. */
  extraParams?: Record<string, SyncParamValue>;
};

/** One stored entry, as `getLogs()` returns it. `data` is the raw JSON string the entry carries,
 *  not a parsed object: the SDK stores whatever was handed to `log()` and only checks that it is
 *  a JSON structure. Parse it yourself, in a try/catch. */
export type LogRecord = {
  id: string;
  sessionId: string | null;
  /** Per (session, type) counter — the order entries were RECORDED in, which survives an upload
   *  reordering them and is what a dashboard sorts by. */
  seq: number;
  timeMs: number;
  /** Crosses as a STRING: it is a monotonic nanosecond stamp and exceeds what a JS number holds
   *  exactly. Compare it as a BigInt, or not at all. */
  elapsedRealtimeNanos: string;
  level: LogLevel;
  type: LogType;
  tag: string;
  code: string | null;
  message: string;
  data: string | null;
};

/** `syncLogsNow()`. Four cases, and they are NOT the points channel's four — this channel's
 *  failure policy is deliberately the inverse in two places. */
export type LogSyncResult =
  | { kind: 'shipped'; count: number }
  | { kind: 'empty' }
  /** Transient. `retryAfterMs` is the server's own `Retry-After` when it sent one. `reason` also
   *  carries the two "nothing to do" cases — the channel was never configured, or it has no
   *  transport. */
  | { kind: 'retry'; reason: string; retryAfterMs?: number }
  /** TERMINAL for this channel and inert for every other one: the buffer is KEPT and not one
   *  stored point is affected. Two shapes — the credential was refused (401, 403), or there is no
   *  endpoint at this URL (404, 405, 501). The second is a statement about the endpoint rather
   *  than about the bytes just sent, so retrying at the next heartbeat would only discard the
   *  host's diagnostics to be told the same thing. Recovery is a fresh `configureLogs()`. */
  | { kind: 'rejected'; statusCode: number };

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

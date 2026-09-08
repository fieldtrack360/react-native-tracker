// src/sync.ts
//
// Phase 7 sync module. SEPARATE "TrackerSync" TurboModule, distinct from the main Tracker
// module. The public surface is TrackerSync.{ configure, requestSync, syncNow, pendingCount,
// onSyncEvent } plus the ANDROID-ONLY session-log channel under TrackerSync.android.* (Android
// SDK 1.0.10) — a second endpoint, database and worker, described at that namespace below.
//
// Config is MOSTLY DIVERGENT and crosses as a JSON string: shared = url/method/headers/autoSync/
// batchSize; the two network gates are NOT unified (iOS ios.requiresNetworkConnectivity = "any
// connectivity" vs Android android.requiresUnmeteredNetwork = "unmetered only") — each sits in its
// platform namespace, and each native mapper builds its own native SyncConfig from the same JSON.
// The iOS-only fields (wipeOnAuthExpiry / stopTrackingOnAuthExpiry / backoff* /
// autoSyncCoalesceSec) ride along in config.ios and are read only by the iOS mapper.
//
// onSyncEvent is CROSS-PLATFORM. Both SDKs expose a sync event stream — iOS
// `SyncEngine.events(): AsyncStream<SyncEvent>`, Android `TrackerSync.events: SharedFlow<SyncEvent>`
// — so the subscription rides the SAME NativeEventEmitter pattern as the main module's streams, on a
// DISTINCT device event "TrackerSyncEmit": one native Task/Job per JS subscriber
// (subscribeSyncEvents -> id), envelopes routed by id, cancelled on unsubscribe.
//
// The EVENT VOCABULARY is not symmetric, though the transport is: `httpResponse` arrives on both,
// and `uploaded` / `retryScheduled` / `authExpired` are iOS-only (the Android SyncEvent has the one
// case). An Android host reads upload outcomes from syncNow()/pendingCount() instead.
import { NativeEventEmitter, type EmitterSubscription } from 'react-native';
import TrackerSyncNative from './NativeTrackerSync';
import type {
  LifecyclePhase,
  LogLevel,
  LogRecord,
  LogSyncConfig,
  LogSyncResult,
  SyncConfig,
  SyncEvent,
  SyncResult,
} from './types/sync';
import type { TrackerResult } from './types';

type Envelope = { id: number; payload: unknown };

// ONE NativeEventEmitter over the TurboModule; native emits a single device event "TrackerSyncEmit"
// with body { id, payload }. addListener/removeListeners on the native module are bookkeeping no-ops.
const emitter = new NativeEventEmitter(TrackerSyncNative as never);

// ── Public methods ──────────────────────────────────────────────────────────────
// configure(config): serialise the WHOLE SyncConfig to JSON (shared + ios.* + android.*); the native
// mapper picks its platform's fields. Rejects invalidConfig on undecodable JSON, an unparseable iOS
// url, or an Android SyncConfig.validate() failure. The two network gates stay platform-namespaced —
// do NOT collapse them here.
function configure(config: SyncConfig): Promise<void> {
  return TrackerSyncNative.configure(JSON.stringify(config));
}

// requestSync(): call after accepted points or at an app-owned checkpoint even when autoSync is true
// (Android does not auto-enqueue the worker on accepted-point events). Forwards only.
function requestSync(): Promise<void> {
  return TrackerSyncNative.requestSync();
}

// syncNow(): run one sync pass now. Four cases on both platforms plus the Android-only "forbidden"
// (HTTP 403) — see SyncResult for why that one is not folded onto authExpired.
function syncNow(): Promise<SyncResult> {
  return TrackerSyncNative.syncNow() as Promise<SyncResult>;
}

// pendingCount() → TrackerResult<number> (Android wraps its bare Int native-side; iOS maps its native
// TrackerResult<Int>).
function pendingCount(): Promise<TrackerResult<number>> {
  return TrackerSyncNative.pendingCount() as Promise<TrackerResult<number>>;
}

// ── onSyncEvent (both platforms) ──────────────────────────────────────────────────
// Register the JS listener FIRST, then start the native Task/Job; an envelope that arrives before the
// id resolves is buffered and flushed. That buffer is load-bearing on ANDROID: its sink is a
// SharedFlow with replay = 1, so a subscriber attaching after a background drain is handed that
// drain's last httpResponse immediately (the SDK's own choice, so an upload screen opens with what
// happened rather than blank). iOS replays nothing, so in practice nothing is buffered there.
//
// Only `httpResponse` arrives on Android — switch on `event.type` and let the other three fall
// through rather than assuming a platform.
function onSyncEvent(cb: (event: SyncEvent) => void): () => void {
  return subscribe(() => TrackerSyncNative.subscribeSyncEvents(), cb);
}

// The shared attach/route/detach machinery. Both streams on this module — the points stream and
// the Android-only log stream — ride the SAME device event and the SAME native id space, so they
// differ only in which native subscribe call starts them and `unsubscribe(id)` ends either.
function subscribe<E>(
  start: () => Promise<number>,
  cb: (event: E) => void
): () => void {
  let nativeId: number | null = null;
  let cancelled = false;
  const pending: Envelope[] = [];

  const sub: EmitterSubscription = emitter.addListener(
    'TrackerSyncEmit',
    // The emitter is typed `(...args: readonly Object[]) => unknown` in the RN strict API, so the
    // envelope is narrowed here rather than declared as the parameter — native always emits this
    // exact shape ({ id, payload }).
    (...args: readonly Object[]) => {
      const env = args[0] as Envelope;
      if (nativeId == null) {
        pending.push(env);
        return;
      }
      if (env.id === nativeId) cb(env.payload as E);
    }
  );

  start()
    .then((id) => {
      if (cancelled) {
        // Unsubscribed before the id came back — tear the native Task/Job down immediately.
        void TrackerSyncNative.unsubscribe(id);
        return;
      }
      nativeId = id;
      for (const env of pending) if (env.id === id) cb(env.payload as E);
      pending.length = 0;
    })
    .catch(() => {
      // Neither platform rejects today; a native fault still must not leave a JS listener attached
      // to a stream that will never emit.
      sub.remove();
    });

  return () => {
    if (cancelled) return;
    cancelled = true;
    sub.remove();
    pending.length = 0;
    if (nativeId != null) void TrackerSyncNative.unsubscribe(nativeId);
  };
}

// Retained so code written against the iOS-only namespace keeps working; it forwards to the shared
// onSyncEvent and behaves identically on both platforms.
const ios = {
  /** @deprecated The stream is no longer iOS-only — use `TrackerSync.onSyncEvent`. */
  onSyncEvent,
};

// ── android.* — the session-log channel (Android SDK 1.0.10) ─────────────────────
// A SECOND diagnostic channel: its own endpoint, its own database file, its own worker. The iOS
// SDK has no counterpart, so every call here REJECTS `unsupportedOnPlatform` on iOS — the same
// contract as `Tracker.android.*`.
//
// The isolation is the point. Nothing on this channel can reach `stop()`, the point queue, or a
// row of stored positions, because the buffer is a different database file; a credential failure
// on the log endpoint is structurally unable to lose a position. The failure policy is also the
// deliberate INVERSE of the points channel in two places: a permanently-rejected batch is dropped
// rather than retried forever, and a refusal of the channel itself (401/403, or 404/405/501 for
// "no endpoint here") halts shipping while KEEPING the buffer.
const android = {
  /** Turn the channel on. With no argument it FOLLOWS the points endpoint — the origin of the
   *  `SyncConfig` already in force plus `v1/logs/batch`, inheriting `device_id` and the points
   *  headers — which is the intended use; a different `deviceId` would produce two unrelated
   *  datasets. Rejects `invalidConfig` on anything the SDK's own validation reports.
   *
   *  Calling it again re-resolves the config in place; the buffer is untouched. */
  configureLogs(config: LogSyncConfig = {}): Promise<void> {
    return TrackerSyncNative.androidConfigureLogs(JSON.stringify(config));
  },

  /** Stop shipping and cancel the worker. The buffer is KEPT — a later `configureLogs()` resumes
   *  with what is still in it, which is also the recovery path from a `rejected` result. */
  disableLogSync(): Promise<void> {
    return TrackerSyncNative.androidDisableLogSync();
  },

  /** Write one host entry (recorded as type `message`). `data` must be a JSON structure — an
   *  object or an array — already serialised to a string; the SDK drops anything else rather than
   *  storing a bare scalar. Forwarded only, so it resolves without waiting on the database.
   *
   *  An entry at or above the configured `nudgeLevel` (default `warn`) asks for an upload straight
   *  away instead of waiting out the 15-minute heartbeat. */
  log(entry: {
    level: LogLevel;
    tag: string;
    message: string;
    code?: string;
    data?: string;
  }): Promise<void> {
    return TrackerSyncNative.androidLog(
      entry.level,
      entry.tag,
      entry.message,
      entry.code,
      entry.data
    );
  },

  /** Mark a lifecycle phase. The vocabulary is the SDK's own, and matching it is what lets a
   *  dashboard line the host's entries up with the SDK's; a free string is still accepted.
   *  `tag` defaults to `"Host"`. */
  logLifecycle(phase: LifecyclePhase | string, tag?: string): Promise<void> {
    return TrackerSyncNative.androidLogLifecycle(phase, tag);
  },

  /** Read stored entries back, newest-first. Defaults limit 200 / offset 0; an absent `sessionId`
   *  reads across sessions. `record.data` is the raw JSON string as stored — parse it yourself. */
  getLogs(opts?: {
    sessionId?: string;
    limit?: number;
    offset?: number;
  }): Promise<LogRecord[]> {
    return TrackerSyncNative.androidGetLogs(
      opts?.sessionId,
      opts?.limit,
      opts?.offset
    ) as Promise<LogRecord[]>;
  },

  /** How many entries are waiting to ship. Separate from `pendingCount()` — different queue,
   *  different database. */
  pendingLogCount(): Promise<TrackerResult<number>> {
    return TrackerSyncNative.androidPendingLogCount() as Promise<
      TrackerResult<number>
    >;
  },

  /** Drain the log buffer now. See `LogSyncResult` — the four cases are NOT the points channel's
   *  four. */
  syncLogsNow(): Promise<LogSyncResult> {
    return TrackerSyncNative.androidSyncLogsNow() as Promise<LogSyncResult>;
  },

  /** Ask the worker to drain. A no-op — not an error — when the channel was never configured or
   *  has been terminally rejected. */
  requestLogSync(): Promise<void> {
    return TrackerSyncNative.androidRequestLogSync();
  },

  /** Where diagnostics are going, and whether they are going anywhere. `endpoint` is undefined
   *  until `configureLogs()` has been called, and `configured` is exactly that test. */
  logStatus(): Promise<{ configured: boolean; endpoint?: string }> {
    return TrackerSyncNative.androidLogStatus();
  },

  /** The log channel's own event stream — a separate flow from `onSyncEvent`, carrying THIS
   *  channel's HTTP exchanges. Only `httpResponse` arrives (the Android `SyncEvent` has the one
   *  case). Returns the unsubscribe function. */
  onLogEvent(cb: (event: SyncEvent) => void): () => void {
    return subscribe(() => TrackerSyncNative.androidSubscribeLogEvents(), cb);
  },
};

export const TrackerSync = {
  configure,
  requestSync,
  syncNow,
  pendingCount,
  onSyncEvent,
  ios,
  android,
};

export default TrackerSync;

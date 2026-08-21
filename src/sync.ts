// src/sync.ts
//
// Phase 7 sync module. SEPARATE "TrackerSync" TurboModule, distinct from the main Tracker
// module. The public surface is TrackerSync.{ configure, requestSync, syncNow, pendingCount,
// onSyncEvent }.
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
import type { SyncConfig, SyncEvent, SyncResult } from './types/sync';
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
      if (env.id === nativeId) cb(env.payload as SyncEvent);
    }
  );

  TrackerSyncNative.subscribeSyncEvents()
    .then((id) => {
      if (cancelled) {
        // Unsubscribed before the id came back — tear the native Task/Job down immediately.
        void TrackerSyncNative.unsubscribe(id);
        return;
      }
      nativeId = id;
      for (const env of pending)
        if (env.id === id) cb(env.payload as SyncEvent);
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

export const TrackerSync = {
  configure,
  requestSync,
  syncNow,
  pendingCount,
  onSyncEvent,
  ios,
};

export default TrackerSync;

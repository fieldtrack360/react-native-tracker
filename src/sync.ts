// src/sync.ts
//
// Phase 7 sync module. SEPARATE "TrackerSync" TurboModule, distinct from the main Tracker
// module. The public surface is TrackerSync.{ configure, requestSync, syncNow, pendingCount } plus
// the iOS-only ios.onSyncEvent(cb) stream.
//
// Config is MOSTLY DIVERGENT and crosses as a JSON string: shared = url/method/headers/autoSync/
// batchSize; the two network gates are NOT unified (iOS ios.requiresNetworkConnectivity = "any
// connectivity" vs Android android.requiresUnmeteredNetwork = "unmetered only") — each sits in its
// platform namespace, and each native mapper builds its own native SyncConfig from the same JSON.
// The iOS-only fields (wipeOnAuthExpiry / stopTrackingOnAuthExpiry / backoff* /
// autoSyncCoalesceSec) ride along in config.ios and are read only by the iOS mapper.
//
// ios.onSyncEvent is iOS-ONLY (Android has no sync event stream). It rides the SAME NativeEventEmitter
// pattern as the main module's streams, on a DISTINCT device event "TrackerSyncEmit": one native Task
// per JS subscriber (subscribeSyncEvents -> id), envelopes routed by id, cancelled on unsubscribe.
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
// mapper picks its platform's fields. Rejects invalidConfig on undecodable JSON / an unparseable iOS
// url. The two network gates stay platform-namespaced — do NOT collapse them here.
function configure(config: SyncConfig): Promise<void> {
  return TrackerSyncNative.configure(JSON.stringify(config));
}

// requestSync(): call after accepted points or at an app-owned checkpoint even when autoSync is true
// (Android does not auto-enqueue the worker on accepted-point events). Forwards only.
function requestSync(): Promise<void> {
  return TrackerSyncNative.requestSync();
}

// syncNow(): run one sync pass now → the four-case result on both platforms.
function syncNow(): Promise<SyncResult> {
  return TrackerSyncNative.syncNow() as Promise<SyncResult>;
}

// pendingCount() → TrackerResult<number> (Android wraps its bare Int native-side; iOS maps its native
// TrackerResult<Int>).
function pendingCount(): Promise<TrackerResult<number>> {
  return TrackerSyncNative.pendingCount() as Promise<TrackerResult<number>>;
}

// ── ios.onSyncEvent (iOS only) ────────────────────────────────────────────────────
// Register the JS listener FIRST, then start the native Task; an envelope that arrives before the id
// resolves is buffered and flushed (sync events have replay 0 natively, so in practice none do).
// On Android subscribeSyncEvents() rejects unsupportedOnPlatform → the listener is dropped and the
// returned unsubscribe fn is a safe no-op (there is no Platform.OS branch — the ios.* namespace is
// always present).
const ios = {
  onSyncEvent(cb: (event: SyncEvent) => void): () => void {
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
          // Unsubscribed before the id came back — tear the native Task down immediately.
          void TrackerSyncNative.unsubscribe(id);
          return;
        }
        nativeId = id;
        for (const env of pending)
          if (env.id === id) cb(env.payload as SyncEvent);
        pending.length = 0;
      })
      .catch(() => {
        // Android rejects unsupportedOnPlatform (no sync event stream) — drop the JS listener.
        sub.remove();
      });

    return () => {
      if (cancelled) return;
      cancelled = true;
      sub.remove();
      pending.length = 0;
      if (nativeId != null) void TrackerSyncNative.unsubscribe(nativeId);
    };
  },
};

export const TrackerSync = {
  configure,
  requestSync,
  syncNow,
  pendingCount,
  ios,
};

export default TrackerSync;

// src/events.ts
//
// Phase 4 subscription layer. ONE NativeEventEmitter over the TurboModule; native emits a
// single device event "TrackerEmit" with body { id, payload }. Each onXxx starts ONE native
// Task/Job (subscribe → subscription id) and returns an unsubscribe fn that cancels it
// (unsubscribe(id)). Buffering is owned natively and never widened here: live track capacity
// 1, events depth 64 / drop-oldest, both replay 0. Payload is the typed wire object for every stream
// except onPoints, whose point list is unbounded and therefore crosses as a JSON string.
import { NativeEventEmitter, type EmitterSubscription } from 'react-native';
import TrackerNative from './NativeTracker';
import type {
  BatteryInfo,
  LiveTrackUpdate,
  ProviderState,
  TrackerEvent,
  TrackerState,
  TrackPoint,
} from './types';

type Envelope = { id: number; payload: unknown };

// NativeEventEmitter requires the module to implement addListener/removeListeners (added to the
// Spec). On iOS it also drives those; here they are native bookkeeping no-ops — real lifetime is the
// native Task/Job started by subscribe() and cancelled by unsubscribe().
const emitter = new NativeEventEmitter(TrackerNative as never);

// Shared plumbing: register the JS listener FIRST, then start the native task. Envelopes that arrive
// before the subscription id resolves (a StateFlow / @Observable replays its current value the moment
// the native collector attaches) are buffered and flushed once the id is known — otherwise the
// initial snapshot would be silently lost. Events (replay 0) simply won't fire in that window.
function subscribeStream<T>(
  stream: string,
  arg: string | undefined,
  decode: (payload: unknown) => T,
  cb: (value: T) => void
): () => void {
  let nativeId: number | null = null;
  let cancelled = false;
  const pending: Envelope[] = [];

  const sub: EmitterSubscription = emitter.addListener(
    'TrackerEmit',
    // The emitter is typed `(...args: readonly Object[]) => unknown` in the RN strict API, so the
    // envelope is narrowed here rather than declared as the parameter — native always emits this
    // exact shape ({ id, payload }).
    (...args: readonly Object[]) => {
      const env = args[0] as Envelope;
      if (nativeId == null) {
        pending.push(env);
        return;
      }
      if (env.id === nativeId) cb(decode(env.payload));
    }
  );

  TrackerNative.subscribe(stream, arg)
    .then((id) => {
      if (cancelled) {
        // Unsubscribed before the id came back — tear the native task down immediately.
        void TrackerNative.unsubscribe(id);
        return;
      }
      nativeId = id;
      for (const env of pending) if (env.id === id) cb(decode(env.payload));
      pending.length = 0;
    })
    .catch(() => {
      sub.remove();
    });

  return () => {
    if (cancelled) return;
    cancelled = true;
    sub.remove();
    pending.length = 0;
    if (nativeId != null) void TrackerNative.unsubscribe(nativeId);
  };
}

// the 21-case event union. Payload is the wire event object { type, ... }. Seven cases never fire
// on one platform (geofenceDwell/licenseDeactivated/trackingGap = iOS only;
// geofenceAdded/geofenceRemoved/integrityChange/licenseChecked = Android only) — a case absent on
// a platform simply never arrives; do not build a liveness assumption on it.
export function onTrackerEvent(cb: (event: TrackerEvent) => void): () => void {
  return subscribeStream('events', undefined, (p) => p as TrackerEvent, cb);
}

// live surface. Capacity 1 natively — each frame is a replacement, never buffered before JS.
export function onLiveTrack(cb: (update: LiveTrackUpdate) => void): () => void {
  return subscribeStream(
    'liveTrack',
    undefined,
    (p) => p as LiveTrackUpdate,
    cb
  );
}

// batteryState() — both platforms (Android StateFlow<BatteryInfo>, iOS AsyncStream<BatteryInfo>);
// each replays the current reading on attach, then one value per transition.
// `TrackerEvent.batteryChange` carries the same transitions if you are already on onTrackerEvent().
export function onBatteryChange(
  cb: (battery: BatteryInfo) => void
): () => void {
  return subscribeStream('battery', undefined, (p) => p as BatteryInfo, cb);
}

// observePoints(sessionId). The point list is unbounded, so it crosses as a JSON
// string; decode to TrackPoint[] here.
export function onPoints(
  sessionId: string,
  cb: (points: TrackPoint[]) => void
): () => void {
  return subscribeStream(
    'observePoints',
    sessionId,
    (p) => JSON.parse(p as string) as TrackPoint[],
    cb
  );
}

// onStateChange — derived from the native @Observable state (iOS) / StateFlow (Android). The
// current state is delivered on subscribe (buffered until the id resolves).
export function onStateChange(cb: (state: TrackerState) => void): () => void {
  return subscribeStream('state', undefined, (p) => p as TrackerState, cb);
}

// onProviderStateChange — separate from the event union, on both platforms.
export function onProviderStateChange(
  cb: (state: ProviderState) => void
): () => void {
  return subscribeStream(
    'providerState',
    undefined,
    (p) => p as ProviderState,
    cb
  );
}

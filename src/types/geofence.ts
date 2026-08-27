// Geofencing. Both platforms have it, with materially different shapes; this is the
// unified wire surface.
import type { GeofenceTransition } from './enums';

export type Geofence = {
  id: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  /** default true. An explicit `false` has no Android representation → the Android mapper
   *  refuses with `invalidConfig` naming the field. */
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
  /** iOS only. Set on Android → `invalidConfig`. */
  dwellAfterMs?: number;
  /** The label carried back on a crossing as `GeofenceCrossing.eventName`. Shared since iOS SDK
   *  1.0.5 (`Geofence.onEnterEvent/onExitEvent`); before that they were Android-only and lived
   *  under an `android` sub-object, which no longer exists.
   *
   *  Optional on both, with DIFFERENT read-back: iOS stores `nil` for an omitted label and
   *  `list()`/`get()` omit the key; Android requires a non-null label, so the mapper derives
   *  `<id>_enter` / `<id>_exit` and always reads them back. Set them explicitly if you compare
   *  the two platforms' fences field for field. */
  onEnterEvent?: string;
  onExitEvent?: string;
};

// `getEvents()` is the source of truth; live events are a convenience. On Android live
// events the optionals are unfillable (timeMs absent; lat/lon are the fence centre); stored
// events from getEvents() populate them on both platforms.
export type GeofenceCrossing = {
  geofenceId: string;
  transition: GeofenceTransition;
  timeMs?: number;
  latitude?: number;
  longitude?: number;
  radiusM?: number;
  /** The fence's label for this direction. Absent on a `dwell` (iOS deliberately leaves it nil —
   *  a dwell is not a crossing) and on an iOS fence added without labels; always present on
   *  Android, which derives one. */
  eventName?: string;
};

/** The window `deleteEvents()` takes as its second argument. Both bounds are inclusive and both
 *  are optional — omit them to delete every crossing the id selects. Honoured on both platforms. */
export type GeofenceEventsWindow = {
  fromMs?: number;
  toMs?: number;
};

export type GeofenceEventsQuery = {
  geofenceId?: string;
  /** Time-range filter, inclusive. Honoured on both platforms — iOS gained `fromMs`/`toMs` in
   *  SDK 1.0.5 and silently ignored them before. */
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
};

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
  /** Android's event labels; iOS has no equivalent. */
  android?: { onEnterEvent?: string; onExitEvent?: string };
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
};

export type GeofenceEventsQuery = {
  geofenceId?: string;
  /** Android supports time-range filtering; iOS ignores fromMs/toMs. */
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
};

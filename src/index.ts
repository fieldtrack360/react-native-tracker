import TrackerNative from './NativeTracker';
import type {
  AccuracyAuthorization,
  BackgroundRequest,
  BatteryInfo,
  DeviceSensors,
  FixDecision,
  Geofence,
  GeofenceCrossing,
  GeofenceEventsQuery,
  IntegrityReport,
  LicenseInfo,
  MotionAuthorization,
  PermissionTier,
  PointQuery,
  RawFix,
  RawPoint,
  Track,
  TrackFix,
  TrackerConfig,
  TrackerResult,
  TrackerState,
  TrackOptions,
  TrackPoint,
  TrackSession,
} from './types';

export * from './types';
export {
  onTrackerEvent,
  onLiveTrack,
  onPoints,
  onStateChange,
  onProviderStateChange,
  onBatteryChange,
  onBatteryThreshold,
  type BatteryThresholdCrossing,
} from './events';

// Android headless delivery — events reaching JS in a process the OS restarted without a UI.
export {
  registerHeadlessTask,
  HEADLESS_TASK_KEY,
  type HeadlessEvent,
} from './headless';

// Fabric map components. The typed wrappers own the JSON.stringify boundary; the specs
// (TrackMapViewNativeComponent / LiveTrackMapViewNativeComponent) are the codegen contract.
export {
  TrackMapView,
  LiveTrackMapView,
  type TrackMapViewProps,
  type LiveTrackMapViewProps,
  type CameraFollowMode,
} from './components';

// Sync — a separate module; its own public object.
export { TrackerSync } from './sync';

import {
  onBatteryChange,
  onBatteryThreshold,
  onLiveTrack,
  onPoints,
  onProviderStateChange,
  onStateChange,
  onTrackerEvent,
} from './events';
import { registerHeadlessTask } from './headless';

// Public API (D4). The host calls one common method; platform divergence is absorbed here or
// in the native mappers — never in the host. `Tracker.*` holds what both platforms do; `.ios.*` /
// `.android.*` hold the rest (a call on the wrong platform rejects `unsupportedOnPlatform` — the
// namespace is always present, so there is no Platform.OS branch). Unbounded reads cross as JSON
// strings and are decoded here into the typed shapes.

const parse = <T>(json: string): T => JSON.parse(json) as T;

// AN OMITTED OBJECT ARGUMENT MUST STILL CROSS AS AN OBJECT.
//
// On iOS an object-typed parameter in the codegen spec becomes a C++ struct REFERENCE
// (`JS::NativeTracker::PointQueryWire &`), and the emitted accessors read the struct's backing
// dictionary unconditionally — `id const p = _v[@"sessionId"];`. Passing `undefined` leaves that
// reference bound to nothing, so the first accessor dereferences null: EXC_BAD_ACCESS at 0x0 on
// the TurboModule queue, inside generated code, before any of this package's native code runs. It
// is a process crash rather than a rejected Promise, so no caller can catch it.
//
// `{}` is the same fact stated in a way the bridge can carry: an absent KEY and an absent ARGUMENT
// both mean "use the SDK default" to the mappers on both platforms (see TrackerMappers.pointQuery /
// trackOptions — a nil-or-empty dictionary returns `PointQuery()` / `TrackOptions()` untouched), so
// no behaviour changes and the null reference becomes unreachable.
const obj = <T extends object>(value?: T): T => value ?? ({} as T);

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export function getState(): Promise<TrackerState> {
  return TrackerNative.getState() as Promise<TrackerState>;
}
export function ready(
  config?: TrackerConfig
): Promise<TrackerResult<TrackerState>> {
  const json = config != null ? JSON.stringify(config) : undefined;
  return TrackerNative.ready(json) as Promise<TrackerResult<TrackerState>>;
}
export function start(tag?: string): Promise<TrackerResult<TrackSession>> {
  return TrackerNative.start(tag) as Promise<TrackerResult<TrackSession>>;
}
export function stop(): Promise<TrackerResult<TrackSession | null>> {
  return TrackerNative.stop() as Promise<TrackerResult<TrackSession | null>>;
}

// ── Reads ───────────────────────────────────────────────────────────────────────
export async function getPoints(query?: PointQuery): Promise<TrackPoint[]> {
  return parse<TrackPoint[]>(await TrackerNative.getPoints(obj(query)));
}
export function getCount(query?: PointQuery): Promise<number> {
  return TrackerNative.getCount(obj(query));
}
export function getOdometerMeters(): Promise<number> {
  return TrackerNative.getOdometerMeters();
}
export function getSessions(
  fromMs?: number,
  toMs?: number
): Promise<TrackSession[]> {
  return TrackerNative.getSessions(fromMs, toMs) as Promise<TrackSession[]>;
}
export function currentSession(): Promise<TrackSession | null> {
  return TrackerNative.currentSession() as Promise<TrackSession | null>;
}

// ── Current location ──────────────────────────────────────────────────────────────
export function getCurrentLocation(): Promise<TrackerResult<TrackFix>> {
  return TrackerNative.getCurrentLocation() as Promise<TrackerResult<TrackFix>>;
}

// ── Plotting ────────────────────────────────────────────────────────────────────
export async function buildTrack(
  query?: PointQuery,
  options?: TrackOptions
): Promise<Track> {
  return parse<Track>(await TrackerNative.buildTrack(obj(query), obj(options)));
}
export function exportPolylineJson(
  query?: PointQuery,
  options?: TrackOptions
): Promise<string> {
  return TrackerNative.exportPolylineJson(obj(query), obj(options));
}
export function exportGeoJson(
  query?: PointQuery,
  options?: TrackOptions
): Promise<string> {
  return TrackerNative.exportGeoJson(obj(query), obj(options));
}

// ── Road snapping ────────────────────────────────────────────────────────────────
export function setOsrmSnapProvider(config: {
  baseUrl: string;
  profile?: string;
}): Promise<void> {
  return TrackerNative.setOsrmSnapProvider(config);
}
export function clearRoadSnapProvider(): Promise<void> {
  return TrackerNative.clearRoadSnapProvider();
}

// ── Live surface ─────────────────────────────────────────────────────────────────
export function setActiveRoute(
  points: Array<{ latitude: number; longitude: number }>
): Promise<void> {
  return TrackerNative.setActiveRoute(points);
}
export function isOffRoute(): Promise<boolean> {
  return TrackerNative.isOffRoute();
}

// ── Diagnostics ──────────────────────────────────────────────────────────────────
export async function getRawFixes(sessionId: string): Promise<RawFix[]> {
  return parse<RawFix[]>(await TrackerNative.getRawFixes(sessionId));
}
export async function getRawPoints(sessionId: string): Promise<RawPoint[]> {
  return parse<RawPoint[]>(await TrackerNative.getRawPoints(sessionId));
}
export async function getDecisions(
  sessionId?: string,
  limit?: number,
  offset?: number
): Promise<FixDecision[]> {
  return parse<FixDecision[]>(
    await TrackerNative.getDecisions(sessionId, limit, offset)
  );
}
export function offerFix(fix: TrackFix): Promise<void> {
  return TrackerNative.offerFix(fix);
}
export function getSensors(): Promise<DeviceSensors> {
  return TrackerNative.getSensors() as Promise<DeviceSensors>;
}
/** batteryInfo(). Both platforms. A one-shot read — subscribe with onBatteryChange() for a
 *  live value. */
export function getBatteryInfo(): Promise<BatteryInfo> {
  return TrackerNative.getBatteryInfo() as Promise<BatteryInfo>;
}

// ── Permissions ──────────────────────────────────────────────────────────────────
const permissions = {
  getTier: (): Promise<PermissionTier> =>
    TrackerNative.getPermissionTier() as Promise<PermissionTier>,
  getAccuracy: (): Promise<AccuracyAuthorization> =>
    TrackerNative.getAccuracy() as Promise<AccuracyAuthorization>,
  shouldStopAsking: (attempts: number): Promise<boolean> =>
    TrackerNative.shouldStopAsking(attempts),
  requestForeground: (): Promise<PermissionTier> =>
    TrackerNative.requestForeground() as Promise<PermissionTier>,
  requestBackground: (): Promise<BackgroundRequest> =>
    TrackerNative.requestBackground() as Promise<BackgroundRequest>,
  getBackgroundRequest: (): Promise<BackgroundRequest> =>
    TrackerNative.getBackgroundRequest() as Promise<BackgroundRequest>,
  openAppSettings: (): Promise<boolean> => TrackerNative.openAppSettings(),
};

// ── Geofencing ───────────────────────────────────────────────────────────────────
const geofences = {
  add: (fence: Geofence): Promise<TrackerResult<Geofence>> =>
    TrackerNative.geofenceAdd(fence) as Promise<TrackerResult<Geofence>>,
  list: (): Promise<Geofence[]> =>
    TrackerNative.geofenceList() as Promise<Geofence[]>,
  get: (id: string): Promise<Geofence | null> =>
    TrackerNative.geofenceGet(id) as Promise<Geofence | null>,
  remove: (id: string): Promise<TrackerResult<boolean>> =>
    TrackerNative.geofenceRemove(id) as Promise<TrackerResult<boolean>>,
  removeAll: (): Promise<TrackerResult<number>> =>
    TrackerNative.geofenceRemoveAll() as Promise<TrackerResult<number>>,
  getEvents: (opts?: GeofenceEventsQuery): Promise<GeofenceCrossing[]> =>
    TrackerNative.geofenceGetEvents(obj(opts)) as Promise<GeofenceCrossing[]>,
  deleteEvents: (geofenceId?: string): Promise<number> =>
    TrackerNative.geofenceDeleteEvents(geofenceId),
};

// ── iOS-only namespace — rejects unsupportedOnPlatform on Android ─────────────────
const ios = {
  changePace: (isMoving: boolean): Promise<TrackerResult<void>> =>
    TrackerNative.iosChangePace(isMoving) as Promise<TrackerResult<void>>,
  requestMotion: (): Promise<MotionAuthorization> =>
    TrackerNative.iosRequestMotion() as Promise<MotionAuthorization>,
  getMotionAuthorization: (): Promise<MotionAuthorization> =>
    TrackerNative.iosGetMotionAuthorization() as Promise<MotionAuthorization>,
  requestTemporaryFullAccuracy: (
    purposeKey: string
  ): Promise<AccuracyAuthorization> =>
    TrackerNative.iosRequestTemporaryFullAccuracy(
      purposeKey
    ) as Promise<AccuracyAuthorization>,
};

// ── Android-only namespace — rejects unsupportedOnPlatform on iOS ─────────────────
const android = {
  /** The last device-integrity evaluation. Cheap — already in hand.
   *
   *  Check `waived` before rendering anything: on a debuggable build nothing was probed and the
   *  empty `findings` is not a clean bill of health. */
  integrity: async (): Promise<IntegrityReport> =>
    JSON.parse(await TrackerNative.androidIntegrity()) as IntegrityReport,
  /** Force a fresh evaluation. Reads /proc, the package list and a loopback socket — put it
   *  behind a user action or a coarse timer, never in a render path. */
  checkIntegrity: async (): Promise<IntegrityReport> =>
    JSON.parse(await TrackerNative.androidCheckIntegrity()) as IntegrityReport,
  /** The cached online-licence verdict, or null when no check has completed yet.
   *
   *  null is "not checked", NOT a refusal — do not gate your UI on it. Costs no network. */
  licenseInfo: async (): Promise<LicenseInfo | null> =>
    JSON.parse(await TrackerNative.androidLicenseInfo()) as LicenseInfo | null,
  /** Force a licence check against the server now. Fail-open: resolves the cached verdict when
   *  the network is down or the response could not be verified. */
  checkLicense: async (): Promise<LicenseInfo | null> =>
    JSON.parse(await TrackerNative.androidCheckLicense()) as LicenseInfo | null,
  hasActivityRecognition: (): Promise<boolean> =>
    TrackerNative.androidHasActivityRecognition(),
  requestActivityRecognition: (): Promise<boolean> =>
    TrackerNative.androidRequestActivityRecognition(),
  hasNotificationPermission: (): Promise<boolean> =>
    TrackerNative.androidHasNotificationPermission(),
  requestNotification: (): Promise<boolean> =>
    TrackerNative.androidRequestNotification(),
};

export const Tracker = {
  getState,
  ready,
  start,
  stop,
  getPoints,
  getCount,
  getOdometerMeters,
  getSessions,
  currentSession,
  getCurrentLocation,
  buildTrack,
  exportPolylineJson,
  exportGeoJson,
  setOsrmSnapProvider,
  clearRoadSnapProvider,
  setActiveRoute,
  isOffRoute,
  getRawFixes,
  getRawPoints,
  getDecisions,
  offerFix,
  getSensors,
  getBatteryInfo,
  onTrackerEvent,
  onLiveTrack,
  onPoints,
  onStateChange,
  onProviderStateChange,
  onBatteryChange,
  onBatteryThreshold,
  registerHeadlessTask,
  permissions,
  geofences,
  ios,
  android,
};

export default Tracker;

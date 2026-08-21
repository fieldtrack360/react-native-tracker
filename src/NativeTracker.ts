import { TurboModuleRegistry, type TurboModule } from 'react-native';

// TurboModule codegen spec — THE contract. Codegen turns this into a Swift/ObjC protocol
// and a Kotlin abstract class; a method declared here and unimplemented natively is a build error
// on both platforms (D1).
//
// Codegen constraints honored throughout: object types are concrete/inline (no generics, no
// discriminated unions in signatures); enums cross as string (normalized in the native mappers);
// TrackerResult crosses as a concrete { ok, value?, code?, message? } object;
// unbounded collections cross as JSON strings which the hand-written src/types layer
// decodes. Bounded typed shapes are inline object literals mirroring src/types.

// Phase 1 probe shape; ready()/getState() reuse it. providerState is emitted at runtime by the
// mapper as an extra untyped object key (the full union); typing it here is deferred to keep
// the codegen surface simple.
export type TrackerStateWire = {
  isReady: boolean;
  isTracking: boolean;
  motionState: string;
  currentSessionId?: string;
};

// TrackSession wire shape. The android? half is a concrete optional nested object (not a
// union), so it is codegen-representable.
export type TrackSessionWire = {
  id: string;
  startedAtMs: number;
  endedAtMs?: number;
  tag?: string;
  configSnapshot?: string;
  isOpen: boolean;
  android?: { startedAtElapsedNanos?: number };
};

// Reused inline shapes.
type PointQueryWire = {
  sessionId?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
};

type TrackOptionsWire = {
  zoom?: number;
  includeRawPoints?: boolean;
  consolidateStops?: boolean;
  stopRadiusM?: number;
  stopMinDwellSec?: number;
  smoothing?: string;
  splineSpacingM?: number;
  bezierMinAngleDeg?: number;
  bezierCutbackM?: number;
  snapToRoad?: boolean;
  snapMaxOffRoadM?: number;
  polylinePrecision?: number;
  speedBandsKmph?: number[];
  arrowMinSegmentM?: number;
  simplifyEpsilonM?: number;
};

type TrackFixWire = {
  timeMs: number;
  monotonicNanos: number;
  receivedAtMonotonicNanos: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM?: number;
  verticalAccuracyM?: number;
  speedMps: number;
  bearingDeg: number;
  hasSpeed: boolean;
  hasBearing: boolean;
  provider: string;
  isMock: boolean;
  speedAccuracyMps?: number;
  bearingAccuracyDeg?: number;
  android?: { satelliteCount?: number };
};

type GeofenceWire = {
  id: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  notifyOnEntry?: boolean;
  notifyOnExit?: boolean;
  dwellAfterMs?: number;
  android?: { onEnterEvent?: string; onExitEvent?: string };
};

type GeofenceCrossingWire = {
  geofenceId: string;
  transition: string;
  timeMs?: number;
  latitude?: number;
  longitude?: number;
  radiusM?: number;
};

export interface Spec extends TurboModule {
  // ── Lifecycle ───────────────────────────────────────────────────────────────
  // getState() — the Phase 1 probe; providerState crosses as an extra untyped key at runtime.
  getState(): Promise<TrackerStateWire>;
  // ready(config?) → TrackerResult<TrackerState>. Config crosses as a JSON string;
  // undecodable/invalid config REJECTS invalidConfig; domain failures resolve { ok:false }.
  ready(configJson?: string): Promise<{
    ok: boolean;
    value?: TrackerStateWire;
    code?: string;
    message?: string;
  }>;
  // start(tag?) → TrackerResult<TrackSession>.
  start(tag?: string): Promise<{
    ok: boolean;
    value?: TrackSessionWire;
    code?: string;
    message?: string;
  }>;
  // stop() → TrackerResult<TrackSession | null>. iOS may resolve value absent (no open session);
  // Android carries the closed session on ok:true.
  stop(): Promise<{
    ok: boolean;
    value?: TrackSessionWire;
    code?: string;
    message?: string;
  }>;

  // ── Reads ───────────────────────────────────────────────────────────────────
  // getPoints/getRawFixes/getRawPoints/getDecisions cross as JSON strings (unbounded).
  // Default page size is 500 on BOTH platforms — pass undefined through, do NOT normalize.
  getPoints(query?: PointQueryWire): Promise<string>;
  getCount(query?: PointQueryWire): Promise<number>;
  getOdometerMeters(): Promise<number>;
  getSessions(fromMs?: number, toMs?: number): Promise<TrackSessionWire[]>;
  currentSession(): Promise<TrackSessionWire | null>;

  // ── Current location ──────────────────────────────────────────────────────────
  getCurrentLocation(): Promise<{
    ok: boolean;
    value?: TrackFixWire;
    code?: string;
    message?: string;
  }>;

  // ── Plotting (JSON strings) ───────────────────────────────────────────────────
  buildTrack(
    query?: PointQueryWire,
    options?: TrackOptionsWire
  ): Promise<string>;
  exportPolylineJson(
    query?: PointQueryWire,
    options?: TrackOptionsWire
  ): Promise<string>;
  exportGeoJson(
    query?: PointQueryWire,
    options?: TrackOptionsWire
  ): Promise<string>;

  // ── Road snapping ─────────────────────────────────────────────────────────────
  // baseUrl crosses as a string; iOS parses to URL and rejects invalidConfig on unparseable.
  setOsrmSnapProvider(config: {
    baseUrl: string;
    profile?: string;
  }): Promise<void>;
  clearRoadSnapProvider(): Promise<void>;

  // ── Live surface ──────────────────────────────────────────────────────────────
  // setActiveRoute projects the live puck only; empty array clears it. (onLiveTrack is Phase 4.)
  setActiveRoute(
    points: Array<{ latitude: number; longitude: number }>
  ): Promise<void>;
  isOffRoute(): Promise<boolean>;

  // ── Diagnostics ───────────────────────────────────────────────────────────────
  getRawFixes(sessionId: string): Promise<string>;
  getRawPoints(sessionId: string): Promise<string>;
  getDecisions(
    sessionId?: string,
    limit?: number,
    offset?: number
  ): Promise<string>;
  offerFix(fix: TrackFixWire): Promise<void>;
  getSensors(): Promise<{
    motionQuality: string;
    ios?: {
      activityRecognition: boolean;
      stepCounting: boolean;
      significantLocationChange: boolean;
      regionMonitoring: boolean;
    };
    android?: {
      accelerometer: boolean;
      gyroscope: boolean;
      magnetometer: boolean;
      significantMotion: boolean;
      stepDetector: boolean;
      stepCounter: boolean;
      barometer: boolean;
      rotationVector: boolean;
    };
  }>;
  // iOS-only; Android REJECTS unsupportedOnPlatform.
  iosChangePace(
    isMoving: boolean
  ): Promise<{ ok: boolean; code?: string; message?: string }>;

  // ── Permissions ───────────────────────────────────────────────────────────────
  // Enums cross as string; the hand-written layer casts to the typed unions. BackgroundRequest is
  // a union → crosses as { kind: string }; the URL/Intent stay native.
  getPermissionTier(): Promise<string>;
  getAccuracy(): Promise<string>;
  shouldStopAsking(attempts: number): Promise<boolean>;
  requestForeground(): Promise<string>;
  requestBackground(): Promise<{ kind: string }>;
  openAppSettings(): Promise<boolean>;
  getBackgroundRequest(): Promise<{ kind: string }>;
  iosRequestMotion(): Promise<string>;
  iosGetMotionAuthorization(): Promise<string>;
  iosRequestTemporaryFullAccuracy(purposeKey: string): Promise<string>;
  // batteryInfo() — both platforms. Typed as an object literal rather than reusing DeviceSensors'
  // style because `percent`/`isCharging` are nullable. Needs no session, no permission and no
  // ready(); it is a cheap local read on both, so treat it as a refresh-rate read and use the
  // "battery" stream for a live display.
  getBatteryInfo(): Promise<{
    percent: number | null;
    isCharging: boolean | null;
    powerSource: string;
    isLow: boolean;
  }>;
  // ── Device integrity + online licence (Android-only; iOS REJECTS unsupportedOnPlatform) ──────
  // Both cross as JSON strings: IntegrityReport carries an unbounded findings[] and LicenseInfo
  // has a nullable `reason`, neither of which is worth pinning into the codegen surface.
  // androidIntegrity() is the last evaluation, already in hand and cheap; androidCheckIntegrity()
  // forces a fresh one and reads /proc, the package list and a loopback socket, so it is NOT a
  // per-frame call. androidLicenseInfo() resolves "null" when no check has completed yet —
  // that is "not checked", not a refusal.
  androidIntegrity(): Promise<string>;
  androidCheckIntegrity(): Promise<string>;
  androidLicenseInfo(): Promise<string>;
  androidCheckLicense(): Promise<string>;
  androidHasActivityRecognition(): Promise<boolean>;
  androidRequestActivityRecognition(): Promise<boolean>;
  androidHasNotificationPermission(): Promise<boolean>;
  androidRequestNotification(): Promise<boolean>;

  // ── Geofencing (flat native names; Tracker.geofences.* in the public API) ──────
  // Return types take the Android shape (TrackerResult); the iOS mapper wraps its bare Bool/Int.
  // notifyOnEntry/Exit=false or dwellAfterMs on Android → resolve { ok:false, invalidConfig }.
  geofenceAdd(fence: GeofenceWire): Promise<{
    ok: boolean;
    value?: GeofenceWire;
    code?: string;
    message?: string;
  }>;
  geofenceList(): Promise<GeofenceWire[]>;
  geofenceGet(id: string): Promise<GeofenceWire | null>;
  geofenceRemove(
    id: string
  ): Promise<{ ok: boolean; value?: boolean; code?: string; message?: string }>;
  geofenceRemoveAll(): Promise<{
    ok: boolean;
    value?: number;
    code?: string;
    message?: string;
  }>;
  // getEvents is the source of truth. opts: { geofenceId?, fromMs?, toMs?, limit?, offset? }
  // (fromMs/toMs honored on Android only).
  geofenceGetEvents(opts?: {
    geofenceId?: string;
    fromMs?: number;
    toMs?: number;
    limit?: number;
    offset?: number;
  }): Promise<GeofenceCrossingWire[]>;
  geofenceDeleteEvents(geofenceId?: string): Promise<number>;

  // ── Subscriptions (Phase 4) ──────────────────────────────────────────────────
  // NativeEventEmitter contract (addListener/removeListeners are bookkeeping no-ops). Native emits
  // one device event "TrackerEmit" with { id, payload }; src/events.ts routes by id. subscribe()
  // starts ONE native Task/Job and resolves its id; unsubscribe(id) cancels exactly that task.
  // stream ∈ "events" | "liveTrack" | "observePoints" | "providerState" | "state" | "battery";
  // arg carries the sessionId for observePoints. Buffering owned natively, never widened.
  // "battery" is both platforms (Android StateFlow<BatteryInfo>, iOS batteryState() AsyncStream);
  // each replays the current reading on attach, then one value per transition.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  subscribe(stream: string, arg?: string): Promise<number>;
  unsubscribe(id: number): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('Tracker');

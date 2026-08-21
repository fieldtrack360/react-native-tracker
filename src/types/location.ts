// Location / session / diagnostic reads. All field names are the wire vocabulary;
// the native mappers apply the renames.
import type { ActivityType, MotionState, MovementStatus } from './enums';

// A session-less "where am I" — none of the pipeline fields. Returned by getCurrentLocation.
export type TrackFix = {
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
  /** Android only. */
  android?: { satelliteCount?: number };
};

// A point that went through the pipeline into a session.
export type TrackPoint = {
  id: number;
  uuid: string;
  sessionId: string;
  timeMs: number;
  monotonicNanos: number;
  localDate: string;
  timezone: string;
  latitude: number;
  longitude: number;
  accuracyM: number;
  altitudeM?: number;
  speedMps: number;
  bearingDeg: number;
  hasSpeed: boolean;
  hasBearing: boolean;
  provider: string;
  movementStatus: MovementStatus;
  detectedActivity?: ActivityType;
  activityStartTimeMs: number;
  odometerM: number;
  batteryPct?: number;
  /** Both platforms. Null/absent is "not known", never "not charging". */
  isCharging?: boolean;
  /** Both platforms. Whether the platform flagged the underlying fix as mock. Present regardless
   *  of `mockLocationPolicy`: under `flag` (the default) a mock fix is stored WITH this set. */
  isMock?: boolean;
  extras?: string;
  acceptReason: string;
  /** iOS-only fields. */
  ios?: { isSignificantStop?: boolean };
  /** Android-only fields. */
  android?: {
    /** Bitmask of every integrity signal observed when this point was captured, `warn` and
     *  `block` alike, in the frozen bit order on `IntegritySignal`. Uploaded by the sync module
     *  as `integrity_flags`.
     *
     *  `0` is ambiguous by design: it is what a clean device, a debuggable build (layer waived)
     *  and a host with the layer disabled all report. Tell those apart by the client version,
     *  never by this number alone. Treat it as advisory input to a server-side rule — a process
     *  that has already been hooked can patch the code that produces it. */
    integrityFlags?: number;
  };
};

export type TrackSession = {
  id: string;
  startedAtMs: number;
  endedAtMs?: number;
  tag?: string;
  configSnapshot?: string;
  isOpen: boolean;
  /** Android only. */
  android?: { startedAtElapsedNanos?: number };
};

// Default page size is 500 on BOTH platforms (claimed they differ; they do not).
// Pass undefined to let each SDK apply its own default.
export type PointQuery = {
  sessionId?: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
  offset?: number;
};

// Diagnostics. RawFix/RawPoint diverge hard across platforms; the shape
// here is the wire superset — a field absent on one platform is simply absent.
export type RawFix = {
  timeMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  bearingDeg: number;
  provider: string;
  android?: {
    /** The device-integrity bitmask as it stood when this fix was RECEIVED, in the frozen bit
     *  order on `IntegritySignal`. Distinct from `TrackPoint.android.integrityFlags`, which is
     *  stamped when the point is accepted — a fix rejected by the pipeline has no TrackPoint, so
     *  this is the only place its integrity state is recorded. */
    integrityFlags?: number;
  };
  ios?: {
    id: number;
    sessionId: string;
    monotonicNanos: number;
    receivedAtMonotonicNanos: number;
    altitudeM?: number;
    verticalAccuracyM?: number;
    speedMps: number;
    hasSpeed: boolean;
    hasBearing: boolean;
    isMock: boolean;
    speedAccuracyMps?: number;
    bearingAccuracyDeg?: number;
  };
};

export type RawPoint = {
  uuid?: string;
  sessionId: string;
  timeMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  verdict: string;
  reason: string;
  isAccepted: boolean;
  ios?: {
    id: number;
    monotonicNanos: number;
    filterLatitude: number;
    filterLongitude: number;
    motionState: MotionState;
  };
  android?: {
    altitudeM?: number;
    batteryPct?: number;
    isCharging?: boolean;
    extras?: string;
    movementStatus: MovementStatus;
  };
};

export type FixDecision = {
  verdict: string;
  reason: string;
  filterLatitude: number;
  filterLongitude: number;
  sigma: number;
  threshold: number;
  distanceMovedM: number;
  effectiveSpeedMps: number;
  motionState: MotionState;
};

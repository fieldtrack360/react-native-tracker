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
  extras?: string;
  acceptReason: string;
  /** iOS-only fields. */
  ios?: { isMock?: boolean; isCharging?: boolean; isSignificantStop?: boolean };
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

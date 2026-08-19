// TrackerConfig. Crosses as a JSON string in a normalized wire shape that each
// native mapper translates. It is NOT interchangeable between platforms — enum casing differs,
// field sets differ, and three fields live in different blocks. Shared fields are flat; the
// blocks that do not line up pick one wire home; platform-only fields are namespaced.
import type {
  AccuracyProfile,
  DesiredAccuracy,
  LocationProviderType,
  MockPolicy,
  TrackingMode,
} from './enums';

export type TrackerConfig = {
  // top-level
  license?: string;
  /** default true: config passed to ready() persists. false → an existing persisted config wins
   *  in full and this object is ignored. There is no live setConfig(). */
  reset?: boolean;

  // geolocation — shared, flat
  trackingMode?: TrackingMode;
  desiredAccuracy?: DesiredAccuracy;
  accuracy?: {
    profile?: AccuracyProfile;
    maxAccuracyMeters?: number;
    recoveryTrustMeters?: number;
  };
  intervalMs?: number;
  vehicularIntervalMs?: number;
  adaptiveCadence?: boolean;
  turnBurst?: boolean;
  turnBurstIntervalMs?: number;
  navigationMode?: boolean;
  navigationIntervalMs?: number;
  oneShotTimeoutMs?: number;
  mockLocationPolicy?: MockPolicy;
  /** Shared (both GeolocationConfigs carry it). The spec placed it iOS-only; the artefact says
   *  shared. Neither platform's Builder exposes it, but it is on the data class, so the mapper
   *  sets it directly. */
  deliveryStalenessMs?: number;

  // motion — shared, flat
  activityRecognition?: boolean;
  /** Pass-through UNNORMALIZED (D7): iOS 66 / Android 75 gate different activity sources, each
   *  tuned against its own confidence distribution. */
  activityConfidenceMin?: number;
  snapshotConfidenceMin?: number;
  stopTimeoutMin?: number;
  stationaryRadiusM?: number;
  /** Wire unit is ms; the iOS mapper multiplies its seconds field by 1000 (wire→iOS rounds up). */
  motionTriggerDelayMs?: number;
  heartbeatIntervalSec?: number;
  /** iOS `persistence` block / Android `motion` block → wire `motion`. */
  persistHeartbeat?: boolean;
  bearingChangeCaptureDeg?: number;
  stopOnStationary?: boolean;
  disableStopDetection?: boolean;
  /** iOS `sensors` block / Android `motion` block → wire `motion`. Pass-through UNNORMALIZED:
   *  a real battery control on Android; on iOS a delivery throttle that saves no battery. */
  activityRecognitionIntervalMs?: number;

  // sensors — shared, flat
  useStepCorroboration?: boolean;
  useAccelerometerVeto?: boolean;
  useBarometer?: boolean;

  // persistence — shared, flat
  maxDaysToPersist?: number;
  persistRawFixes?: boolean;
  /** rename: Android `rawRingCapacity`. */
  rawFixRingCapacity?: number;
  persistRawPoints?: boolean;
  rawPointRingCapacity?: number;
  persistDecisions?: boolean;
  decisionRetentionDays?: number;
  decisionMaxRows?: number;

  // service — shared, flat
  /** Wire unit is ms; the iOS mapper multiplies its seconds field by 1000. */
  healthLoopMs?: number;
  backstopIntervalMin?: number;
  deadTrackerMovingMin?: number;
  deadTrackerStationaryMin?: number;

  ios?: {
    backgroundLocationIndicator?: boolean;
    stillConfidenceMin?: number;
    useSignificantLocationChange?: boolean;
    useStationaryFence?: boolean;
  };

  android?: {
    providerType?: LocationProviderType;
    fastestIntervalMs?: number;
    maxUpdateDelayMs?: number;
    maxFixAgeMs?: number;
    navigationFastestIntervalMs?: number;
    /** Android-only (spec omitted it entirely). */
    distanceFilterM?: number;
    maxRecords?: number;
    /** Permanently Android-only: a hardware wake-up with no iOS wake path to emulate. */
    useSignificantMotion?: boolean;
    /** Permanently Android-only: CMPedometer has no batch-latency parameter. */
    stepBatchLatencyMs?: number;
    stationaryGeofenceId?: string;
    stationaryGeofenceOnEnterEvent?: string;
    stationaryGeofenceOnExitEvent?: string;
    foregroundService?: boolean;
    stopOnTerminate?: boolean;
    startOnBoot?: boolean;
    watchdogIntervalMs?: number;
    watchdogThrottleMs?: number;
    wakeLockMs?: number;
    notificationTitle?: string;
    notificationText?: string;
    notificationChannelId?: string;
    notificationChannelName?: string;
    notificationSmallIconResName?: string;
  };
};

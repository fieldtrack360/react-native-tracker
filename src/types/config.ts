// TrackerConfig. Crosses as a JSON string in a normalized wire shape that each
// native mapper translates. It is NOT interchangeable between platforms — enum casing differs,
// field sets differ, and three fields live in different blocks. Shared fields are flat; the
// blocks that do not line up pick one wire home; platform-only fields are namespaced.
import type {
  AccuracyProfile,
  DesiredAccuracy,
  IntegrityPolicy,
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

    /** Device integrity. Android-only — iOS ships no counterpart, so this block has no `ios`
     *  twin and is namespaced rather than flat.
     *
     *  Release-only: every probe is skipped and every policy here ignored when the host app is
     *  debuggable, exactly as the licence check is waived there. You cannot exercise this layer
     *  from a debug build, and there is nothing to remember to switch off for production.
     *
     *  The SDK ships lint rules that run in YOUR build and fail `assembleRelease`: weakening
     *  `enabled`, `hooking` or `mockLocation` outside `src/debug/` is a fatal lint issue, not a
     *  warning. Put any override in a debug source set. */
    security?: {
      /** Master switch for the whole layer. Default true. */
      enabled?: boolean;
      /** Frida/Xposed detection. Default `block`. */
      hooking?: IntegrityPolicy;
      /** A visible installed package holds the mock-location app-op. Default `block`.
       *  Setting this to `block` FORCES `mockLocationPolicy` to `reject` — the SDK refuses to
       *  leave the two contradicting each other. */
      mockLocation?: IntegrityPolicy;
      /** A non-system accessibility service is enabled. Default `warn`, deliberately:
       *  accessibility services are also how blind and motor-impaired users operate a phone, and
       *  blocking on them locks those users out of your app. Services in the system image never
       *  raise a finding. */
      accessibility?: IntegrityPolicy;
      /** Developer options / ADB enabled. Default `warn`. */
      developerMode?: IntegrityPolicy;
      /** Clock tampering — auto-time off, timezone mismatch, GNSS skew. Default `warn`. */
      clock?: IntegrityPolicy;
      /** Package names exempted from the accessibility signal, e.g. your own kiosk app. */
      accessibilityAllowlist?: string[];
      /** How far the system clock may disagree with GNSS UTC before `clockSkewed`. Default
       *  120_000. */
      maxClockSkewMs?: number;
      /** Periodic re-evaluation inside the health loop. Default 900_000; `0` disables the
       *  re-check, leaving only the evaluation at ready()/start(). */
      recheckIntervalMs?: number;
    };
  };
};

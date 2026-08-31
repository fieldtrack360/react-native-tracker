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
  /** Shared. Holds a fix the heuristic gate rejected for one more fix and restores it as a corner
   *  vertex if the path bent across it — a junction's apex offers only half the turn to a
   *  backwards-looking comparison, so it used to be dropped and the drawn line ran straight across
   *  the corner. Default **true** on both (iOS SDK 1.0.5, Android 1.0.7-alpha5); `false` with
   *  `bearingChangeCaptureDeg: 40` restores the pre-1.0.5 drawing exactly. Only the heuristic
   *  gate's rejections are reconsidered — impossible speed, poor accuracy and the sigma outlier
   *  test are untouched. */
  cornerAnchorCapture?: boolean;
  stopOnStationary?: boolean;
  disableStopDetection?: boolean;
  /** iOS `sensors` block / Android `motion` block → wire `motion`. Pass-through UNNORMALIZED:
   *  a real battery control on Android; on iOS a delivery throttle that saves no battery. */
  activityRecognitionIntervalMs?: number;

  // sensors — shared, flat
  useStepCorroboration?: boolean;
  useAccelerometerVeto?: boolean;
  useBarometer?: boolean;
  /** Shared, default **true** on both. A physical wake out of stationary, so leaving a stop does
   *  not wait for a fix, a region crossing or an activity label. Pass-through UNNORMALIZED: on
   *  Android it is the hardware significant-motion sensor; on iOS (SDK 1.0.5+) it is the pedometer,
   *  with an accelerometer fallback where step counting is unavailable or Motion & Fitness was
   *  declined. Neither survives process termination — the region and significant-location paths
   *  remain what relaunches a dead process.
   *
   *  Was `android.useSignificantMotion` before iOS gained a wake path of its own; the namespaced
   *  key is gone. iOS-only tuning for the fallback lives in `ios.significantMotion*`. */
  useSignificantMotion?: boolean;
  /** Shared, default **true** on both. Yaw rate rises the moment the wheel turns, so the turn
   *  burst runs INTO a corner rather than out of it — the fix-to-fix heading comparison cannot
   *  know a turn began until a whole cadence interval after it did. Registered only while fixes
   *  report vehicular speed. */
  useGyroTurnPrediction?: boolean;

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

    // ── SDK 1.0.5 ──────────────────────────────────────────────────────────────
    /** The one setting on iOS that reduces GNSS power, applied while parked. Off by default
     *  (absent = the SDK keeps `desiredAccuracy` at all times), deliberately: a coarser fix while
     *  stationary weakens both the anchor-radius net and the pipeline's judgement of drift.
     *  Android has no counterpart — its cadence numbers reach the provider, iOS's do not. */
    stationaryAccuracy?: DesiredAccuracy;
    /** Hold spacing on the GROUND instead of in time: roughly `targetSpacingM` apart at any speed,
     *  between `minIntervalMs` and `maxIntervalMs`, instead of the fixed `intervalMs` /
     *  `vehicularIntervalMs` ladder. Default false.
     *
     *  Also the escape hatch for the ladder: with `adaptiveCadence` on, iOS `ready()` REFUSES a
     *  config where `vehicularIntervalMs` is slower than `intervalMs` — unless this is set, which
     *  derives the cadence from speed and makes the comparison moot. */
    speedAdaptiveCadence?: boolean;
    /** Target ground spacing between fixes. Default 25. Must be > 0 when `speedAdaptiveCadence`
     *  is on. */
    targetSpacingM?: number;
    /** Floor and ceiling for the derived cadence. Defaults 1_000 / 60_000. Validated only when
     *  `speedAdaptiveCadence` is on: the floor may not go below the pipeline's own burst gate
     *  (the extra fixes would be rejected rather than captured), and the ceiling may not sit below
     *  the floor. */
    minIntervalMs?: number;
    maxIntervalMs?: number;
    /** Tuning for the `useSignificantMotion` fallback, which has no Android twin: Android's is a
     *  hardware sensor with nothing to tune. `significantMotionSteps` is the pedometer threshold;
     *  the two `accel` values are the accelerometer fallback's magnitude and how long it must be
     *  sustained. */
    significantMotionSteps?: number;
    significantMotionAccelG?: number;
    significantMotionAccelSustainMs?: number;
    /** Identity of the SDK's internal stationary wake region. Deliberately NOT flat: iOS validates
     *  that the identifier carries the reserved `tracker-stationary` prefix — the prefix is what
     *  lets a region armed under a previous name be recognised and retired rather than stranded
     *  against the app-wide cap of 20 — while Android's default is `fieldtrack-stationary` and it
     *  only refuses a blank. One shared value could not be legal on both. See
     *  `android.stationaryGeofenceId` for the other half.
     *
     *  There is no `onEnterEvent` twin: iOS arms the region with `notifyOnEntry = false`, so an
     *  enter label would be config that silently does nothing. */
    stationaryGeofenceId?: string;
    stationaryGeofenceOnExitEvent?: string;
  };

  android?: {
    /** Scheme + host for uploads, e.g. `https://api.example.com`. Android-only: iOS `TrackerConfig`
     *  has no counterpart. Core never opens a socket — this exists so `TrackerSync` can resolve a
     *  RELATIVE sync url against it, which is the only way to keep one base in one place instead of
     *  a second full URL that drifts. An absolute `SyncConfig.url` always WINS; the base is a
     *  fallback, never an override. Rejected by `ready()` unless it is an absolute URL with a
     *  scheme and a host. */
    baseUrl?: string;
    providerType?: LocationProviderType;
    fastestIntervalMs?: number;
    maxUpdateDelayMs?: number;
    maxFixAgeMs?: number;
    navigationFastestIntervalMs?: number;
    /** Android-only (spec omitted it entirely). */
    distanceFilterM?: number;
    maxRecords?: number;
    /** Permanently Android-only: CMPedometer has no batch-latency parameter. */
    stepBatchLatencyMs?: number;
    /** Identity of the SDK's internal stationary wake region, Android's half. Any non-blank string;
     *  the default is `fieldtrack-stationary`. Namespaced rather than flat because iOS validates a
     *  reserved prefix its own value must carry — see `ios.stationaryGeofenceId`. Android arms the
     *  region for both directions, so unlike iOS it has an enter label. */
    stationaryGeofenceId?: string;
    stationaryGeofenceOnEnterEvent?: string;
    stationaryGeofenceOnExitEvent?: string;
    foregroundService?: boolean;
    stopOnTerminate?: boolean;
    /** Permanently Android-only: React Native has no headless JS on iOS.
     *
     *  Opts in to `registerHeadlessTask()` delivery — tracker events reaching JS in a process the
     *  OS restarted without a UI (reboot, low-memory kill). Read once per `ready()` and persisted,
     *  because `Application.onCreate` runs before any JS in such a process.
     *
     *  Ignored unless `stopOnTerminate` is also `false`: with the service torn down alongside the
     *  task there is nothing left to dispatch from. */
    enableHeadless?: boolean;
    startOnBoot?: boolean;
    watchdogIntervalMs?: number;
    watchdogThrottleMs?: number;
    wakeLockMs?: number;
    notificationTitle?: string;
    notificationText?: string;
    notificationChannelId?: string;
    notificationChannelName?: string;
    notificationSmallIconResName?: string;

    /** Diagnostic — replaces the notification's description with a live upload-queue readout while
     *  tracking (`unsynced 42 · last upload 21m ago`) and puts `syncNotificationSubText` beside the
     *  title. Android-only; iOS has no foreground-service notification to write on.
     *
     *  **Defaults false and should stay false in a shipping app.** The ongoing notification is the
     *  one piece of SDK surface a real user reads, and "unsynced 42" means nothing to them while
     *  meaning something alarming.
     *
     *  What it is for is the one test that cannot be run from inside the app: kill the host, take
     *  the device offline, wait, restore connectivity, and confirm the queue drains — without
     *  launching anything, because launching is itself a drain trigger and would invalidate the
     *  test. It needs no debugger, no adb and no server-side check.
     *
     *  Refreshed on the `watchdogIntervalMs` tick, so the number lags reality by up to that long: a
     *  count that has not moved for one tick has not necessarily stalled.
     *
     *  Requires Android SDK 1.0.7-alpha5 — earlier SDKs ignore all three keys. */
    showSyncStatusInNotification?: boolean;
    /** The subtitle shown beside `notificationTitle` while the upload status is on screen; omit for
     *  no subtitle.
     *
     *  **It never replaces `notificationTitle`.** Title, subtitle and description are three slots:
     *  your app keeps the first in both states, this owns the second and `syncNotificationText` the
     *  third, so a user glancing at the shade still sees which app holds the foreground service.
     *
     *  A blank string fails `ready()` with `invalidConfig` — omit the key instead. Ignored unless
     *  `showSyncStatusInNotification` is on. */
    syncNotificationSubText?: string;
    /** The upload-status description, with two placeholders substituted at post time: `{pending}`
     *  (rows queued and not yet uploaded, e.g. `42`) and `{age}` (how long since the last confirmed
     *  upload, e.g. `21m ago`, or `never`).
     *
     *  Both tokens are optional and may appear in any order, and an unknown `{token}` is left as
     *  itself rather than blanked, so a typo shows up on the notification instead of silently
     *  vanishing. Including neither is allowed and gives a static string — a reasonable choice for
     *  an app that wants to say "syncing" without putting a number in front of a user.
     *
     *  Defaults to `'unsynced {pending} · last upload {age}'`. Blank fails `ready()` with
     *  `invalidConfig` when `showSyncStatusInNotification` is on; ignored entirely when it is
     *  off. */
    syncNotificationText?: string;

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

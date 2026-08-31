// State, provider, sensors.
import type {
  AccuracyAuthorization,
  IntegrityPolicy,
  IntegritySignal,
  LicenseStatus,
  MotionQuality,
  MotionState,
  PermissionTier,
  PowerSource,
  TrackingMode,
} from './enums';

export type TrackerState = {
  isReady: boolean;
  isTracking: boolean;
  motionState: MotionState;
  providerState: ProviderState;
  /** null/absent when no session is open. */
  currentSessionId?: string;
  /** Android-only, and absent on iOS — its `TrackerState` carries neither field, so there is no
   *  shared half to flatten. Requires Android SDK 1.0.7-alpha5; earlier SDKs omit this too. */
  android?: {
    /** What the SDK concluded about this device's motion hardware at `ready()`.
     *
     *  Carried here rather than left to the `motionDetectionDegraded` event alone, because that
     *  event fires inside `ready()` on a replay-free stream: a host that follows the documented
     *  order (`ready()` at startup, `onStateChange` after) never sees it. This is always readable.
     *
     *  `'poor'` means motion gating is not trustworthy on this hardware and the configured
     *  `trackingMode` was overridden — see `effectiveTrackingMode`. Not purely a hardware verdict:
     *  a denied `ACTIVITY_RECOGNITION` reaches `'poor'` on a device with no significant-motion or
     *  step sensor, so it can change when a grant does. `getSensors()` is still how you ask WHICH
     *  sensors are missing; this is the one-value answer to whether it matters. */
    motionQuality: MotionQuality;
    /** The tracking mode actually in force, which is not always the one you asked for: on
     *  `motionQuality: 'poor'` the SDK rewrites it to `'continuous'`, because a motion-gated mode
     *  on hardware that cannot detect motion produces gaps the user blames on the SDK. Nothing
     *  else exposes the resolved config.
     *
     *  Read it before attributing battery use to a mode — `'continuous'` keeps the location stream
     *  registered while stationary and `'motionOnly'` does not, so the override costs materially
     *  more power than the mode it replaced. */
    effectiveTrackingMode: TrackingMode;
  };
};

// Union. Shared fields flat; the platform-only halves are absent — not `false` — on the
// other platform.
export type ProviderState = {
  permissionTier: PermissionTier;
  accuracyAuthorization: AccuracyAuthorization;
  powerSave: boolean;
  ios?: {
    locationServicesEnabled: boolean;
    significantLocationChangeAvailable: boolean;
    regionMonitoringAvailable: boolean;
  };
  android?: {
    gpsEnabled: boolean;
    networkEnabled: boolean;
    fusedAvailable: boolean;
  };
};

// Union. The half for the other platform is absent, not `false` — "no pedometer" and
// "we cannot tell" are different facts.
/** Both platforms. On Android this is the same reading the SDK stamps on every stored point, so
 *  a host display and the uploaded rows cannot disagree; iOS `TrackPoint` carries no battery, so
 *  there is nothing there to agree with.
 *
 *  `percent` and `isCharging` are nullable on purpose: null is "not known", never 0 % / not
 *  charging. Do not coalesce them to a falsy default — a `?? 0` here renders an unknown battery
 *  as a flat one; a simulator and a device with battery monitoring off both report null. `isLow`
 *  is the SDK's own derivation (percent != null && percent <= 15), carried across rather than
 *  recomputed so the threshold stays owned by one side. */
export type BatteryInfo = {
  percent: number | null;
  isCharging: boolean | null;
  powerSource: PowerSource;
  isLow: boolean;
};

export type DeviceSensors = {
  motionQuality: MotionQuality;
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
};

// ── Device integrity (Android only) ──────────────────────────────────────────────
// The second security layer beside the licence gate: can this device fabricate the location
// data it is about to send? iOS has no counterpart, so `Tracker.android.integrity()` /
// `checkIntegrity()` reject `unsupportedOnPlatform` there.

/** One raised signal. `confidence` is 0..100 and only means anything for
 *  `hookingFrameworkDetected`, which is weighted and raised at >= 60; every other signal is a
 *  boolean observation and reports 100. `detail` is the SDK's own free-text explanation — render
 *  it, do not parse it. */
export type IntegrityFinding = {
  signal: IntegritySignal;
  policy: IntegrityPolicy;
  detail: string;
  confidence: number;
};

/** The evaluation as a whole.
 *
 *  `waived` is `true` in a debuggable build, where NOTHING was probed — an empty `findings` on a
 *  waived report is not a claim that the device is clean, and must not be rendered as one. This
 *  is the only way to tell "clean" from "not evaluated", because `flags` is 0 for both.
 *
 *  `flags` is the bitmask of every signal observed, `warn` and `block` alike, in the frozen bit
 *  order documented on `IntegritySignal`. It is the same value stamped on each stored point. */
export type IntegrityReport = {
  evaluatedAtMs: number;
  waived: boolean;
  findings: IntegrityFinding[];
  /** true when at least one finding carries policy `block` — ready()/start() refuse and an
   *  in-flight session is ended with `deviceIntegrityBlocked`. */
  blocked: boolean;
  flags: number;
  blockingSignals: IntegritySignal[];
};

// ── Online licence check (Android v1.0.1-alpha-08+) ──────────────────────────────

/** The licence server's verdict, delivered by `TrackerEvent.licenseChecked` and readable at any
 *  time via `Tracker.android.licenseInfo()`.
 *
 *  Branch on `status`, NOT on `valid` — `valid` is the server's own coarse flag and collapses
 *  distinctions the status keeps. A null result from `licenseInfo()` means "not checked yet",
 *  which is NOT a refusal.
 *
 *  Silence is not success: no event is emitted when the network failed or the response could not
 *  be verified. The check is fail-open by design, so a server outage never stops a paying
 *  customer — which also means the absence of a verdict tells you nothing. */
export type LicenseInfo = {
  status: LicenseStatus;
  /** The server's own flag. Branch on `status` instead. */
  valid: boolean;
  /** The application id the licence was issued against. */
  packageName: string;
  /** ISO-8601, the server's clock, verbatim — not reparsed or localised by the bridge. */
  checkedAt: string;
  /** How long this answer may keep being trusted. */
  ttlSeconds: number;
  /** The server's explanation, when it sent one. */
  reason: string | null;
  /** true for a stored verdict. Re-verified on read, so no less trustworthy than a fresh one. */
  fromCache: boolean;
};

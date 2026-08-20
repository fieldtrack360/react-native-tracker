// Wire enum vocabularies. One vocabulary, lower camel, normalized in the native
// mappers. These are string unions so an exhaustive `switch` is checkable in TS.

export type PermissionTier = 'none' | 'foreground' | 'always';
export type AccuracyAuthorization = 'approximate' | 'precise';
export type MotionState = 'stopped' | 'moving' | 'stopPending' | 'stationary';
export type ActivityType =
  | 'inVehicle'
  | 'onBicycle'
  | 'onFoot'
  | 'walking'
  | 'running'
  | 'still'
  | 'tilting'
  | 'unknown';
export type MotionQuality = 'full' | 'degraded' | 'poor';
export type MovementStatus = 'steady' | 'moving';
export type Smoothing = 'none' | 'spline' | 'bezier';
export type TrackingMode = 'continuous' | 'adaptive' | 'motionOnly';
export type GeofenceTransition = 'enter' | 'exit' | 'dwell'; // 'dwell' is iOS-only at runtime
export type MockPolicy = 'flag' | 'reject' | 'allow';
export type DesiredAccuracy = 'high' | 'balanced' | 'low';
export type AccuracyProfile = 'strict' | 'balanced' | 'relaxed' | 'custom';
/** `gap` is iOS-only: an unobserved span (force-quit, then movement) that the renderer draws
 *  dashed and that adds nothing to the track's distance. See TrackerEvent.trackingGap. */
export type SegmentType = 'travel' | 'stop' | 'gap';
export type CameraFollowMode = 'none' | 'follow' | 'followBearing';
/** iOS only. */
export type MotionAuthorization =
  'notDetermined' | 'denied' | 'restricted' | 'authorized';
/** Android provider selection (config.android.*). */
export type LocationProviderType =
  'fused' | 'gpsOnly' | 'networkOnly' | 'passive';

/** Android only — the device-integrity layer. What the SDK does when a signal fires: report
 *  nothing, report and stamp the point, or additionally refuse ready()/start() and end an
 *  in-flight session. */
export type IntegrityPolicy = 'allow' | 'warn' | 'block';

/** Android only — the ten integrity signals, in the frozen bit order used by
 *  `TrackPoint.android.integrityFlags` (accessibilityServiceActive = 1, developerModeEnabled = 2,
 *  adbEnabled = 4, hookingFrameworkDetected = 8, debuggerAttached = 16, autoTimeDisabled = 32,
 *  timezoneMismatch = 64, mockLocationAppSelected = 128, mockLocationFix = 256,
 *  clockSkewed = 512). */
export type IntegritySignal =
  | 'accessibilityServiceActive'
  | 'developerModeEnabled'
  | 'adbEnabled'
  | 'hookingFrameworkDetected'
  | 'debuggerAttached'
  | 'autoTimeDisabled'
  | 'timezoneMismatch'
  | 'mockLocationAppSelected'
  | 'mockLocationFix'
  | 'clockSkewed';

/** Android only (v1.0.1-alpha-08+) — the online licence verdict. `unrecognised` is what the SDK
 *  reports for a status string it does not know, so a newer server never breaks an older client.
 *  iOS has no equivalent; its `licenseDeactivated` event carries an untyped `status` string. */
export type LicenseStatus =
  | 'active'
  | 'revoked'
  | 'expired'
  | 'unknownKey'
  | 'invalidKey'
  | 'packageMismatch'
  | 'sdkMismatch'
  | 'unrecognised';

/** The charger the device is on, from `BatteryInfo.powerSource`; `unknown` is the SDK default
 *  and also what a device reports when it cannot tell. `none` means "on battery", which is NOT
 *  the same as `unknown`. Both platforms, but iOS never reports `ac`, `usb` or `wireless` — a
 *  charging iPhone reads `unknown`, so do not infer "on battery" from anything but `none`. */
export type PowerSource =
  'none' | 'ac' | 'usb' | 'wireless' | 'dock' | 'unknown';

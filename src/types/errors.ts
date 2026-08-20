// Errors and result envelope.

// The union of both platforms — 29 codes. Type `code` as this union; render verbatim, never
// rewrite. `fgsStartRefused` is in the iOS enum but never emitted there — do not branch on it.
//
// The five `license*` codes below `licenseBundleMismatch` come from the ONLINE licence check
// added in Android v1.0.1-alpha-08 (verified against the alpha-08 `ErrorCode` enum, 29 constants).
// They have no iOS counterpart: iOS 1.0.0 ships only the offline gate plus its own
// `licenseDeactivated` event. Only `licenseRevoked` and `licenseExpired` STOP tracking; the other
// three are diagnostics about the vendor's own ledger and tracking continues.
//
// `deviceIntegrityBlocked` is Android-only and arrives from the integrity layer added in
// v1.0.1-alpha-05. Note it is absent from the guide's own ErrorCode table while being used in its
// integrity and troubleshooting sections; it is included here on that usage. It is release-only —
// the whole integrity layer is waived on debuggable installs — and it ENDS an in-flight session,
// so a host must treat it as a stop, not a warning.
export type ErrorCode =
  // shared (17)
  | 'notReady'
  | 'permissionDenied'
  | 'backgroundPermissionMissing'
  | 'coarseOnly'
  | 'locationDisabled'
  | 'fgsStartRefused'
  | 'fixTimeout'
  | 'storageFull'
  | 'storageReset'
  | 'trackerDead'
  | 'invalidConfig'
  | 'motionDetectionDegraded'
  | 'snapUnavailable'
  | 'internalError'
  | 'licenseMissing'
  | 'licenseInvalid'
  | 'licenseBundleMismatch'
  // Android-only (12)
  | 'playServicesUnavailable'
  | 'notificationHidden'
  | 'noActivity'
  | 'geofenceRegistrationFailed'
  | 'geofenceRemovalFailed'
  | 'geofenceLimitReached'
  | 'deviceIntegrityBlocked'
  // Online licence check (Android v1.0.1-alpha-08+). These two END tracking:
  | 'licenseRevoked'
  | 'licenseExpired'
  // ...these three are diagnostic only; tracking continues:
  | 'licenseUnknown'
  | 'licensePackageMismatch'
  | 'licenseSdkMismatch';

// Domain failures resolve as a value, never a rejected Promise. Promises reject only for
// bridge faults (bad args, undecodable JSON, calls before init, unsupportedOnPlatform).
export type TrackerResult<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

// Reason vocabularies are stable API, not free text — render verbatim. The Android set includes
// `indoorArrival`, which has no iOS counterpart; the exact string values are captured at runtime
// (neither surface emits enum literals), so this stays a plain string until confirmed.
export type DecisionReason = string;

// Errors and result envelope.

// The union of both platforms — 33 codes. Type `code` as this union; render verbatim, never
// rewrite. `fgsStartRefused` is in the iOS enum but never emitted there — do not branch on it.
//
// The three `geofence*` codes were Android-only until iOS SDK 1.0.5 added them to its own
// `ErrorCode`; they are shared from that pin on. A host on an older iOS SDK simply never sees
// them from iOS — the same "in the enum, never emitted" shape as `fgsStartRefused`.
//
// `licenseRevoked` / `licenseExpired` come from an ONLINE licence check and are on BOTH platforms:
// Android since v1.0.1-alpha-08, iOS since the 1.0.0 rebuild at commit b4afe5ba ("licences come
// from the server, and revocation now sticks"). Both STOP tracking, and on iOS `start()` stays
// refused until the server reports the licence active again. iOS ALSO reports the same two through
// its `licenseDeactivated` event, which carries the admin's note; Android reports them through
// `licenseChecked`. The remaining three online codes are Android-only and are diagnostics about the
// vendor's own ledger — tracking continues.
//
// `deviceIntegrityBlocked` is Android-only and arrives from the integrity layer added in
// v1.0.1-alpha-05. Note it is absent from the guide's own ErrorCode table while being used in its
// integrity and troubleshooting sections; it is included here on that usage. It is release-only —
// the whole integrity layer is waived on a debuggable install — and it ENDS an in-flight session,
// so a host must treat it as a stop, not a warning.
export type ErrorCode =
  // shared (22)
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
  // Online licence check. BOTH platforms, and both END tracking:
  | 'licenseRevoked'
  | 'licenseExpired'
  // Geofencing. Shared as of iOS SDK 1.0.5 (Android since the first release).
  | 'geofenceRegistrationFailed'
  | 'geofenceRemovalFailed'
  | 'geofenceLimitReached'
  // iOS-only (3). getCurrentLocation() used to answer every failure with `fixTimeout`; the 1.0.0
  // rebuild at commit a6a19731 split out the three that must NOT be retried. Android's one-shot
  // still reports only notReady / permissionDenied / locationDisabled / fixTimeout.
  /** A one-shot capture is already in flight. Do NOT retry — await the one running. */
  | 'oneShotBusy'
  /** Three consecutive one-shot failures opened the circuit. Do NOT retry — further calls fail
   *  immediately until location authorization is granted, location services come back, or a
   *  session starts. */
  | 'oneShotCircuitOpen'
  /** A fix arrived and was refused at the mapping boundary — mock-location policy or the staleness
   *  ceiling. This happens BEFORE the pipeline, so no decision row is written and the message is
   *  the only account there is. */
  | 'fixRejected'
  // iOS-only (1), as of SDK 1.0.6.
  /** A `BGTaskScheduler` launch handler could not be installed — either the
   *  identifier is missing from `BGTaskSchedulerPermittedIdentifiers`, or the registration ran
   *  after launch had finished. The message distinguishes the two.
   *
   *  **Not a tracking failure.** What is lost is the 15-minute background backstop, which has
   *  always been advisory; the continuous stream and the relaunch primitives do not go through
   *  `BGTaskScheduler`. In a DEBUG build `ready()` fails outright so the mistake cannot reach a
   *  release; release builds never fail for it.
   *
   *  This package registers the handlers for you in `TrackerLaunch.ready()` — see the iOS
   *  AppDelegate step in the README. Seeing this code means that call is missing or ran late. */
  | 'backgroundTasksNotRegistered'
  // Android-only (7)
  | 'playServicesUnavailable'
  | 'notificationHidden'
  | 'noActivity'
  | 'deviceIntegrityBlocked'
  // ...these three online-check codes are diagnostic only; tracking continues:
  | 'licenseUnknown'
  | 'licensePackageMismatch'
  | 'licenseSdkMismatch';

// Domain failures resolve as a value, never a rejected Promise. Promises reject only for
// bridge faults (bad args, undecodable JSON, calls before init, unsupportedOnPlatform).
export type TrackerResult<T> =
  { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

// Reason vocabularies are stable API, not free text — render verbatim, never parse or rewrite.
// The Android guide (§16.4) now publishes its whole `Reasons` set and calls changing one a
// breaking change; the values are DISPLAY strings with spaces and mixed case, not enum literals:
//
//   Init · Resume · Burst · NLP Fallback · Impossible Speed · Poor Accuracy ·
//   Recovery Confirmed · Recovery Reset · Recovery Held · Sigma Gate Outlier ·
//   Sigma Forced Reset · Sigma Junk Fail · Vehicular · Moving/Walking · Indoor Arrival ·
//   Bearing Change · Corner Anchor · Arrival · Stationary Recovery · Blackout Arrival ·
//   Walk Arrival · 15-Min Heartbeat · Origin Set · Departure Held · Drift Suppressed ·
//   HeartBeat Skipped · Stillness Veto · Accuracy Bridge · Heuristic Gate · Session Closed ·
//   Mock Location · Invalid Coordinates · Stale Fix · Reboot Boundary · Out Of Order
//
// `Accuracy Bridge` is new in Android SDK 1.0.10 and is a STORE reason, not a reject one: the run
// of unconditional accuracy rejections had gone on long enough (`maxHardRejectRun`, 4) that
// dropping one more would draw a straight chord across the route, so a coarse-but-reachable fix
// is admitted instead. A stretch carrying it is genuinely imprecise — distinguishable in the
// decision log precisely so it is never mistaken for a stretch the device measured well.
// `Corner Anchor` and `Stillness Veto` were already in 1.0.9 and are listed here for the first
// time; neither is new behaviour at this pin.
//
// Deliberately still `string`, not a union of those 35: it is the ANDROID vocabulary. The iOS SDK
// documents its own set as equally stable but does not publish it, and `Indoor Arrival` is known
// to have no iOS counterpart — so closing the union here would make a legitimate iOS reason a type
// error. Switch on it with a default arm and render whatever arrives.
export type DecisionReason = string;

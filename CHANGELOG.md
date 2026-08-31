# Changelog

All notable changes to `@fieldtrack360/react-native-tracker` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries cover the **published plugin** only — the `example/` app is not part of the package and its
changes are not listed. Each release also pins the native SDKs it is built against; those pins are
listed because upgrading the plugin upgrades them.

## [Unreleased]

Pinned native SDKs: iOS **1.0.5** (`e9000e4`) · Android **1.0.7-alpha5**

### Added

- **`android.showSyncStatusInNotification`, `android.syncNotificationSubText`,
  `android.syncNotificationText`** — the foreground-service notification can carry a live
  upload-queue readout: `{pending}` rows not yet uploaded and `{age}` since the last confirmed
  upload, refreshed on the `watchdogIntervalMs` tick. Off by default and meant to stay off in a
  shipping app; it exists for the offline-drain test that cannot be run from inside the app,
  because launching the app is itself a drain trigger. `notificationTitle` is never replaced —
  the status occupies the subtitle and description only. A blank `syncNotificationSubText`, or a
  blank `syncNotificationText` while the flag is on, fails `ready()` with `invalidConfig`.
- **`TrackerState.android.motionQuality` / `.effectiveTrackingMode`** — Android only, absent on
  iOS. `effectiveTrackingMode` is the mode actually in force, which is not always the configured
  one: on `motionQuality: 'poor'` the SDK rewrites the mode to `'continuous'`, and nothing else
  exposed the resolved config. The `motionDetectionDegraded` event announced the same thing but is
  emitted inside `ready()` on a replay-free stream, so a host collecting afterwards never saw it.

### Changed

- Native SDK pins: Android `1.0.7-alpha4` → `1.0.7-alpha5`. iOS stays at `1.0.5` (`e9000e4`).
  The Android bump also carries offline-sync and service-wakeup fixes and a motion-hardware
  fallback, none of which change the plugin's wire surface.

## [1.0.6] — 2026-08-27

Pinned native SDKs: iOS **1.0.5** (`e9000e4`) · Android **1.0.7-alpha4**

The geofence surface stops being two different APIs. Every gap this release closes was an iOS
limitation the wire had frozen into its own shape — event labels, time windows, a delete that could
not count — and all three are native now.

### Changed — action required

- **`Geofence.android.onEnterEvent` / `.onExitEvent` are now flat `onEnterEvent` / `onExitEvent`.**
  iOS `1.0.5` gave fences the same two fields, so they stop being an Android-only namespace. The
  old sub-object is **removed, not deprecated**, and is not read as a fallback: a fence still
  passing `android: { … }` loses its labels silently and Android falls back to its derived
  `<id>_enter` / `<id>_exit`. Move the two keys up one level.

  They stay optional on both, and read back differently: iOS omits a label it was not given,
  Android always returns one because its native model refuses null.
- **`config.android.useSignificantMotion` is now flat `useSignificantMotion`**, for the same reason:
  iOS `1.0.5` has a physical wake out of stationary of its own. Unnormalized — Android's is the
  hardware significant-motion sensor, iOS's is the pedometer with an accelerometer fallback — and
  the iOS fallback's thresholds live in `ios.significantMotion*`. Default **true** on both.

Both are wire-key removals in a patch release. Nothing else in the plugin API moves.

### Added

- **`GeofenceCrossing.eventName`** — the fence's label for the direction that fired, on stored
  crossings from `getEvents()` and on live geofence events. Both platforms carried it natively and
  the wire dropped it; iOS leaves it absent on a `dwell` (a dwell is not a crossing) and on a fence
  added without labels.
- **`getEvents({ fromMs, toMs })` is honoured on iOS.** The window reached Android and was dropped
  on the floor on iOS, which had no native parameter for it until `1.0.5`. A host filtering by time
  was reading unfiltered results on one platform.
- **`deleteEvents(geofenceId?, window?)`** takes the same `{ fromMs, toMs }` window, so a retention
  sweep can prune a range instead of everything. Both arguments fold into one object on the wire.
- **Config keys for the pinned SDKs' new behaviour.** Flat, both platforms: `cornerAnchorCapture`,
  `useGyroTurnPrediction`, `useSignificantMotion`. Under `ios`, with no Android counterpart:
  `stationaryAccuracy`, `speedAdaptiveCadence` + `targetSpacingM` / `minIntervalMs` /
  `maxIntervalMs`, `significantMotionSteps` / `significantMotionAccelG` /
  `significantMotionAccelSustainMs`, and `stationaryGeofenceId` / `stationaryGeofenceOnExitEvent`.

  The stationary fence's identity is deliberately **not** flat: iOS validates that the identifier
  carries the reserved `tracker-stationary` prefix, Android's default carries a different one and
  it only refuses a blank, so no single value would be legal on both. `android.stationaryGeofenceId`
  and its two labels are unchanged; iOS has no enter label, because the region is armed
  `notifyOnEntry = false`.

### Fixed

- **`deleteEvents()` no longer over-reports on iOS.** The count came from a separate read taken
  before the delete, so a crossing landing between the two was counted and not deleted. The native
  delete returns its own count as of iOS `1.0.5`.
- **`geofences.get(id)` on iOS reads the one fence** instead of listing all of them and filtering.
- **The Android pin actually moves to `1.0.7-alpha4`.** `1.0.5` announced the bump in its changelog
  but left `package.json` on `1.0.7-alpha2`, so the published plugin built against the older SDK.

### Changed

- Native SDK pins: iOS tag `1.0.4` → `1.0.5` (`a09f653` → `e9000e4`, all five XCFramework checksums
  re-recorded); Android `1.0.7-alpha2` → `1.0.7-alpha4`.
- `ErrorCode`: `geofenceRegistrationFailed`, `geofenceRemovalFailed` and `geofenceLimitReached`
  move from Android-only to shared — the iOS enum gained all three. Documentation only; the union
  is unchanged, so no host code has to change.
- iOS behaviour that arrives with the pin and needs no config: bearing capture at 30° (was 40°),
  corner anchors, gyroscope turn prediction and the physical stationary wake, all on by default —
  Android's `1.0.7-alpha4` defaults match. Tracks carry more points through curves and junctions.
  Set `cornerAnchorCapture: false` with `bearingChangeCaptureDeg: 40` to restore the old drawing.
- **iOS `ready()` now refuses an inverted cadence ladder.** `adaptiveCadence` on with
  `vehicularIntervalMs` slower than `intervalMs` resolves `{ ok:false, code:'invalidConfig' }`
  naming both values, and configures nothing — sampling fastest while parked was silent before.
  A host that lowered `intervalMs` below the 12 s vehicular default must lower
  `vehicularIntervalMs` to match, or set `ios.speedAdaptiveCadence` and let speed decide.

## [1.0.5] — 2026-08-27

Pinned native SDKs: iOS **1.0.4** (`a09f653`) · Android **1.0.7-alpha4**

### Changed

- Native SDK pins: Android `1.0.7-alpha2` → `1.0.7-alpha4`. iOS stays at `1.0.4` (`a09f653`,
  checksums unchanged). No plugin API, wire-shape or config-key change.

## [1.0.4] — 2026-08-26

Pinned native SDKs: iOS **1.0.4** (`a09f653`) · Android **1.0.7-alpha2**

### Changed

- Native SDK pins: Android `1.0.7-alpha1` → `1.0.7-alpha2`; iOS tag `1.0.2` → `1.0.4`
  (`9a5e9ce` → `a09f653`, all five XCFramework checksums re-recorded). No plugin API, wire-shape or
  config-key change.

## [1.0.3] — 2026-08-25

Pinned native SDKs: iOS **1.0.2** (`9a5e9ce`) · Android **1.0.7-alpha1**

### Added

- **Android Headless JS event delivery.** `registerHeadlessTask(task)` receives tracker events in a
  process the OS restarted **without a UI** — after a reboot or a low-memory kill — where
  `onTrackerEvent()` has no live subscriber to deliver to. The handler gets
  `{ name, params }`, where `params` is the same wire `TrackerEvent` `onTrackerEvent()` delivers and
  `name` is its `type` lifted out. Exported from the package root and on the `Tracker` object;
  `HEADLESS_TASK_KEY` and the `HeadlessEvent` type are exported alongside it.
  - New config flag `android.enableHeadless`. Requires `android.stopOnTerminate: false` — with the
    service torn down alongside the task there is nothing left to dispatch from.
  - `TrackerLaunch.ready(this)` in `MainApplication.onCreate` becomes **required** (it is optional
    otherwise): it is the only callback that runs in a UI-less process, and the event stream has
    `replay 0`.
  - `registerHeadlessTask()` must sit at the top level of `index.js` — a headless boot evaluates the
    bundle root and nothing else.
  - Native: `TrackerHeadlessDispatcher` (process-level collector, 64-deep drop-oldest queue),
    `TrackerHeadlessService` (`HeadlessJsTaskService`, 60 s task timeout), `TrackerHeadlessPrefs`
    (flags mirrored to `SharedPreferences`, since `Application.onCreate` runs before any JS). The
    service is declared in the library manifest, `exported="false"`.
  - Delivery is best-effort: suppressed while the app is on screen (the foreground path already
    delivers the same object), never after a force-stop, and a service start refused by Android's
    background-start rule leaves events queued for the next accepted start. SDK storage
    (`getPoints()`, `geofences.getEvents()`) remains the source of truth.
  - iOS: `registerHeadlessTask()` is a no-op and `enableHeadless` is ignored — React Native has no
    headless JS there.

### Changed

- Native SDK pins: Android `1.0.4` → `1.0.7-alpha1`; iOS tag `1.0.1` → `1.0.2` (all five
  XCFramework checksums updated).
- README: new "Headless events — Android only" section, `registerHeadlessTask` API row,
  `enableHeadless` config key, two headless troubleshooting rows, and an updated sync-vocabulary
  note.

### Fixed

- **Android sync events: `NetworkAvailable` no longer reaches JS.** Android SDK 1.0.6 added a
  `SyncEvent.NetworkAvailable` case that has no iOS counterpart. It is dropped in the bridge
  (`SyncMappers.syncEventMap` now returns `WritableMap?`; `subscribeSyncEvents` emits non-null only)
  rather than given a JS event type iOS could never emit. The drain it announces still reports its
  outcome through `httpResponse`. No wire-shape change — Android continues to forward `httpResponse`
  only.

## [1.0.2] — 2026-08-24

Pinned native SDKs: iOS **1.0.1** (`1ffc672`) · Android **1.0.4**

### Added

- **`sync.extraParams`** — a `Record<string, SyncParamValue>` merged into the **top level** of every
  upload body, beside the `location` array and before it, in insertion order. For what belongs to
  the request rather than to any point (tenant id, device label, API version) and that a header
  cannot carry. Static config, like `headers`. With none set the body is byte-identical to a build
  without the field, so it is additive and needs no backend change.
- **`SyncParamValue`** type — any JSON value; both SDKs keep the type on the wire (a number stays a
  number, nothing is stringified).

### Changed

- Native SDK pins: Android `1.0.1` → `1.0.4`; iOS tag `1.0.0` → `1.0.1`.

### Known platform divergence

- `location` is reserved (it is the batch itself) and both SDKs refuse it.
- `null` does not survive both crossings: iOS encodes JSON `null`; the Android SDK has no null
  value, so the Android mapper **drops** a null-valued key, and rejects a null **inside an array**
  as `invalidConfig` rather than renumbering the elements. Send a sentinel if the key must reach
  both bodies.
- Android caps nesting at 10 levels and rejects an unserializable value at `configure()` time,
  naming the key.

## [1.0.1] — 2026-08-21

Pinned native SDKs: iOS **1.0.0** (`b4afe5b`) · Android **1.0.1**

### Added

- **Battery monitoring.** `getBatteryInfo()` one-shot read, `onBatteryChange(cb)` stream, and
  `onBatteryThreshold(cb)` — a threshold-crossing wrapper over `onBatteryChange` emitting
  `BatteryThresholdCrossing`. Both platforms.
- **Android device integrity and license verification.** `Tracker.android.integrity()`,
  `checkIntegrity()`, `licenseInfo()`, `checkLicense()`, plus the `IntegrityPolicy`,
  `IntegritySignal`, `IntegrityFinding`, `IntegrityReport`, `LicenseStatus` and `LicenseInfo` types.
  New `android.security` config block (`enabled`, per-signal policies for `hooking`,
  `mockLocation`, `accessibility`, `developerMode`, `clock`, plus `accessibilityAllowlist`,
  `maxClockSkewMs`, `recheckIntervalMs`). Android-only — iOS ships no counterpart. Release-only:
  every probe is skipped on a debuggable host.
- **`'gap'` segment type** — `SegmentType` is now `'travel' | 'stop' | 'gap'`.
- **iOS tracking events and battery info** brought up to the Android surface.
- New error codes: `licenseRevoked`, `licenseExpired` (both platforms, both end tracking), plus the
  Android-only `oneShotBusy`, `oneShotCircuitOpen`, `fixRejected`, `deviceIntegrityBlocked`,
  `licenseUnknown`, `licensePackageMismatch`, `licenseSdkMismatch`.
- `android.baseUrl` config field (scheme + host for uploads; Android-only).
- Android-only `forbidden` sync result case — a 401 teardown, deliberately not folded onto
  `authExpired`; recover by calling `configure()` again with a credential allowed to write that
  endpoint.

### Changed

- **`onSyncEvent` is now cross-platform.** Both SDKs expose a sync event stream, so the function
  moved to `TrackerSync.onSyncEvent`. `TrackerSync.ios.onSyncEvent` remains as a **deprecated**
  alias for the same function. Vocabulary still diverges: `uploaded` / `retryScheduled` /
  `authExpired` are iOS-only; Android replays the last exchange to a new subscriber, iOS replays
  nothing.
- **Android toolchain floors lowered** so a stock React Native 0.81 host consumes the AARs without
  upgrading anything: Kotlin `2.4.10` → `2.1.20`, `compileSdk` `37` → `36` (Expo config plugin and
  `android/build.gradle` both). OkHttp pinned to `5.1.0` and `play-services-maps` to `19.2.0` to
  match the SDK's own pins rather than override them.
- Licence tokens are now injected from the environment at build time; the Expo config plugin's
  `iosLicense` / `androidLicense` props and the `TrackerLicense` Info.plist / manifest `meta-data`
  writers were **removed**. Pass the token via `TrackerConfig.license` from JS, or declare the key
  yourself.

### Removed

- `getCurrentLocation(options)` no longer takes options — the `feedIngestor` option was removed and
  the signature is now `getCurrentLocation(): Promise<TrackerResult<TrackFix>>`.
- `Tracker.ios.exportFixture(sessionId, name)`.

## [1.0.0] — 2026-08-19

Pinned native SDKs: iOS **1.0.0** · Android **1.0.0**

### Added

- Initial release. Background location tracking for React Native (CLI), New Architecture only
  (TurboModule + Fabric): lifecycle (`ready` / `start` / `stop`), sessions and points, geofences,
  activity and provider state, the upload (sync) engine, two native map components
  (`TrackMapView`, `LiveTrackMapView`), permissions, diagnostics, and an Expo config plugin.

[Unreleased]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.5...HEAD
[1.0.6]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/fieldtrack360/react-native-tracker/releases/tag/v1.0.0

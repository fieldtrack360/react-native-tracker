# Changelog

All notable changes to `@fieldtrack360/react-native-tracker` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this package follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries cover the **published plugin** only — the `example/` app is not part of the package and its
changes are not listed. Each release also pins the native SDKs it is built against; those pins are
listed because upgrading the plugin upgrades them.

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

[Unreleased]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/fieldtrack360/react-native-tracker/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/fieldtrack360/react-native-tracker/releases/tag/v1.0.0

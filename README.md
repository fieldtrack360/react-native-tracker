# @fieldtrack360/react-native-tracker

**FieldTrack360 Tracker for React Native** — a background location-tracking plugin with two native
map components, built for React Native (CLI). New Architecture only — TurboModule + Fabric.

One TypeScript API gives your app the complete capture pipeline, identical on iOS and Android: a
background location session that survives app suspension and reboot, motion/activity-aware
cadence, a stored point history with an odometer, geofences, road-snapped track plotting, native
map rendering, and an upload (sync) engine.

> **Primary target: React Native (CLI).** Expo is supported through the bundled config plugin
> (see [Expo](#expo)).

---

## Table of contents

- [Overview](#overview)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Android setup](#android-setup)
  - [iOS setup](#ios-setup)
  - [Expo](#expo)
- [Licensing](#licensing)
- [Initialization and ready state](#initialization-and-ready-state)
- [Permissions](#permissions)
- [Location](#location)
- [Sessions](#sessions)
- [MapView](#mapview)
- [Geofences](#geofences)
- [Sync](#sync)
- [Complete API reference](#complete-api-reference)
- [Types](#types)
- [End-to-end example](#end-to-end-example)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)
- [Security](#security)
- [License](#license)

---

## Overview

| | |
|---|---|
| Package | `@fieldtrack360/react-native-tracker` |
| Platforms | iOS 17+, Android API 26+ |
| Architecture | New Architecture only (TurboModule + Fabric codegen) |

---

## Requirements

| | Minimum | Notes |
|---|---|---|
| React Native | **0.81+** with New Architecture enabled | Developed and verified against RN **0.87** |
| Node | 22+ (`.nvmrc` pins v24) | Needed for the iOS framework fetch on install |
| iOS | **17.0** | The vendored XCFrameworks target `arm64-apple-ios17.0` and are not weak-linked |
| Xcode / CocoaPods | Xcode 26+, CocoaPods 1.15+ | |
| Android | **minSdk 26**, **compileSdk 36**, target 36 | The config plugin raises `minSdkVersion`/`compileSdkVersion` for you; it never lowers them |
| Kotlin | **2.0+** (verified: 2.1.20) | React Native's own pin is enough — no override needed |
| AGP | **8.x+** (verified: 8.11) | |
| JDK | 17 (11+ works) | |
| Maps | A Google Maps API key — **optional**, and only on Android | Needed solely to render `<TrackMapView>` / `<LiveTrackMapView>`. Tracking, sessions, geofences and sync need no key |

None of these floors is adjustable from the bridge.

---

## Installation

```sh
npm install @fieldtrack360/react-native-tracker
# or
yarn add @fieldtrack360/react-native-tracker
```

Then install the pods (iOS only):

```sh
cd ios && pod install
```

Nothing else to run by hand — a `postinstall` script fetches and checksum-verifies the iOS
XCFrameworks into the package's `ios/Frameworks/` before `pod install` needs them. If that
directory ends up empty, see [Troubleshooting → Installation](#installation-1).

The rest of this section is the per-platform host setup: [Android](#android-setup),
[iOS](#ios-setup), [Expo](#expo).

### Android setup

**1 — Google Maps API key — only if you use the map components.** `<TrackMapView>` and
`<LiveTrackMapView>` render through Google Maps on Android and need a key; every other part of the
SDK (capture, sessions, geofences, plotting exports, sync) works without one, so skip this step
entirely if your app does not mount either component. In
`android/app/src/main/AndroidManifest.xml`:

```xml
<meta-data android:name="com.google.android.geo.API_KEY" android:value="${MAPS_API_KEY}" />
```

and fill the placeholder from a gitignored file in `android/app/build.gradle`:

```groovy
def localProperties = new Properties()
def localPropertiesFile = rootProject.file("local.properties")
if (localPropertiesFile.exists()) {
    localPropertiesFile.withInputStream { localProperties.load(it) }
}
def mapsApiKey = localProperties.getProperty("MAPS_API_KEY", "")

android {
    defaultConfig {
        manifestPlaceholders["MAPS_API_KEY"] = mapsApiKey
    }
}
```

Without the `<meta-data>` element the map surface comes up **blank at runtime** with only a
logcat line to explain it.

**2 — (Optional) early init.** Android has no launch-window trap, but the SDK recommends
`Application.onCreate` timing for filter-state restore:

```kotlin
// android/app/src/main/java/.../MainApplication.kt
import com.fieldtrack360.tracker.TrackerLaunch

override fun onCreate() {
    super.onCreate()
    TrackerLaunch.ready(this)   // optional
    loadReactNative(this)
}
```

`TrackerLaunch.ready(context)` is fire-and-forget with SDK defaults; a later `Tracker.ready(config)`
from JS re-applies real config and is safe.

**Nothing else.** The foreground service, the boot receiver, the activity/geofence receivers and
every permission merge in from the AAR manifest — see [Permissions](#permissions).

### iOS setup

**1 — Call the launch hook in `AppDelegate`.** `Tracker.shared.ready()` reaches
`BGTaskScheduler.register(...)`, which Apple requires *before* `didFinishLaunching` returns — and
React Native starts JS only after that returns. So one native line is unavoidable:

```swift
// ios/<App>/AppDelegate.swift
import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import Tracker        

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    TrackerLaunch.ready()     // must be first, and native — a JS-driven ready() registers too late
    // ... your existing React Native setup ...
    return true
  }
}
```

`TrackerLaunch.ready()` loads an optional `tracker.config.json` from the app bundle (SDK defaults
if the file is absent or unparseable) and calls the native `ready(config)`. Calling
`Tracker.ready(config)` from JS afterwards is safe and re-applies capture parameters — but
**fields affecting background-task registration are fixed at launch on iOS**.

**2 — `Info.plist`** — usage strings, background modes, and the **verbatim** background-task
identifiers (a mismatch is a launch-window exception, not a degraded backstop):

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>This app uses your location to record trips.</string>
<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>This app uses background location to keep recording a trip when it is not in the foreground.</string>
<key>NSMotionUsageDescription</key>
<string>This app uses motion activity to tell moving from stopped and save battery.</string>

<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>processing</string>
</array>

<key>BGTaskSchedulerPermittedIdentifiers</key>
<array>
    <string>com.fieldtrack360.tracker.backstop</string>
    <string>com.fieldtrack360.tracker.sync</string>
</array>
```

The licence token is **not** an `Info.plist` entry any more — pass it via
`Tracker.ready({ license })` (see [Licensing](#licensing)).

**3 — Podfile: platform floor and deployment-target gate.** `s.platforms` alone only hard-fails a
*clean* install; an incremental install merely warns, and then dyld cannot load a framework whose
`MinimumOSVersion` is 17. Paste the gate into `post_install` (the sample carries it):

```ruby
platform :ios, '17.0'

# ... inside your target's post_install, after react_native_post_install(...)
installer.aggregate_targets.each do |aggregate|
  aggregate.user_project.native_targets.each do |native|
    next unless native.symbol_type == :application
    native.build_configurations.each do |cfg|
      dt = (cfg.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] || '0').to_f
      if dt < 17.0
        raise "Tracker requires iOS 17.0+, but target #{native.name} (#{cfg.name}) is set to #{dt}. " \
              "Raise IPHONEOS_DEPLOYMENT_TARGET to 17.0."
      end
    end
  end
end
```

**4 — Install the pods:**

```sh
cd ios && pod install
```

The npm `postinstall` fetch must have run first — it is what fills `ios/Frameworks/` inside the
package, and the podspec vendors `ios/Frameworks/*.xcframework`.

### Expo

An Expo **prebuild** host cannot do the manual steps above by hand (`android/` and `ios/` are
generated and overwritten), so the bundled **config plugin** is the only integration path that
survives a prebuild. It performs exactly the manual steps and nothing more.

```json
{
  "expo": {
    "plugins": [
      ["@fieldtrack360/react-native-tracker", {
        "androidMapsApiKey": "YOUR_MAPS_API_KEY" 
      }]
    ]
  }
}
```

| Plugin option | Type | Effect |
|---|---|---|
| `androidMapsApiKey` | `string` | `com.google.android.geo.API_KEY` manifest meta-data — needed only for the map components. Omitted → no meta-data written. |
| `locationWhenInUse` | `string` | Overrides `NSLocationWhenInUseUsageDescription`. |
| `locationAlways` | `string` | Overrides `NSLocationAlwaysAndWhenInUseUsageDescription`. |
| `motionUsage` | `string` | Overrides `NSMotionUsageDescription`. |

The plugin also: merges `location`/`processing` into `UIBackgroundModes`, merges both
`BGTaskSchedulerPermittedIdentifiers`, inserts `TrackerLaunch.ready()` into the AppDelegate
(Swift and Objective-C, idempotent), adds the JitPack repository to
`settings.gradle`, and raises `minSdkVersion`/`compileSdkVersion` to 26/36 (it never lowers them).
Expo Go cannot load this SDK — use a development build.

---

## Licensing

Tracker is licensed software, and **the two platforms enforce it differently as of Android
`1.0.1`** — the Android SDK removed its offline signature gate, iOS kept its own. Read the
enforcement table below before you build a licence-gating screen on top of `ready()`.

### Getting a licence

Buy one at **<https://fieldtrack360-sdk.devstree.in/>**, which also has a free trial for
evaluating first. Plans and prices live there; two things about a key change how you wire this
package up:

- **One key covers both platforms**, so you supply exactly one token — which is why there is a single `license` field.
- **A key is bound to one application identifier**, named at checkout. Decide your `applicationId` /
  bundle identifier before you buy, and expect a separate key per app: on iOS a token issued against
  a different identifier fails `ready()` with `licenseBundleMismatch`.

The token arrives on screen at checkout and by email. Drop it into the config field below — there is
nothing to register and no client secret.

### Supplying the token

There is **one way: `TrackerConfig.license`, applied at `ready()`** — the same call on both
platforms.

```ts
await Tracker.ready({ license: TRACKER_LICENSE, /* …the rest of your config */ });
```

There is no `iosLicense` / `androidLicense` option and no native manifest or `Info.plist` route to
configure — one field reaches both platforms, so there is no second place that can disagree with it.

The `license` field is **never persisted** with the rest of your config: it is re-read on every
`ready()` call. This is the one field `reset: false` does not freeze, so an updated token always
wins over a stale one left on disk.

> **Token prefix.** Tokens are currently issued with a **`TRACKIT-`** prefix. If a token you were
> issued starts with anything else, check it against what
> [the licence portal](https://fieldtrack360-sdk.devstree.in/) gave you before you cut a release.

### What actually gets enforced

|  | iOS | Android |
|---|---|---|
| Token checked offline at `ready()` | **yes** — signature + bundle binding | **no**, removed in `1.0.1` |
| Missing token blocks `ready()` | **yes** (`licenseMissing`) | **no** — `ready()` succeeds |
| Wrong bundle / malformed token blocks `ready()` | **yes** (`licenseBundleMismatch`, `licenseInvalid`) | **no** |
| Server says revoked / expired | stops tracking (`licenseRevoked`, `licenseExpired`) | stops tracking (same two codes) |

**Do not gate your UI on `ready()` returning a licence error — it never will on Android.** A build
with no token at all starts and tracks normally there; the only enforcement left is the online
revocation check, which reports `licenseRevoked` / `licenseExpired` **after** startup. If you need
a hard "unlicensed" state on both platforms, own that check yourself.

`licenseMissing` and `licenseBundleMismatch` are therefore **iOS-only in practice**. They remain in
the `ErrorCode` union because the Android enum still declares them, but nothing on Android emits
them. `licenseInvalid` survives on both, with different force: a hard `ready()` failure on iOS, and
on Android a post-startup diagnostic from the online check that does **not** stop tracking.

### Development

Debug and simulator builds on iOS are licence-waived, and Android now needs no token at all, so a
clone with no licence runs on both. The consequence is the same on either platform: **a missing
token is invisible until an iOS release build**, where `ready()` resolves
`{ ok: false, code: 'licenseMissing' }` and nothing downstream works. Test a release build before
you need one.

On Android the release-only **integrity** layer can additionally end an in-flight session with
`deviceIntegrityBlocked`; treat that event as a stop, not a warning.

Both platforms run the online revocation check. It never blocks startup and is **fail-open** — no
network, an unverifiable reply or a server error all leave the tracker recording. See
[Licence status on Android](#licence-status-on-android) for the readback surface.

### Getting the token into JS

Keep it out of source control and out of the JS source. The example app uses
[`react-native-dotenv`](https://github.com/goatandsheep/react-native-dotenv) — a Babel plugin, so
there is nothing to link on either platform:

Create `example/.env` yourself — it is gitignored and there is no committed template, so nothing
carrying a token exists in the repository to copy or to leak:

```
# example/.env
TRACKER_LICENSE=TRACKIT-eyJ…
```

```js
// babel.config.js
plugins: [
  ['module:react-native-dotenv', { moduleName: '@env', path: '.env', allowUndefined: true }],
],
```

```ts
import Tracker from '@fieldtrack360/react-native-tracker';
import { TRACKER_LICENSE } from '@env';

const res = await Tracker.ready({
  license: TRACKER_LICENSE,      // ← the native builder's .license(…)
  trackingMode: 'adaptive',      // ← every other builder field, same way
  intervalMs: 1000,
});

if (!res.ok) {
  // licenseMissing | licenseInvalid | licenseBundleMismatch — never silently continue.
  console.warn(res.code, res.message);
}
```

`allowUndefined: true` matters: a clone with no `.env` must still build, because development is
licence-waived anyway. The omission surfaces where it is actionable — as `licenseMissing` from
`ready()` on a release build.

This keeps the token out of the repository, not out of the binary: it is inlined into the JS bundle
at build time and readable by anyone who unpacks your app. That is expected. The token is bound to
your application id and signed, so a copy is worth nothing in another app — it is still worth what
you paid, so do not commit it.

### Licence status on Android

**Both** platforms run an **online** check alongside the offline gate: the SDK asks the licence
server whether the token has been revoked or expired since it was issued, and stops tracking with
`licenseRevoked` / `licenseExpired` if so. You wire nothing up for it. What is Android-only is the
**readback surface** below — the `licenseChecked` event and the two `Tracker.android.*` calls.

It runs shortly after every `ready()` and every 12 hours after that, never blocks `ready()`, and is
**fail-open** — a server outage never stops a paying customer.

```ts
Tracker.onTrackerEvent((event) => {
  if (event.type === 'licenseChecked') {
    console.log(event.info.status, 'cached:', event.info.fromCache);
  }
});

const info = await Tracker.android.licenseInfo();   // null = not checked yet, NOT a refusal
const fresh = await Tracker.android.checkLicense(); // force a check now
```

Branch on `status`, not on `valid` — `valid` is the server's coarse flag and collapses distinctions
`status` keeps. Only `revoked` and `expired` stop tracking; `unknownKey`, `invalidKey`,
`packageMismatch` and `sdkMismatch` are diagnostics about the vendor's ledger and tracking
continues.

**Silence is not success.** No event is emitted when the network failed or the response could not
be verified, so the absence of a verdict tells you nothing — reading it as approval would mean
reading a server outage as a valid licence.

**iOS runs the same check but reports it differently.** There is no `licenseChecked` event and no
status readback — `Tracker.android.licenseInfo()` / `checkLicense()` reject `unsupportedOnPlatform`
there. Instead iOS speaks up only to deactivate, through `licenseDeactivated` (an untyped `status`
string plus the admin's note) and the matching `error` code, and refuses `start()` until the server
reports the licence active again. Do not write one handler assuming both shapes.

---

## Initialization and ready state

Initialization is **two-phase**:

| Phase | Where | What |
|---|---|---|
| A — launch hook | Native. `TrackerLaunch.ready()` (iOS, **required**) / `TrackerLaunch.ready(context)` (Android, optional) | Registers `BGTaskScheduler` handlers inside the launch window (iOS); restores filter state at `onCreate` timing (Android). Uses bundled/default config. |
| B — JS ready | `await Tracker.ready(config?)` | Applies your real `TrackerConfig`, verifies the licence, returns the first `TrackerState`. |

Everything else is gated on phase B: calls made before it fail with `notReady`.

```ts
import Tracker, { onStateChange, type TrackerState } from '@fieldtrack360/react-native-tracker';

const result = await Tracker.ready({
  trackingMode: 'adaptive',
  intervalMs: 1000,
  activityRecognition: true,
  persistDecisions: true,
});

if (result.ok) {
  const state: TrackerState = result.value;   // { isReady, isTracking, motionState, providerState, currentSessionId? }
  console.log('ready', state.isReady);
} else {
  console.warn('ready failed', result.code, result.message);  // never swallow this
}
```

Reading or observing readiness afterwards:

```ts
const state = await Tracker.getState();       // one-shot snapshot
const unsubscribe = onStateChange((s) => {    // current value delivered on subscribe, then transitions
  setIsReady(s.isReady);
  setIsTracking(s.isTracking);
});
// on unmount:
unsubscribe();
```

**Rules**

- `ready()` is idempotent and re-appliable; call it once at app start.
- `config.reset` defaults to **`true`**: config passed to `ready()` is persisted and used by later
  sessions. With `reset: false` an existing persisted config wins in full and the object you pass
  is ignored. There is no live `setConfig()`.
- On iOS, fields affecting background-task registration are fixed by the launch hook, not by a
  later JS `ready()`.
- An invalid/undecodable config **rejects** with `invalidConfig` (bridge fault); a licence or
  runtime refusal **resolves** `{ ok: false, code, message }`.
- Subscriptions may be attached before `ready()`; they simply deliver nothing until the SDK runs.

---

## Permissions

The SDK **declares** the permissions; the host **asks** for them. The SDK never shows permission
UI or rationale.

### Android

Not requried to add permissions in your manifest file. it's merged from itself:

```xml
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.ACTIVITY_RECOGNITION" />
<uses-permission android:name="com.google.android.gms.permission.ACTIVITY_RECOGNITION" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
<uses-permission android:name="android.permission.WAKE_LOCK" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
```

plus the tracking foreground service (`foregroundServiceType="location"`), the boot receiver
(`BOOT_COMPLETED`, `MY_PACKAGE_REPLACED`) and the activity-transition / stationary-fence
receivers. `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` is deliberately **not** declared — it is
Play-policy sensitive and must be your explicit choice.

### iOS — declared by you

The three usage strings, the two background modes and the two `BGTaskSchedulerPermittedIdentifiers`
in [iOS setup](#ios-setup). A missing usage string is a crash on first request; a missing task
identifier is a launch-window exception.

### Runtime requests — use `Tracker.permissions`, not `PermissionsAndroid`

The native request shims feed the **SDK's own** permission arrays and preserve the ladder exactly.
Do not hand-roll the requests with `PermissionsAndroid` or a third-party permissions library — the
ordering rules below are enforced by the OS and are unrecoverable when broken.

**The ladder, in order:**

1. **Foreground** — `requestForeground()`. Fine + coarse in one request. Resolves the settled
   `PermissionTier`.
2. **Your own rationale UI** — a screen explaining why background access is needed. Required in
   practice, not by the API.
3. **Background** — `requestBackground()`. iOS shows the Always escalation **at most once**, and
   only *from* When-In-Use; Android cannot request `ACCESS_BACKGROUND_LOCATION` in the same call as
   the foreground permissions and two denials make it permanently denied. Asking out of order, or
   for both at once, loses background tracking for that install with no in-app recovery.
4. **Activity / motion** — `Tracker.ios.requestMotion()` on iOS (Motion & Fitness),
   `Tracker.android.requestActivityRecognition()` on Android ("Physical activity"). One rung, two
   OS names, same capability.
5. **Notifications (Android 13+ only)** — `Tracker.android.requestNotification()`. Android runs
   the session inside a foreground service, and a foreground service must post a notification. A
   refusal does not stop capture, but the OS treats an app with no visible notification as a
   stronger kill candidate.

```ts
import Tracker, { type BackgroundRequest, type PermissionTier } from '@fieldtrack360/react-native-tracker';
import { Platform } from 'react-native';

async function runLadder(showRationale: () => Promise<boolean>) {
  const tier: PermissionTier = await Tracker.permissions.requestForeground();
  if (tier === 'none') {
    // Denied. `shouldStopAsking(attempts)` tells you when the OS will not prompt again.
    if (await Tracker.permissions.shouldStopAsking(2)) {
      await Tracker.permissions.openAppSettings();
    }
    return;
  }

  if (!(await showRationale())) return;

  const bg: BackgroundRequest = await Tracker.permissions.requestBackground();
  switch (bg.kind) {
    case 'alreadyGranted':
    case 'granted':
      break;
    case 'needsForegroundFirst':
      // Rung 1 is not satisfied — go back, do not ask again here.
      break;
    case 'needsSettings':
      await Tracker.permissions.openAppSettings();  // explain what to tap before sending them
      break;
    case 'denied':          // iOS: "Keep Only While Using" — capture degrades to foreground-only
    case 'notApplicable':   // Android: nothing to ask for on this API level
    case 'prompt':          // Android: the system dialog is showing / will show
      break;
  }

  if (Platform.OS === 'ios') {
    await Tracker.ios.requestMotion();
  } else {
    await Tracker.android.requestActivityRecognition();
    await Tracker.android.requestNotification();   // no-op below Android 13
  }
}
```

**Denied, restricted, revoked, downgraded**

| Situation | Behaviour |
|---|---|
| Foreground denied | `getTier()` is `'none'`; `start()` resolves `{ ok:false, code:'permissionDenied' }` |
| Background denied / downgraded mid-session | Capture **degrades** to foreground-only rather than stopping; a `TrackerEvent` `error` with `backgroundPermissionMissing` is emitted |
| Reduced (approximate) accuracy | `getAccuracy()` is `'approximate'`; errors surface as `coarseOnly`. On iOS, `Tracker.ios.requestTemporaryFullAccuracy(purposeKey)` asks for a one-session upgrade (the `purposeKey` must exist in `NSLocationTemporaryUsageDescriptionDictionary`) |
| Location services off device-wide | `locationDisabled`; `providerState` reflects it |
| Permission revoked in Settings while running | Android restarts the process; the session resumes with whatever tier is left. Read `onProviderStateChange` rather than caching a tier |
| OS will not prompt again | `shouldStopAsking(attempts)` → `true`; the only route is `openAppSettings()` |

`example/src/screens/PermissionLadder.tsx` is a complete, copy-ready implementation of all five
rungs with platform-specific copy for every failure state.

---

## Location

### Starting and stopping location updates

Location capture is bound to a **session** — `start()` begins capture, `stop()` ends it. There is
no separate "start location updates" call.

```ts
const started = await Tracker.start('morning-route');   // optional tag
if (!started.ok) console.warn(started.code, started.message);

// ... later
const stopped = await Tracker.stop();
```

Prerequisites, in order: `ready()` resolved `ok` → foreground permission granted (background too,
for capture that survives backgrounding) → `start()`.

### Observing locations

```ts
import { onTrackerEvent, onPoints, onLiveTrack } from '@fieldtrack360/react-native-tracker';

// Every accepted point, plus rejections, motion changes, errors…
const unsubEvents = onTrackerEvent((event) => {
  switch (event.type) {
    case 'location':          console.log(event.point.latitude, event.point.longitude); break;
    case 'locationRejected':  console.log('rejected', event.decision.reason); break;
    case 'motionChange':      console.log('motion', event.state); break;
    case 'error':             console.warn(event.code, event.message); break;
  }
});

// The stored point list for one session, re-delivered as it grows.
const unsubPoints = onPoints(sessionId, (points) => setPoints(points));

// The render-ready live frame for <LiveTrackMapView>. Capacity 1 — each frame replaces the last.
const unsubLive = onLiveTrack((update) => setUpdate(update));
```

### One-shot location

```ts
const fix = await Tracker.getCurrentLocation();
if (fix.ok) {
  console.log(fix.value.latitude, fix.value.longitude, fix.value.accuracyM);
} else {
  // iOS names the cause: fixTimeout is retryable; oneShotBusy, oneShotCircuitOpen and fixRejected
  // are NOT — await the call in flight, or wait for the circuit to close. Android reports
  // notReady / permissionDenied / locationDisabled / fixTimeout only.
  console.warn(fix.code, fix.message);
}
```

**On iOS the fix is also stored.** The iOS SDK's one-shot feeds the ingest consumer by default, so
with a session open this adds a judged point to it — nothing is bypassed, but a screen that asks
"where am I" grows the user's track each time it opens. Android's one-shot is snapshot-only: never
accepted, persisted, added to the odometer, or emitted.

### Reading stored points

```ts
const points = await Tracker.getPoints({ sessionId, limit: 500 });  // default page size 500 both platforms
const count  = await Tracker.getCount({ sessionId });
const metres = await Tracker.getOdometerMeters();
```

### Plotting a finished track

```ts
const track = await Tracker.buildTrack(
  { sessionId, limit: 5000 },
  { snapToRoad: true, consolidateStops: true, zoom: 14 }
);
// track.warnings carries e.g. a truncation notice when the page came back full.
// Decode polylines with track.precision (default 6, NOT 5).

const geojson = await Tracker.exportGeoJson({ sessionId });        // coordinate order [lon, lat]
const polyline = await Tracker.exportPolylineJson({ sessionId });
```

Road snapping happens **inside** `buildTrack`, so changing it is a rebuild, not a redraw:

```ts
await Tracker.setOsrmSnapProvider({ baseUrl: 'https://router.example.com', profile: 'driving' });
// …buildTrack({...}, { snapToRoad: true })
await Tracker.clearRoadSnapProvider();
```

There is no default OSRM endpoint, and a snap failure falls back to raw geometry with a warning
(`snapUnavailable`).

### Route projection

```ts
await Tracker.setActiveRoute([{ latitude: 23.02, longitude: 72.57 }, /* … */]);  // [] clears it
const off = await Tracker.isOffRoute();
```

This projects the live puck only — it does not affect what is stored.

### Configuration that shapes capture

The most-used `TrackerConfig` fields (full list in [Types](#types)):

| Field | Type | Effect |
|---|---|---|
| `trackingMode` | `'continuous' \| 'adaptive' \| 'motionOnly'` | Cadence policy |
| `desiredAccuracy` | `'high' \| 'balanced' \| 'low'` | Provider accuracy request |
| `intervalMs` / `vehicularIntervalMs` | `number` | Base and in-vehicle cadence |
| `accuracy.profile` | `'strict' \| 'balanced' \| 'relaxed' \| 'custom'` | Fix-acceptance strictness |
| `activityRecognition` | `boolean` | Motion classification on/off |
| `stopTimeoutMin`, `stationaryRadiusM` | `number` | Stop detection |
| `maxDaysToPersist` | `number` | Retention |
| `persistRawFixes` / `persistRawPoints` / `persistDecisions` | `boolean` | Gate the diagnostic reads |

---

## Sessions

A **session** is one recording run: an id, a start time, an optional tag, an end time once closed,
and the points captured between them. Exactly one session is open at a time.

```
ready() ─ ok ─▶ start(tag?) ─▶ (open session: points, live frames, odometer) ─▶ stop() ─▶ closed session
```

```ts
import Tracker, { type TrackSession } from '@fieldtrack360/react-native-tracker';

// Start
const started = await Tracker.start('afternoon-run');
if (!started.ok) {
  switch (started.code) {
    case 'notReady':                    /* call ready() first */ break;
    case 'permissionDenied':            /* run the permission ladder */ break;
    case 'backgroundPermissionMissing': /* degraded — foreground-only capture */ break;
    case 'locationDisabled':            /* device location services are off */ break;
    case 'licenseMissing':
    case 'licenseBundleMismatch':       /* iOS release build without a valid token */ break;
    case 'licenseInvalid':              /* iOS: hard failure. Android: diagnostic only */ break;
    case 'licenseRevoked':
    case 'licenseExpired':              /* both platforms — the server withdrew it */ break;
    default:                            console.warn(started.code, started.message);
  }
} else {
  const session: TrackSession = started.value;  // { id, startedAtMs, tag?, isOpen: true, … }
}

// Current state
const open: TrackSession | null = await Tracker.currentSession();
const { isTracking, currentSessionId } = await Tracker.getState();

// History (both bounds optional; unbounded when omitted)
const sessions = await Tracker.getSessions(Date.now() - 7 * 864e5, Date.now());

// Stop
const stopped = await Tracker.stop();
if (stopped.ok) {
  // Android carries the closed session; iOS may resolve `value` as null — do not assume a session.
  const closed = stopped.value ?? null;
}
```

**Lifecycle notes**

- The session survives app backgrounding, app termination (Android, with `stopOnTerminate: false`)
  and reboot (`startOnBoot`), because capture runs in the native service/background modes — not in
  JS. Your JS subscriptions do not.
- A session the OS interrupted arrives as a `sessionInterrupted` event carrying the session.
- `stop()` on no open session resolves `{ ok: true, value: null }`-shaped or an error result
  depending on platform; check `ok` and treat a null `value` as "nothing was open".
- Geofences are **independent** of sessions: they need `ready()` plus authorization, fire with no
  session open, and survive reboot.

---

## MapView

Two Fabric components. Both are ordinary React Native views — style them, put them in a layout,
mount and unmount them freely. Neither exposes imperative ref methods; both are driven purely by
props. **On Android both require a Google Maps API key** (see [Android setup](#android-setup)) — it
is needed only when you mount one of these components, not for tracking itself.

```tsx
import { TrackMapView, LiveTrackMapView } from '@fieldtrack360/react-native-tracker';
```

### `<TrackMapView>` — a finished track

| Prop | Type | Required | Default | Notes |
|---|---|---|---|---|
| `track` | `Track` | **yes** | — | The object returned by `Tracker.buildTrack()`. Serialised to the native view; the renderer never recomputes geometry |
| `options` | `object` | no | — | Renderer styling. **Platform-divergent and intentionally unmerged** — an iOS `RenderOptions`-shaped object on iOS, an Android `RendererOptions`-shaped object on Android. Passed through as-is |
| `onArrowZoom` | `(zoom: number) => void` | no | — | The renderer needs direction arrows rebuilt at a new zoom. Rebuild with `buildTrack(query, { ...options, zoom })` and pass the **new** `track` — do not rescale |
| …`ViewProps` | | | | `style`, `testID`, etc. `children` is not supported |

```tsx
function TrackMap({ sessionId }: { sessionId: string }) {
  const [track, setTrack] = useState<Track | undefined>();
  const [zoom, setZoom] = useState<number | undefined>();

  useEffect(() => {
    let cancelled = false;
    Tracker.buildTrack({ sessionId, limit: 5000 }, { snapToRoad: true, zoom })
      .then((t) => { if (!cancelled) setTrack(t); })
      .catch((e) => console.warn('buildTrack failed', e));
    return () => { cancelled = true; };
  }, [sessionId, zoom]);

  if (!track) return <ActivityIndicator />;

  return (
    <TrackMapView
      track={track}
      onArrowZoom={setZoom}                       // rebuild at the new zoom
      style={{ height: 320, borderRadius: 8 }}
    />
  );
}
```

### `<LiveTrackMapView>` — the live track

| Prop | Type | Required | Default | Notes |
|---|---|---|---|---|
| `update` | `LiveTrackUpdate` | no | — | The latest frame from `onLiveTrack`. **Android** rebuilds the render from it; **iOS** reads the native live stream directly and treats this as a liveness signal only |
| `followMode` | `'none' \| 'follow' \| 'followBearing'` | no | native default | Camera behaviour |
| `initialCentre` | `{ latitude: number; longitude: number }` | no | — | Camera centre before the first frame arrives |
| `options` | `object` | no | — | Live renderer styling. Platform-divergent (iOS `followDistanceMeters`/`followPitchDegrees` vs Android `followZoom`/`followTilt`); no lossless mapping, so it is not unified |
| `onFollowingChange` | `(isFollowing: boolean) => void` | no | — | **iOS only** — fires when the user pans away from the puck. Android has no follow-state callback and never emits it |
| …`ViewProps` | | | | `children` is not supported |

```tsx
function LiveMap() {
  const [update, setUpdate] = useState<LiveTrackUpdate | undefined>();
  const [following, setFollowing] = useState(true);

  useEffect(() => onLiveTrack(setUpdate), []);    // the unsubscribe fn IS the cleanup

  return (
    <LiveTrackMapView
      update={update}
      followMode={following ? 'followBearing' : 'none'}
      initialCentre={{ latitude: 23.0225, longitude: 72.5714 }}
      onFollowingChange={setFollowing}
      style={{ flex: 1 }}
    />
  );
}
```

**Lifecycle**

- Unmounting the view tears down the native map; it does **not** stop the session.
- The live subscription and the view are independent — subscribe in an effect, unsubscribe on
  unmount, and let the view render whatever frame it last received.
- Inside a `ScrollView`, wrap the map so the scroll container does not swallow map gestures.

---

## Geofences

Fences are independent of tracking: they need `ready()` and authorization, fire with **no session
open**, and survive reboot. The usable cap is **19** (one of the platform's 20 slots is reserved
for the SDK's stationary fence).

```ts
const added = await Tracker.geofences.add({
  id: 'depot',
  latitude: 23.0225,
  longitude: 72.5714,
  radiusM: 150,
  // notifyOnEntry / notifyOnExit default to true.
  // dwellAfterMs is iOS-only; setting it (or an explicit `false` on either notify flag) on
  // Android resolves { ok:false, code:'invalidConfig' } naming the field.
});

const fences = await Tracker.geofences.list();
const one    = await Tracker.geofences.get('depot');
await Tracker.geofences.remove('depot');
await Tracker.geofences.removeAll();

// getEvents() is the SOURCE OF TRUTH. A crossing delivered to a relaunched process never reaches a
// live JS subscriber, so poll this at launch and after backgrounding; live events are a convenience.
const crossings = await Tracker.geofences.getEvents({ geofenceId: 'depot', limit: 50 });
await Tracker.geofences.deleteEvents('depot');
```

---

## Sync

`TrackerSync` is a separate native module that uploads stored points to your endpoint.

```ts
import { TrackerSync } from '@fieldtrack360/react-native-tracker';

await TrackerSync.configure({
  url: 'https://api.example.com/v1/points',
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  // Merged into the top level of every request body, beside the batch. Any JSON.
  extraParams: { company_id: 42, device_label: 'van-7' },
  autoSync: true,
  batchSize: 200,
  ios: { requiresNetworkConnectivity: true, backoffInitialSec: 5, backoffCeilingSec: 300 },
  android: { requiresUnmeteredNetwork: false },   // NOT the same policy as the iOS gate
});

// Call after accepted points or at an app checkpoint even with autoSync on — Android does not
// auto-enqueue its worker on accepted-point events.
await TrackerSync.requestSync();

const result = await TrackerSync.syncNow();
switch (result.kind) {
  case 'uploaded':   console.log(result.count); break;
  case 'empty':      break;
  case 'retry':      console.log('will retry:', result.reason); break;
  case 'authExpired': /* 401 — refresh credentials and reconfigure */ break;
  case 'forbidden':   /* Android only, 403 — reconfigure; the queue is intact */ break;
}

const pending = await TrackerSync.pendingCount();   // TrackerResult<number>

// Both platforms. Only `httpResponse` arrives on Android; the other three types are iOS-only.
const unsub = TrackerSync.onSyncEvent((e) => console.log(e.type));
```

### `extraParams` — your own fields in the request body

The upload body has two levels: `location` carries the batch, and everything in `extraParams` sits
beside it, at the **top level, before** `location`, in the order you wrote the keys.

```ts
await TrackerSync.configure({
  url: 'https://api.example.com/v1/location/batch',
  extraParams: {
    user_id: 'u-42',
    company_id: 7,            // a number stays a number — nothing is stringified
    debug: false,
    device: { label: 'van-7', app: '3.2.0' },   // maps and lists nest
  },
});
```

```json
{
  "user_id": "u-42",
  "company_id": 7,
  "debug": false,
  "device": { "label": "van-7", "app": "3.2.0" },
  "location": [ { "uuid": "…" } ]
}
```

This is for what belongs to the **request** rather than to any point — a tenant id, a device label,
an API version — and that a header cannot carry because your endpoint reads its body. It is static
config, like `headers`: a rotating token belongs in a fresh `configure()` call. With `extraParams`
unset the body is byte-identical to a build without it, so an existing backend needs no change.

- **`location` is reserved.** It is the batch itself, and both SDKs refuse the key.
- **`null` is the one value that does not mean the same thing on both platforms.** iOS models it and
  encodes JSON `null`; the Android SDK has no null value — "omit the key instead" — so a
  null-valued key is dropped there. A `null` *inside an array* would renumber the array if dropped,
  so Android rejects that as `invalidConfig` rather than silently shifting the elements. Send a
  sentinel when the key must reach both bodies.
- **Android caps nesting at 10 levels** and rejects an unserializable value at `configure()` time,
  naming the key, rather than failing hours later mid-drain.

Requires iOS SDK **1.0.1** / Android SDK **1.0.4** — the pinned versions of this release.

`forbidden` is **Android only** (the iOS SDK has no such case) and is deliberately not folded onto
`authExpired`. A 401 is a teardown — Android stops tracking, clears the queue and forgets the config
— while a 403 keeps tracking running and every queued row intact, and only halts the retry loop.
Recover from it by calling `configure()` again with a credential allowed to write that endpoint; a
re-login and a wipe would be the wrong reaction to what is usually a scope or permission problem.

`onSyncEvent` runs on both platforms, but the event vocabulary does not match: Android's SDK
`SyncEvent` has the single `httpResponse` case, so `uploaded` / `retryScheduled` / `authExpired`
never fire there — read upload outcomes from `syncNow()` / `pendingCount()` instead. Android also
replays the last exchange to a new subscriber, so the first event after subscribing may describe a
drain that finished earlier; iOS replays nothing. `TrackerSync.ios.onSyncEvent` remains as a
deprecated alias for the same function.

---

## Complete API reference

Every method below is on the default export (`Tracker`). All return Promises. Unless stated,
availability is **both platforms**.

### Lifecycle

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `ready(config?)` | `config?: TrackerConfig` | `Promise<TrackerResult<TrackerState>>` | Phase B init. Rejects `invalidConfig` on undecodable config. iOS background-task fields are fixed at launch |
| `start(tag?)` | `tag?: string` | `Promise<TrackerResult<TrackSession>>` | Opens a capture session |
| `stop()` | — | `Promise<TrackerResult<TrackSession \| null>>` | Android carries the closed session; iOS may resolve `value` as null |
| `getState()` | — | `Promise<TrackerState>` | One-shot snapshot |

### Reads

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `getPoints(query?)` | `query?: PointQuery` | `Promise<TrackPoint[]>` | Default page size 500 on both platforms |
| `getCount(query?)` | `query?: PointQuery` | `Promise<number>` | |
| `getOdometerMeters()` | — | `Promise<number>` | |
| `getSessions(fromMs?, toMs?)` | `fromMs?: number`, `toMs?: number` | `Promise<TrackSession[]>` | Both bounds optional |
| `currentSession()` | — | `Promise<TrackSession \| null>` | |

### Current location

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `getCurrentLocation()` | — | `Promise<TrackerResult<TrackFix>>` | **iOS also stores the fix** on the open session; Android reports it only. iOS failures name themselves — `fixTimeout` is retryable, `oneShotBusy` / `oneShotCircuitOpen` / `fixRejected` are not |

### Plotting

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `buildTrack(query?, options?)` | `PointQuery`, `TrackOptions` | `Promise<Track>` | Decoded track tree. Read `track.precision` (default **6**) when decoding polylines; check `track.warnings` |
| `exportPolylineJson(query?, options?)` | same | `Promise<string>` | SDK polyline JSON |
| `exportGeoJson(query?, options?)` | same | `Promise<string>` | GeoJSON; coordinate order `[lon, lat]` |

### Road snapping / live surface

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `setOsrmSnapProvider(config)` | `{ baseUrl: string; profile?: string }` | `Promise<void>` | No default endpoint. On failure `buildTrack` falls back to raw geometry |
| `clearRoadSnapProvider()` | — | `Promise<void>` | |
| `setActiveRoute(points)` | `{ latitude, longitude }[]` | `Promise<void>` | Projects the live puck only; `[]` clears |
| `isOffRoute()` | — | `Promise<boolean>` | |

### Diagnostics

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `getRawFixes(sessionId)` | `string` | `Promise<RawFix[]>` | Gated by `config.persistRawFixes` |
| `getRawPoints(sessionId)` | `string` | `Promise<RawPoint[]>` | Gated by `config.persistRawPoints` |
| `getDecisions(sessionId?, limit?, offset?)` | `string`, `number`, `number` | `Promise<FixDecision[]>` | Gated by `config.persistDecisions` |
| `offerFix(fix)` | `TrackFix` | `Promise<void>` | Injects a fix; does **not** bypass validation |
| `getSensors()` | — | `Promise<DeviceSensors>` | |
| `getBatteryInfo()` | — | `Promise<BatteryInfo>` | One-shot; `onBatteryChange` for a live value |

### `Tracker.permissions`

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `getTier()` | — | `Promise<PermissionTier>` | `'none' \| 'foreground' \| 'always'` |
| `getAccuracy()` | — | `Promise<'approximate' \| 'precise'>` | |
| `shouldStopAsking(attempts)` | `attempts: number` | `Promise<boolean>` | `true` → only Settings can move it |
| `requestForeground()` | — | `Promise<PermissionTier>` | Fine + coarse in one request |
| `requestBackground()` | — | `Promise<BackgroundRequest>` | Only prompts when the SDK says it is promptable |
| `getBackgroundRequest()` | — | `Promise<BackgroundRequest>` | Read without prompting |
| `openAppSettings()` | — | `Promise<boolean>` | Opens the app's system settings page |

`BackgroundRequest = { kind: 'alreadyGranted' | 'granted' | 'denied' | 'notApplicable' | 'needsForegroundFirst' | 'prompt' | 'needsSettings' }`
(`granted`/`denied` are iOS-only; `notApplicable`/`prompt` are Android-only.)

### `Tracker.geofences`

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `add(fence)` | `Geofence` | `Promise<TrackerResult<Geofence>>` | `dwellAfterMs`, or an explicit `notifyOnEntry/Exit: false`, → `invalidConfig` on Android |
| `list()` | — | `Promise<Geofence[]>` | |
| `get(id)` | `string` | `Promise<Geofence \| null>` | |
| `remove(id)` | `string` | `Promise<TrackerResult<boolean>>` | |
| `removeAll()` | — | `Promise<TrackerResult<number>>` | |
| `getEvents(opts?)` | `GeofenceEventsQuery` | `Promise<GeofenceCrossing[]>` | **Source of truth.** `fromMs`/`toMs` honoured on Android only |
| `deleteEvents(geofenceId?)` | `string?` | `Promise<number>` | Omit the id to delete all |

### `Tracker.ios` — rejects `unsupportedOnPlatform` on Android

| Method | Parameters | Returns |
|---|---|---|
| `changePace(isMoving)` | `boolean` | `Promise<TrackerResult<void>>` |
| `requestMotion()` | — | `Promise<MotionAuthorization>` |
| `getMotionAuthorization()` | — | `Promise<MotionAuthorization>` |
| `requestTemporaryFullAccuracy(purposeKey)` | `string` | `Promise<'approximate' \| 'precise'>` |

### `Tracker.android` — rejects `unsupportedOnPlatform` on iOS

| Method | Parameters | Returns |
|---|---|---|
| `hasActivityRecognition()` | — | `Promise<boolean>` |
| `requestActivityRecognition()` | — | `Promise<boolean>` |
| `hasNotificationPermission()` | — | `Promise<boolean>` |
| `requestNotification()` | — | `Promise<boolean>` (no-op below Android 13) |

### Subscriptions

Each returns an **unsubscribe function** — call it on unmount. Buffering is native and fixed: the
live-track stream has capacity 1 (each frame replaces the last), the event stream depth 64 with
drop-oldest, both with replay 0. `onStateChange` / `onProviderStateChange` / `onBatteryChange`
deliver the current value on subscribe.

| Function | Callback | Notes |
|---|---|---|
| `onTrackerEvent(cb)` | `(event: TrackerEvent) => void` | The 19-case union below |
| `onLiveTrack(cb)` | `(update: LiveTrackUpdate) => void` | Feed straight into `<LiveTrackMapView>` |
| `onPoints(sessionId, cb)` | `(points: TrackPoint[]) => void` | Stored points for one session |
| `onStateChange(cb)` | `(state: TrackerState) => void` | |
| `onProviderStateChange(cb)` | `(state: ProviderState) => void` | |
| `onBatteryChange(cb)` | `(battery: BatteryInfo) => void` | Both platforms |

```ts
type TrackerEvent =
  | { type: 'location';           point: TrackPoint }
  | { type: 'locationRejected';   decision: FixDecision }
  | { type: 'motionChange';       state: MotionState; point: TrackPoint | null }
  | { type: 'activityChange';     activity: ActivityType; confidence: number }
  | { type: 'enabledChange';      enabled: boolean }
  | { type: 'providerChange';     state: ProviderState }
  | { type: 'heartbeat';          atMs: number }
  | { type: 'powerSaveChange';    enabled: boolean }
  | { type: 'sessionInterrupted'; session: TrackSession }
  | { type: 'diagnostic';         message: string }
  | { type: 'error';              code: ErrorCode; message: string }
  | { type: 'geofenceEnter';      crossing: GeofenceCrossing }
  | { type: 'geofenceExit';       crossing: GeofenceCrossing }
  | { type: 'geofenceDwell';      crossing: GeofenceCrossing }   // iOS only
  | { type: 'geofenceAdded';      geofence: Geofence }          // radiusM is the CLAMPED value
  | { type: 'geofenceRemoved';    geofenceId: string }
  | { type: 'batteryChange';      battery: BatteryInfo }
  | { type: 'licenseDeactivated'; status: string; reason: string | null }  // iOS only
  | { type: 'trackingGap';        durationSec: number; distanceMeters: number };  // iOS only
```

A case that is absent on a platform simply never arrives — do not build a liveness assumption on
one.

### `TrackerSync`

| Method | Parameters | Returns | Notes |
|---|---|---|---|
| `configure(config)` | `SyncConfig` | `Promise<void>` | Rejects `invalidConfig` on bad JSON, an unparseable iOS url, a failed Android `SyncConfig.validate()` (cleartext url, verb outside POST/PUT/PATCH, batchSize out of range), or an `extraParams` value the platform cannot encode |
| `requestSync()` | — | `Promise<void>` | Call after accepted points even with `autoSync` on |
| `syncNow()` | — | `Promise<SyncResult>` | `uploaded` / `empty` / `retry` / `authExpired`, plus `forbidden` (**Android only**) |
| `pendingCount()` | — | `Promise<TrackerResult<number>>` | |
| `onSyncEvent(cb)` | `(e: SyncEvent) => void` | `() => void` | Both platforms; only `httpResponse` is emitted on Android |
| `ios.onSyncEvent(cb)` | `(e: SyncEvent) => void` | `() => void` | **Deprecated** alias for `onSyncEvent` |

### Components

`TrackMapView` and `LiveTrackMapView` — see [MapView](#mapview).

### Errors

Bridge **rejections** use these codes: `invalidConfig` (bad arguments / undecodable JSON),
`unsupportedOnPlatform` (wrong-platform namespace), `internalError` (an unexpected native throw).

Domain failures **resolve** with an `ErrorCode` (32 values):

- **Shared (19):** `notReady`, `permissionDenied`, `backgroundPermissionMissing`, `coarseOnly`,
  `locationDisabled`, `fgsStartRefused`, `fixTimeout`, `storageFull`, `storageReset`,
  `trackerDead`, `invalidConfig`, `motionDetectionDegraded`, `snapUnavailable`, `internalError`,
  `licenseMissing`, `licenseInvalid`, `licenseBundleMismatch`, `licenseRevoked`, `licenseExpired`
- **iOS only (3):** `oneShotBusy`, `oneShotCircuitOpen`, `fixRejected` — all three from
  `getCurrentLocation()`, and none of them worth retrying
- **Android only (10):** `playServicesUnavailable`, `notificationHidden`, `noActivity`,
  `geofenceRegistrationFailed`, `geofenceRemovalFailed`, `geofenceLimitReached`,
  `deviceIntegrityBlocked`, `licenseUnknown`, `licensePackageMismatch`, `licenseSdkMismatch`

`fgsStartRefused` exists in the iOS enum but is never emitted there. `deviceIntegrityBlocked` is
release-only (the integrity layer is waived on debuggable installs) and **ends an in-flight
session** — treat it as a stop, not a warning.

---

## Types

```ts
type TrackerResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string };

type TrackerState = {
  isReady: boolean; isTracking: boolean; motionState: MotionState;
  providerState: ProviderState; currentSessionId?: string;
};

type ProviderState = {
  permissionTier: PermissionTier; accuracyAuthorization: 'approximate' | 'precise'; powerSave: boolean;
  ios?: { locationServicesEnabled: boolean; significantLocationChangeAvailable: boolean; regionMonitoringAvailable: boolean };
  android?: { gpsEnabled: boolean; networkEnabled: boolean; fusedAvailable: boolean };
};

type DeviceSensors = {
  motionQuality: 'full' | 'degraded' | 'poor';
  ios?: { activityRecognition; stepCounting; significantLocationChange; regionMonitoring: boolean };
  android?: { accelerometer; gyroscope; magnetometer; significantMotion; stepDetector; stepCounter; barometer; rotationVector: boolean };
};

/** Both platforms. `percent` / `isCharging` are null when NOT KNOWN — never coalesce to 0 / false.
 *  `isLow` is the SDK's own derivation (percent != null && percent <= 15). On Android it is the
 *  same reading stamped on every stored point; iOS `TrackPoint` carries no battery at all. */
type BatteryInfo = {
  percent: number | null; isCharging: boolean | null;
  powerSource: 'none' | 'ac' | 'usb' | 'wireless' | 'dock' | 'unknown'; isLow: boolean;
};

type TrackFix = {
  timeMs; monotonicNanos; receivedAtMonotonicNanos: number;
  latitude; longitude; accuracyM: number; altitudeM?; verticalAccuracyM?: number;
  speedMps; bearingDeg: number; hasSpeed; hasBearing: boolean; provider: string; isMock: boolean;
  speedAccuracyMps?; bearingAccuracyDeg?: number; android?: { satelliteCount?: number };
};

type TrackPoint = {
  id: number; uuid; sessionId; localDate; timezone; provider: string;
  timeMs; monotonicNanos; latitude; longitude; accuracyM; speedMps; bearingDeg;
  activityStartTimeMs; odometerM: number;
  hasSpeed; hasBearing: boolean; movementStatus: 'steady' | 'moving';
  altitudeM?; batteryPct?: number; detectedActivity?: ActivityType; extras?: string; acceptReason: string;
  isCharging?; isMock?: boolean;                 // both platforms; null/absent = NOT KNOWN
  ios?: { isSignificantStop?: boolean };
};

type TrackSession = {
  id: string; startedAtMs: number; endedAtMs?: number; tag?: string;
  configSnapshot?: string; isOpen: boolean; android?: { startedAtElapsedNanos?: number };
};

type PointQuery = { sessionId?: string; fromMs?: number; toMs?: number; limit?: number; offset?: number };

type Track = {
  version: number; sessionId?: string; generatedAtMs: number; from: number; to: number;
  timezone: string; precision: number;      // read this when decoding — default 6
  bounds?: Bounds; stats: TrackStats; encodedPolyline: string;
  points: TrackJsonPoint[]; segments: TrackSegment[]; stops: StopNode[]; arrows: ArrowAnchor[];
  warnings: string[];
};

type TrackOptions = {
  zoom?; stopRadiusM?; stopMinDwellSec?; splineSpacingM?; bezierMinAngleDeg?; bezierCutbackM?;
  snapMaxOffRoadM?; polylinePrecision?; arrowMinSegmentM?; simplifyEpsilonM?: number;
  includeRawPoints?; consolidateStops?; snapToRoad?: boolean;
  smoothing?: 'none' | 'spline' | 'bezier'; speedBandsKmph?: number[];
};

type LiveTrackUpdate = {
  sessionId: string; sequence: number; precision: number;
  frozenTailPolyline: string; liveHead: GeoPoint[]; puck?: PuckState;
};

type Geofence = {
  id: string; latitude: number; longitude: number; radiusM: number;
  notifyOnEntry?: boolean; notifyOnExit?: boolean;    // default true
  dwellAfterMs?: number;                              // iOS only
  android?: { onEnterEvent?: string; onExitEvent?: string };
};

type GeofenceCrossing = {
  geofenceId: string; transition: 'enter' | 'exit' | 'dwell';
  timeMs?; latitude?; longitude?; radiusM?: number;   // absent on Android live events
};

type SyncParamValue = string | number | boolean | null | SyncParamValue[] | { [k: string]: SyncParamValue };

type SyncConfig = {
  url: string; method?: string; headers?: Record<string, string>; autoSync?: boolean; batchSize?: number;
  extraParams?: Record<string, SyncParamValue>;   // merged into the top level of the request body
  ios?: { requiresNetworkConnectivity?: boolean; wipeOnAuthExpiry?: boolean; stopTrackingOnAuthExpiry?: boolean;
          backoffInitialSec?: number; backoffCeilingSec?: number; autoSyncCoalesceSec?: number };
  android?: { requiresUnmeteredNetwork?: boolean };   // the two network gates are NOT the same field
};
```

**Enums (string unions):** `MotionState` `'stopped'|'moving'|'stopPending'|'stationary'` ·
`ActivityType` `'inVehicle'|'onBicycle'|'onFoot'|'walking'|'running'|'still'|'tilting'|'unknown'` ·
`PermissionTier` `'none'|'foreground'|'always'` · `AccuracyAuthorization` `'approximate'|'precise'` ·
`MotionAuthorization` `'notDetermined'|'denied'|'restricted'|'authorized'` (iOS) ·
`TrackingMode` `'continuous'|'adaptive'|'motionOnly'` · `MockPolicy` `'flag'|'reject'|'allow'` ·
`DesiredAccuracy` `'high'|'balanced'|'low'` · `AccuracyProfile` `'strict'|'balanced'|'relaxed'|'custom'` ·
`LocationProviderType` `'fused'|'gpsOnly'|'networkOnly'|'passive'` (Android) ·
`MotionQuality` `'full'|'degraded'|'poor'` · `MovementStatus` `'steady'|'moving'` ·
`SegmentType` `'travel'|'stop'|'gap'` (`gap` iOS only) · `Smoothing` `'none'|'spline'|'bezier'` ·
`CameraFollowMode` `'none'|'follow'|'followBearing'` ·
`PowerSource` `'none'|'ac'|'usb'|'wireless'|'dock'|'unknown'` (iOS never reports `ac`/`usb`/`wireless`).

### `TrackerConfig`

Passed to `ready()`. Shared fields are flat; platform-only fields live in the `ios` / `android`
namespaces. Every field is optional — omit it to keep the SDK default.

| Group | Fields |
|---|---|
| Top level | `license`, `reset` (default **true**: the config passed to `ready()` persists; `false` → an existing persisted config wins in full) |
| Geolocation | `trackingMode`, `desiredAccuracy`, `accuracy: { profile, maxAccuracyMeters, recoveryTrustMeters }`, `intervalMs`, `vehicularIntervalMs`, `adaptiveCadence`, `turnBurst`, `turnBurstIntervalMs`, `navigationMode`, `navigationIntervalMs`, `oneShotTimeoutMs`, `mockLocationPolicy`, `deliveryStalenessMs` |
| Motion | `activityRecognition`, `activityConfidenceMin` (**unnormalized**: 66 iOS / 75 Android by design), `snapshotConfidenceMin`, `stopTimeoutMin`, `stationaryRadiusM`, `motionTriggerDelayMs`, `heartbeatIntervalSec`, `persistHeartbeat`, `bearingChangeCaptureDeg`, `stopOnStationary`, `disableStopDetection`, `activityRecognitionIntervalMs` (a real battery control on Android; a delivery throttle that saves nothing on iOS) |
| Sensors | `useStepCorroboration`, `useAccelerometerVeto`, `useBarometer` |
| Persistence | `maxDaysToPersist`, `persistRawFixes`, `rawFixRingCapacity`, `persistRawPoints`, `rawPointRingCapacity`, `persistDecisions`, `decisionRetentionDays`, `decisionMaxRows` |
| Service | `healthLoopMs`, `backstopIntervalMin`, `deadTrackerMovingMin`, `deadTrackerStationaryMin` |
| `ios` | `backgroundLocationIndicator`, `stillConfidenceMin`, `useSignificantLocationChange`, `useStationaryFence` |
| `android` | `providerType`, `fastestIntervalMs`, `maxUpdateDelayMs`, `maxFixAgeMs`, `navigationFastestIntervalMs`, `distanceFilterM`, `maxRecords`, `useSignificantMotion`, `stepBatchLatencyMs`, `stationaryGeofenceId`, `stationaryGeofenceOnEnterEvent`, `stationaryGeofenceOnExitEvent`, `foregroundService`, `stopOnTerminate`, `startOnBoot`, `watchdogIntervalMs`, `watchdogThrottleMs`, `wakeLockMs`, `notificationTitle`, `notificationText`, `notificationChannelId`, `notificationChannelName`, `notificationSmallIconResName` |

Per-field docblocks live in `src/types/config.ts`.

---

## End-to-end example

A single screen covering the whole journey: ready → permissions → start → live map → stop.
Assumes installation and native configuration from the sections above.

```tsx
// TrackingScreen.tsx
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Platform, StyleSheet, Text, View } from 'react-native';
import Tracker, {
  LiveTrackMapView,
  TrackMapView,
  onLiveTrack,
  onStateChange,
  onTrackerEvent,
  type LiveTrackUpdate,
  type Track,
  type TrackerState,
} from '@fieldtrack360/react-native-tracker';

export function TrackingScreen() {
  const [state, setState] = useState<TrackerState | undefined>();
  const [live, setLive] = useState<LiveTrackUpdate | undefined>();
  const [track, setTrack] = useState<Track | undefined>();
  const [error, setError] = useState<string | undefined>();

  // 1. Initialize once, and keep the state snapshot fresh.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const res = await Tracker.ready({
        // license: '…'  — required for release builds; debug/simulator builds are waived.
        trackingMode: 'adaptive',
        intervalMs: 1000,
        activityRecognition: true,
        maxDaysToPersist: 30,
      });
      if (cancelled) return;
      if (!res.ok) setError(`${res.code}: ${res.message}`);
      else setState(res.value);
    })();

    const unsubState = onStateChange(setState);
    const unsubEvents = onTrackerEvent((event) => {
      if (event.type === 'error') setError(`${event.code}: ${event.message}`);
      // 'sessionInterrupted', 'providerChange', 'motionChange', … handled here too.
    });
    const unsubLive = onLiveTrack(setLive);

    return () => {
      cancelled = true;
      unsubState();
      unsubEvents();
      unsubLive();
    };
  }, []);

  // 2. Permission ladder — foreground, rationale, background, activity, notifications.
  const ensurePermissions = useCallback(async (): Promise<boolean> => {
    const tier = await Tracker.permissions.requestForeground();
    if (tier === 'none') {
      if (await Tracker.permissions.shouldStopAsking(2)) {
        Alert.alert('Location needed', 'Enable location for this app in Settings.', [
          { text: 'Open Settings', onPress: () => { void Tracker.permissions.openAppSettings(); } },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
      return false;
    }

    // Your own rationale screen belongs here, before the background ask.
    const bg = await Tracker.permissions.requestBackground();
    if (bg.kind === 'needsSettings') {
      Alert.alert('Background location', 'Choose "Always" for this app in Settings to keep recording in the background.');
    }

    if (Platform.OS === 'ios') {
      await Tracker.ios.requestMotion();
    } else {
      await Tracker.android.requestActivityRecognition();
      await Tracker.android.requestNotification();
    }
    return true;
  }, []);

  // 3. Start a session.
  const start = useCallback(async () => {
    setError(undefined);
    setTrack(undefined);
    if (!(await ensurePermissions())) return;

    const res = await Tracker.start(`trip-${Date.now()}`);
    if (!res.ok) setError(`${res.code}: ${res.message}`);
  }, [ensurePermissions]);

  // 4. Stop, then plot what was captured.
  const stop = useCallback(async () => {
    const sessionId = state?.currentSessionId;
    const res = await Tracker.stop();
    if (!res.ok) {
      setError(`${res.code}: ${res.message}`);
      return;
    }
    const id = res.value?.id ?? sessionId;
    if (!id) return;

    try {
      setTrack(await Tracker.buildTrack({ sessionId: id, limit: 5000 }, { snapToRoad: true }));
    } catch (e) {
      setError(String(e));
    }
  }, [state?.currentSessionId]);

  return (
    <View style={styles.root}>
      <Text>
        {state?.isReady ? 'Ready' : 'Not ready'} · {state?.isTracking ? 'Tracking' : 'Idle'} · {state?.motionState}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {state?.isTracking ? (
        <LiveTrackMapView update={live} followMode="followBearing" style={styles.map} />
      ) : track ? (
        <TrackMapView track={track} style={styles.map} />
      ) : (
        <View style={styles.map} />
      )}

      <Button title="Start" onPress={start} disabled={!state?.isReady || state.isTracking} />
      <Button title="Stop" onPress={stop} disabled={!state?.isTracking} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  map: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  error: { color: '#b00020' },
});
```

Add uploads by calling `TrackerSync.configure({...})` once after `ready()` and
`TrackerSync.requestSync()` at your own checkpoints.

### Running the bundled sample

```sh
npm install                 # installs the workspace and fetches + verifies the iOS frameworks
npm run example:ios         # or: npm run example:android
```

`example/` wires every bridged method into a screen — Home · Track · Fences · Debug · Decisions,
plus Sync. Its iOS bundle id is `com.fieldtrack360.tracker.rnsample` (Xcode/simulator builds are
licence-waived; Android debug builds are too). For Android, put `TRACKER_LICENSE` plus
`MAPS_API_KEY` (the latter only if you want the Track tab's map to draw) in
`example/android/local.properties`. No JitPack credentials are needed.

---

## Troubleshooting

### Installation

A `postinstall` script (`scripts/fetch-ios-frameworks.js`) fetches the pinned iOS XCFrameworks
into the package's `ios/Frameworks/` and **verifies a SHA-256 per framework** against the digests
pinned in `package.json` → `tracker.ios.checksums`. A mismatch fails loudly and prints both
digests — the upstream iOS tag has been force-published in place more than once, so a tag-only
pin is not safe on its own. It runs automatically on `npm install`; you only invoke it by hand
when it did not run.

Fetch-script environment variables (all optional):

| Variable | Effect |
|---|---|
| `TRACKER_IOS_DIST_LOCAL` | Path to a local SDK checkout (a directory containing `Artifacts/`) to copy from instead of downloading |
| `TRACKER_IOS_FORCE_DOWNLOAD=1` | Skip local/sibling checkouts and always download the pinned tag |
| `TRACKER_IOS_DIST_REPO` | Override the source repo (default `fieldtrack360/tracker-ios`) |

| Symptom | Cause / fix |
|---|---|
| `[tracker:fetch-ios] ERROR: checksum mismatch` | The upstream iOS tag was republished. Do **not** bypass — verify the change, then re-record digests with `node scripts/fetch-ios-frameworks.js --record` and commit the diff |
| `ios/Frameworks` is empty after install | The `postinstall` did not run (`--ignore-scripts`, or a CI cache restored `node_modules` without it). Run `node node_modules/@fieldtrack360/react-native-tracker/scripts/fetch-ios-frameworks.js` |
| `pod install` cannot find the vendored frameworks | Same cause — the fetch must run before `pod install` |

### Android

| Symptom | Cause / fix |
|---|---|
| `Could not find com.github.fieldtrack360:fieldtrack:…` | No JitPack repository is in the resolution set — normally React Native's root plugin injects one. If your host removed it, or pins `repositoriesMode` to `FAIL_ON_PROJECT_REPOS` without it, add `maven { url 'https://jitpack.io' }` to `dependencyResolutionManagement.repositories` in `android/settings.gradle` |
| A stale `authToken` / JitPack credentials block causes a `401` | The SDK is now readable anonymously — delete the credentials from `settings.gradle`, the `allprojects { repositories.withType(MavenArtifactRepository) … }` block from `android/build.gradle`, and `authToken` from `~/.gradle/gradle.properties` |
| `… was compiled with an incompatible version of Kotlin` | Your `kotlinVersion` is below 2.0, or you are on an older release of this package. Upgrade the package first — a `kotlinVersion` override is almost never the right fix |
| `Dependency … requires compileSdkVersion 37 or later` | An older release of this package. Upgrade it rather than installing SDK platform 37 |
| `Could not find …:gradle:` with an empty version | The second `includeBuild` of `@react-native/gradle-plugin` in `settings.gradle` is missing |
| Map surface is blank, only a logcat line | The `com.google.android.geo.API_KEY` `<meta-data>` element is missing, or the manifest placeholder is empty — required once you mount a map component. Assigning `manifestPlaceholders = [...]` (instead of index assignment) also wipes React Native's own placeholders |
| Session stops when the app is swiped away | `android.stopOnTerminate` — and check the notification permission: a suppressed foreground-service notification makes the OS more willing to kill the app |
| `playServicesUnavailable` | The device has no usable Google Play services; the fused provider is unavailable |

### iOS

| Symptom | Cause / fix |
|---|---|
| Crash in the launch window naming a background-task identifier | `BGTaskSchedulerPermittedIdentifiers` is missing or does not match `com.fieldtrack360.tracker.backstop` / `com.fieldtrack360.tracker.sync` **verbatim** |
| No background capture at all, no error | `TrackerLaunch.ready()` is not called from `didFinishLaunchingWithOptions`, or is called after React Native starts |
| `dyld: … MinimumOSVersion` load failure at launch | The app target's `IPHONEOS_DEPLOYMENT_TARGET` is below 17.0. The Podfile `post_install` gate catches this at install time — add it |
| Crash on first permission prompt | A missing `NSLocation…UsageDescription` / `NSMotionUsageDescription` string |
| `getCurrentLocation` fails with `oneShotBusy` / `oneShotCircuitOpen` | iOS, and **not retryable**. `oneShotBusy` means a capture is already in flight — await that one. `oneShotCircuitOpen` means three consecutive failures opened the circuit; it closes when authorization is granted, location services return, or a session starts |
| `getCurrentLocation` adds points to the track | iOS only, and by design — the SDK's one-shot feeds the ingestor by default. Android never does this |

### Licence and configuration

| Symptom | Cause / fix |
|---|---|
| `licenseMissing` in a release build, fine in debug | **iOS only** — Android no longer checks the token locally. Supply the token via `Tracker.ready({ license })`, the only route |
| `licenseBundleMismatch` | **iOS only.** The token was issued for a different bundle id (including `.dev` / `.staging` variants). Each app id needs its own token or an explicitly licensed alias |
| Android release build runs with no licence at all | Expected since Android `1.0.1`: the offline gate was removed, so only the online revocation check enforces anything. Do not read a successful `ready()` on Android as "licensed" |
| `licenseInvalid` | Truncated or wrapped token, or one from a different key generation |
| `licenseInvalid`, or `"wrong prefix"` in the log | Prefix mismatch. Both current guides document `TRACKIT-` tokens; confirm with your vendor if yours differs |
| `invalidConfig` rejection from `ready()` | The config object failed to decode natively — usually an out-of-range value or a field in the wrong namespace |
| Config changes have no effect | `reset: false` was passed, so the persisted config won. Pass `reset: true` (the default) on a later launch |
| `deviceIntegrityBlocked` (Android, release only) | The integrity layer refused the device/build; the in-flight session **ends** |

### Permissions

| Symptom | Cause / fix |
|---|---|
| The background prompt never appears | It was requested before foreground was granted (`needsForegroundFirst`), or iOS already spent its one Always escalation. Only Settings can recover it |
| `requestBackground()` resolves `needsSettings` immediately | Permanently denied. Explain what to tap, then `openAppSettings()` |
| Points stop when the app is backgrounded | Foreground-only authorization — capture degrades rather than failing. Watch for `backgroundPermissionMissing` |
| Every fix is rejected as too coarse | `coarseOnly` — approximate accuracy. On iOS, ask via `Tracker.ios.requestTemporaryFullAccuracy(purposeKey)` |

### Runtime

| Symptom | Cause / fix |
|---|---|
| Everything returns `notReady` | `ready()` was never awaited, or it resolved `{ ok:false }` and the result was swallowed |
| A subscription never fires | Either it is a platform-only stream (`geofenceDwell`, `geofenceAdded/Removed`), a `SyncEvent` type Android never emits (everything but `httpResponse`), or the unsubscribe ran early — verify the effect's cleanup |
| Geofence crossings are missing after a relaunch | Crossings delivered to a relaunched process never reach a live JS subscriber. Read `Tracker.geofences.getEvents()` at launch |
| `geofenceLimitReached` | The usable cap is 19 |
| `buildTrack` result looks short | The query page came back full — check `track.warnings` for the truncation notice and raise `limit` |
| Snapped track falls back to raw geometry | `snapUnavailable` — no provider set, or the OSRM endpoint failed |
| Map does not respond to gestures inside a `ScrollView` | The scroll container is intercepting touches; isolate the map's touch handling |

---

## Known limitations
- **Android needs a Google Maps API key to render the map components** — nothing else in the SDK
  needs one, and nothing else about the Android build needs host configuration.
- **Expo Go is not supported** — use a development build / prebuild.

---

## Security

The Android SDK needs no build-time credential — the AARs resolve anonymously from JitPack, so
there is no repository token to store or rotate. Licence tokens are bundle-bound and verified
offline, but they still belong in gitignored properties rather than committed source (the AAR ships a `FieldTrackLicenseHardcoded` lint warning for exactly this). The
iOS frameworks are pinned by SHA-256 and re-verified on every install.

## License

MIT for this bridge. The Tracker SDK itself is proprietary and requires a licence token for
release builds.

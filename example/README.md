# TrackIt sample app (bare React Native CLI)

The diagnostic instrument for `@devstree/react-native-trackit` — a bare RN CLI app (not Expo) that
exercises every bridged method across five tabs: **Home · Track · Fences · Debug · Decisions**,
with **Sync** pushed from Home. It resolves the package from source (`../src`), so a change in the
package is visible without a republish.

## Prerequisites

- Node 20+/22+, JDK 17, Xcode 26+ (iOS 17 SDK), Android SDK **platform 37** + a recent AGP.
- **Android:** a Google Maps API key in `android/app/src/main/AndroidManifest.xml`
  (`com.google.android.geo.API_KEY`) — the Track and Home map screens need it.
- **iOS:** none extra for simulator/Xcode — those builds are licence-waived. The bundle id is
  `com.devstree.trackit.rnsample`; the bundled licence token is still issued for
  `com.devstree.trackit.sample`, so a device/TestFlight build needs a reissued token.

## Run

```sh
# from the repo root
yarn                    # installs deps AND fetches + checksum-verifies the iOS XCFrameworks
yarn example ios        # bare RN CLI, iOS
yarn example android    # bare RN CLI, Android
```

If `pod install` reports "could not find compatible versions", your app target's deployment target
is below iOS 17 — the Podfile `post_install` gate enforces the floor.

## Device verification gates (run by hand)

These catch bridge defects that would otherwise surface in the field:

| Gate | Catches |
|---|---|
| `getState()` returns on both platforms | codegen + linking wired right |
| Full permission ladder (incl. denial / permanent denial) both platforms | the Android Activity-bound shim, ladder order |
| Motion pill leaves `stopped` on Android | `state.motionState` being written |
| A heartbeat arrives on Android | heartbeat emission |
| `feedIngestor: true` rejects on Android, stores a fix on iOS | the divergence |
| A recorded session renders on **Track** on both platforms | the whole Track mapper tree |
| A fence armed at the current position fires `enter` immediately on iOS | the synthetic entry |
| Kill app, cross a fence, relaunch, `getEvents()` shows it | the live-only-subscription trap |
| `grep -r "Platform.OS" example/src` returns nothing | a platform difference leaking into the host |

## Capture log (Home tab)

One log, appended in memory across the life of the process, with a banner per launch — there is no
file backing it (React Native ships no filesystem API and the sample takes no dependency to get
one), so it does not survive a relaunch.

| Button | Does |
|---|---|
| **Share** | Opens the OS share sheet with the whole log as text. Disabled when the log is empty. |
| **Clear** | Confirms, then wipes the log and re-emits the run banner. Do this before a field run, `Share` after. |
| **Dump** | Writes raw fixes, decisions, stored points and a track summary for the *resolved* session into the log. Disabled with no session. |
| **One fix** | One-shot `getCurrentLocation()` reading, reported in the log — never stored to the track. The only button here that works with no session and while tracking is stopped. |
| **Fixture** | iOS-only: exports the resolved session as a fixture JSON and shares it via `ios.exportFixture`. On Android it is not disabled but every tap rejects (`unsupportedOnPlatform`) and logs a `failed` line — Android has no fixture exporter. |

## No `Platform.OS`

The sample contains **zero** `Platform.OS` conditions — the proof that the unified API is actually
unified. Any platform-specific screen labelling refers only to the `ios.*` / `android.*` namespaces,
which are guarded by the namespace being present, not by a branch.

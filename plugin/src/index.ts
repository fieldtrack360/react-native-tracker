import {
  type ConfigPlugin,
  withInfoPlist,
  withAppDelegate,
  withAndroidManifest,
  withProjectBuildGradle,
  withSettingsGradle,
  AndroidConfig,
} from '@expo/config-plugins';

const BACKSTOP_ID = 'com.fieldtrack360.tracker.backstop';
const SYNC_ID = 'com.fieldtrack360.tracker.sync';
const MIN_SDK = 26;
const COMPILE_SDK = 37;
const MAPS_META = 'com.google.android.geo.API_KEY';
// Matches the iOS Info.plist key
const ANDROID_LICENSE_META = 'TrackerLicense';

export type TrackerPluginProps = {
  /** Google Maps API key for the Android map components. */
  androidMapsApiKey?: string;
  /** Optional iOS licence token, written to Info.plist as `TrackerLicense`. Omit to set the key
   *  in your own Info.plist, or to pass the token via TrackerConfig.license from JS instead. */
  iosLicense?: string;
  /** Optional Android licence token, written to the manifest as `<meta-data
   *  android:name="TrackerLicense">`. Omit to declare it yourself, or to pass the token via
   *  TrackerConfig.license from JS instead. Debuggable builds are waived by the SDK. */
  androidLicense?: string;
  /** Usage-description overrides. */
  locationWhenInUse?: string;
  locationAlways?: string;
  motionUsage?: string;
};

const DEFAULT_WHEN_IN_USE = 'This app uses your location to record trips.';
const DEFAULT_ALWAYS =
  'This app uses background location to keep recording a trip when not in the foreground.';
// An Info.plist value is `JSONValue`, so an existing array is not known to hold strings. Both arrays
// this plugin merges into are string arrays by definition (background modes, BGTask identifiers); a
// non-string entry in one is a plist somebody hand-edited wrong, and dropping it is the only sane
// merge — writing it back would carry the corruption forward.
function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

const DEFAULT_MOTION =
  'This app uses motion activity to tell moving from stopped and save battery.';

// ── iOS: Info.plist ─────────────────────────────────────────────────────────────
const withTrackerInfoPlist: ConfigPlugin<TrackerPluginProps> = (
  config,
  props
) =>
  withInfoPlist(config, (c) => {
    const plist = c.modResults;
    plist.NSLocationWhenInUseUsageDescription =
      props.locationWhenInUse ??
      plist.NSLocationWhenInUseUsageDescription ??
      DEFAULT_WHEN_IN_USE;
    plist.NSLocationAlwaysAndWhenInUseUsageDescription =
      props.locationAlways ??
      plist.NSLocationAlwaysAndWhenInUseUsageDescription ??
      DEFAULT_ALWAYS;
    plist.NSMotionUsageDescription =
      props.motionUsage ?? plist.NSMotionUsageDescription ?? DEFAULT_MOTION;

    const modes = new Set<string>(stringArray(plist.UIBackgroundModes));
    modes.add('location');
    modes.add('processing');
    plist.UIBackgroundModes = Array.from(modes);

    const ids = new Set<string>(
      stringArray(plist.BGTaskSchedulerPermittedIdentifiers)
    );
    ids.add(BACKSTOP_ID);
    ids.add(SYNC_ID);
    plist.BGTaskSchedulerPermittedIdentifiers = Array.from(ids);

    if (props.iosLicense) plist.TrackerLicense = props.iosLicense;
    return c;
  });

// ── iOS: AppDelegate — TrackerLaunch.ready() in the launch window ────────────────
const READY_LINE = 'TrackerLaunch.ready()';
const withTrackerAppDelegate: ConfigPlugin = (config) =>
  withAppDelegate(config, (c) => {
    let contents = c.modResults.contents;
    if (contents.includes(READY_LINE)) return c; // idempotent

    // Swift AppDelegate (RN 0.77+/Expo). Add `import Tracker` and the ready() call as the first line
    // of didFinishLaunchingWithOptions.
    if (c.modResults.language === 'swift') {
      if (!/^import Tracker$/m.test(contents)) {
        contents = contents.replace(
          /(import ReactAppDependencyProvider\n)/,
          `$1import Tracker\n`
        );
        if (!contents.includes('import Tracker')) {
          contents = contents.replace(
            /(import Expo\n|import React\n)/,
            `$1import Tracker\n`
          );
        }
      }
      contents = contents.replace(
        /(func application\([^)]*didFinishLaunchingWithOptions[^)]*\)[^{]*\{\n)/,
        `$1    ${READY_LINE}   // register background tasks inside the launch window\n`
      );
    } else {
      // Objective-C fallback.
      if (!contents.includes('#import <Tracker/Tracker-Swift.h>')) {
        contents = contents.replace(
          /(#import "AppDelegate.h"\n)/,
          `$1#import <Tracker/Tracker-Swift.h>\n`
        );
      }
      contents = contents.replace(
        /(didFinishLaunchingWithOptions:[^\n]*\n\s*\{\n)/,
        `$1  [TrackerLaunch ready];\n`
      );
    }
    c.modResults.contents = contents;
    return c;
  });

// ── Android: JitPack repo in settings.gradle ────────────────────────────────────
// No credentials: the SDK AARs are readable anonymously. A library still cannot declare a
// repository for its host under FAIL_ON_PROJECT_REPOS, so the host declares it here.
const JITPACK_BLOCK = [
  '        maven {',
  "            url 'https://jitpack.io'",
  '        }',
].join('\n');

const withTrackerSettingsGradle: ConfigPlugin = (config) =>
  withSettingsGradle(config, (c) => {
    let contents = c.modResults.contents;
    if (contents.includes('jitpack.io')) return c; // idempotent
    if (
      /dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{/.test(
        contents
      )
    ) {
      contents = contents.replace(
        /(dependencyResolutionManagement\s*\{[\s\S]*?repositories\s*\{\n)/,
        `$1${JITPACK_BLOCK}\n`
      );
    } else {
      // No dependencyResolutionManagement block — append one.
      contents += `\ndependencyResolutionManagement {\n    repositories {\n        google()\n        mavenCentral()\n${JITPACK_BLOCK}\n    }\n}\n`;
    }
    c.modResults.contents = contents;
    return c;
  });

// ── Android: SDK floors in the root build.gradle ─────────────────────────────────
const withTrackerSdkFloors: ConfigPlugin = (config) =>
  withProjectBuildGradle(config, (c) => {
    let contents = c.modResults.contents;
    contents = raiseGradleExt(contents, 'minSdkVersion', MIN_SDK);
    contents = raiseGradleExt(contents, 'compileSdkVersion', COMPILE_SDK);
    c.modResults.contents = contents;
    return c;
  });

// Raise an ext SDK int only when below the floor (never lower it).
function raiseGradleExt(contents: string, key: string, floor: number): string {
  const re = new RegExp(`(${key}\\s*=\\s*)(\\d+)`);
  const m = contents.match(re);
  if (m?.[2] != null) {
    const current = parseInt(m[2], 10);
    if (current < floor) return contents.replace(re, `$1${floor}`);
    return contents;
  }
  // Not found in ext — inject into the buildscript ext block if present.
  return contents.replace(/(ext\s*\{\n)/, `$1        ${key} = ${floor}\n`);
}

// ── Android: Google Maps API key in the manifest ─────────────────────────────────
const withTrackerMapsKey: ConfigPlugin<TrackerPluginProps> = (
  config,
  props
) => {
  if (!props.androidMapsApiKey) return config;
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      app,
      MAPS_META,
      props.androidMapsApiKey!
    );
    return c;
  });
};

// ── Android: optional licence token as manifest meta-data ────────────────────────
const withTrackerAndroidLicense: ConfigPlugin<TrackerPluginProps> = (
  config,
  props
) => {
  if (!props.androidLicense) return config;
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(
      app,
      ANDROID_LICENSE_META,
      props.androidLicense!
    );
    return c;
  });
};

const withTracker: ConfigPlugin<TrackerPluginProps> = (config, props = {}) => {
  config = withTrackerInfoPlist(config, props);
  config = withTrackerAppDelegate(config);
  config = withTrackerSettingsGradle(config);
  config = withTrackerSdkFloors(config);
  config = withTrackerMapsKey(config, props);
  config = withTrackerAndroidLicense(config, props);
  return config;
};

export default withTracker;

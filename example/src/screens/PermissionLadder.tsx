import { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import type {
  AccuracyAuthorization,
  MotionAuthorization,
  PermissionTier,
} from '@fieldtrack360/react-native-tracker';
import { spacing, useTheme } from '../theme';
import {
  ActionButton,
  DiagnosticCard,
  Divider,
  Note,
  Pill,
  Sheet,
} from '../ui';
import { useTracking } from '../state/tracking';

// The rungs, in order, each disabled until its predecessor is satisfied — the port of
// SampleApp/Modules/Home/PermissionLadderView.swift.
//
// FOUR RUNGS ON iOS, FIVE ON ANDROID. The fifth is POST_NOTIFICATIONS, which guards the notification
// the Android tracking foreground service is required to post and which became a runtime permission
// in Android 13; iOS has no equivalent because nothing in this SDK posts a notification there, so
// the rung is absent rather than permanently greyed out.
//
// THIS IS THE PART HOSTS COPY. It is one file, it depends on nothing but `Tracker.permissions`, and
// every disabled control says why it is disabled — a rung that simply greys out teaches the reader
// nothing about the ordering rule that greyed it.
//
// THE ORDER IS THE ENTIRE CONTENT. Foreground, then the host's own rationale, then background, then
// motion. iOS shows the Always escalation AT MOST ONCE and only FROM When-In-Use, so a host that
// asks out of order — or asks for both in the same breath — loses background tracking for that
// install permanently and has no way to recover it except by convincing the user to visit Settings.
// Android has the same rule in a different shape: ACCESS_BACKGROUND_LOCATION cannot be requested in
// the same call as the foreground permissions, and two denials make it permanently denied.

// MARK: - RungState

/// What one rung of the ladder can be in.
///
/// Five states rather than a boolean, because "not asked yet", "cannot be asked yet", "asked and
/// refused" and "asked and the OS will never ask again" need four different sentences on screen and
/// three different buttons. A ladder that renders them all as a greyed-out row is the reason hosts
/// ship apps that silently never get background tracking.
type RungState =
  /** A predecessor is unsatisfied. Carries what to do about it. */
  | { kind: 'blocked'; detail: string }
  /** Askable now. */
  | { kind: 'ready' }
  | { kind: 'satisfied'; detail: string }
  /** Answered, unfavourably, but still askable or recoverable in-app. */
  | { kind: 'refused'; detail: string }
  /** The OS will not prompt again. Only Settings can move this, and the user needs telling what to
   *  tap when they get there. */
  | { kind: 'needsSettings'; detail: string };

type AlwaysResult =
  | 'granted'
  | 'denied'
  | 'needsForegroundFirst'
  | 'needsSettings'
  | 'notApplicable'
  | 'prompt';

// MARK: - Copy
//
// The explanations. Long on purpose: `.needsSettings` is handled "with an explanation rather than a
// bare link", and a user sent to Settings without being told which of the four options to pick comes
// back having picked the wrong one.
//
// EVERY SENTENCE IS PLATFORM-SPECIFIC, because every one of them names a control. The rungs are the
// same four on both platforms and the ordering rule is the same rule, but "choose Location and pick
// Always" is an instruction that only exists on iOS, and a tester handed it on a Pixel goes looking
// for a row that is not there and reports the ladder as broken. The two blocks below are the same
// ladder said in each OS's own words — including rung 4, which is Motion & Fitness on iOS and the
// ACTIVITY_RECOGNITION runtime permission ("Physical activity") on Android.

type LadderCopy = {
  /** Rung 1's title and its permanently-denied explanation. */
  foregroundTitle: string;
  locationDenied: string;

  /** Rung 3's title and its four unhappy endings. */
  alwaysTitle: string;
  alwaysDenied: string;
  alwaysExhausted: string;
  alwaysDowngraded: string;
  /** Why rung 3 is blocked until rung 2 has been read. */
  alwaysRationaleMissing: string;
  /** What the OS is about to do when rung 3's button is pressed — the rationale sheet's subject. */
  alwaysRationaleTitle: string;
  alwaysRationaleBody: string;
  /** What the weaker answer costs, and what the stronger one buys — both naming the OS's own words
   *  for the two options, because the user is about to read those words on the system screen. */
  alwaysRationaleForegroundCost: string;
  alwaysRationaleBackgroundGain: string;

  /** Rung 4: the same capability under each platform's own name. */
  activityTitle: string;
  activityGranted: string;
  activityDenied: string;
  /** Shown when the OS reports the rung exists nowhere on this device/build. */
  activityUnavailable: string;

  /** The orthogonal axis. */
  reducedAccuracy: string;
};

const IOS_COPY: LadderCopy = {
  foregroundTitle: 'Foreground (When-In-Use)',
  locationDenied:
    'Location is denied or restricted for this app, and the OS will not show the prompt again. ' +
    'Open Settings, choose Location, and pick "While Using the App" — that is rung 1, and the ' +
    'Always option only becomes reachable afterwards.',

  alwaysTitle: 'Always (background)',
  alwaysDenied:
    'The background prompt was answered "Keep Only While Using", and the OS shows it once. ' +
    'Tracking still works while the app is on screen — the SDK degrades rather than refusing — but ' +
    'every background leg will be missing. Open Settings, choose Location, and pick "Always".',
  alwaysExhausted:
    'The OS will not raise the background prompt again on this install. Open Settings, choose ' +
    'Location, and pick "Always". If the list shows "While Using the App" with a checkmark, that ' +
    'is the rung the app is on and tapping "Always" is the whole change.',
  alwaysDowngraded:
    'Background access was granted and has since been downgraded — the OS confirms a provisional ' +
    'grant with the user days later, and this is what declining that confirmation looks like. Open ' +
    'Settings and choose "Always" to restore background legs.',
  alwaysRationaleMissing:
    'Show the rationale first. The OS raises this prompt once, and a user who has not been told ' +
    'what it is for taps "Keep Only While Using"',
  alwaysRationaleTitle: 'The OS is about to ask once',
  alwaysRationaleBody:
    'The next system alert is the only one you will see. It offers "Keep Only While Using" and ' +
    '"Change to Always", and the OS will not raise it a second time on this install.',
  alwaysRationaleForegroundCost:
    'Tracker records a route as a continuous line. With "While Using", capture stops the moment the ' +
    'app leaves the screen — the SDK degrades rather than refusing, so foreground legs are still ' +
    'recorded, but a drive with the phone in a pocket produces a straight line between where you ' +
    'locked the screen and where you unlocked it.',
  alwaysRationaleBackgroundGain:
    'With "Always", the OS relaunches the app in the background when you move, and the whole trip ' +
    'is captured. Battery cost is bounded by the adaptive cadence — the SDK samples rarely while ' +
    'you are stationary and quickly through turns.',

  activityTitle: 'Motion & Fitness',
  activityGranted: 'Activity recognition and the pedometer are available',
  activityDenied:
    'Motion & Fitness is denied. Location capture, filtering and plotting are untouched; what is ' +
    'lost is one of the three background wake paths and the activity labels on the timeline. ' +
    'Settings, then Motion & Fitness, if you want it back.',
  activityUnavailable:
    'Motion is unavailable on this device. Tracking is unaffected; the pedometer corroboration in ' +
    'stage 2a is simply skipped.',

  reducedAccuracy:
    'Precise Location is off, which gives a 1–3 km error circle. That defeats every gate in the ' +
    'acceptance pipeline, so start() refuses continuous and adaptive tracking under it. Open ' +
    'Settings, choose Location, and turn on Precise Location.',
};

const ANDROID_COPY: LadderCopy = {
  foregroundTitle: 'Foreground location (fine + coarse)',
  locationDenied:
    'Location is denied. Android stops showing the dialog after two refusals, and requestForeground' +
    '() then returns without a prompt — which is why this offers Settings instead of the button ' +
    'again. Open Settings, choose Permissions, then Location, and pick "Allow only while using the ' +
    'app". "Allow all the time" is rung 3 and only becomes reachable afterwards.',

  alwaysTitle: 'Background location (Allow all the time)',
  alwaysDenied:
    'ACCESS_BACKGROUND_LOCATION was refused. Tracking still works while the app is on screen — the ' +
    'SDK degrades rather than refusing — but the foreground service cannot keep the run alive once ' +
    'the app leaves the screen. Open Settings, choose Permissions, then Location, and pick "Allow ' +
    'all the time".',
  alwaysExhausted:
    'Android will not raise this prompt again for this install — from Android 11 the runtime ' +
    'dialog carries no "Allow all the time" option at all, so the settings page is the only place ' +
    'it can be granted. Open Settings, choose Permissions, then Location, and pick "Allow all the ' +
    'time".',
  alwaysDowngraded:
    'Background location was granted and has since been withdrawn — Android auto-revokes runtime ' +
    'permissions for apps left unused for a few months, and this is what that looks like. Open ' +
    'Settings, choose Permissions, then Location, and pick "Allow all the time" to restore ' +
    'background legs.',
  alwaysRationaleMissing:
    'Show the rationale first. Android counts refusals, and a user who has not been told what the ' +
    'settings page is for taps Back twice and loses background location for this install',
  alwaysRationaleTitle: 'Android asks for this one separately',
  alwaysRationaleBody:
    'ACCESS_BACKGROUND_LOCATION cannot be requested in the same call as the foreground pair, and ' +
    'from Android 11 the runtime dialog does not offer "Allow all the time" — the system sends you ' +
    "to this app's Location settings page to pick it. Two refusals make it permanently denied.",
  alwaysRationaleForegroundCost:
    'Tracker records a route as a continuous line. With "Allow only while using the app", the ' +
    'foreground service is killed when the app leaves the screen — the SDK degrades rather than ' +
    'refusing, so foreground legs are still recorded, but a drive with the phone in a pocket ' +
    'produces a straight line between where you locked the screen and where you unlocked it.',
  alwaysRationaleBackgroundGain:
    'With "Allow all the time", the foreground service keeps the run alive with the screen off and ' +
    'the whole trip is captured. Battery cost is bounded by the adaptive cadence — the SDK samples ' +
    'rarely while you are stationary and quickly through turns.',

  activityTitle: 'Physical activity (activity recognition)',
  activityGranted:
    'ACTIVITY_RECOGNITION granted — the activity classifier is available',
  activityDenied:
    'ACTIVITY_RECOGNITION is denied, so the "Physical activity" permission is off. Location ' +
    'capture, filtering and plotting are untouched; what is lost is the activity transition wake ' +
    'path and the walking/driving labels on the timeline. Settings, then Permissions, then ' +
    'Physical activity, if you want it back.',
  activityUnavailable:
    'Activity recognition is unavailable on this device. Tracking is unaffected; the activity ' +
    'corroboration in stage 2a is simply skipped.',

  reducedAccuracy:
    'Only coarse location was granted, which gives a 1–3 km error circle. That defeats every gate ' +
    'in the acceptance pipeline, so start() refuses continuous and adaptive tracking under it. ' +
    'Open Settings, choose Permissions, then Location, and switch on "Use precise location".',
};

const COPY: LadderCopy = Platform.OS === 'android' ? ANDROID_COPY : IOS_COPY;

// MARK: - Rung 5, which exists on one platform and one OS version
//
// Kept out of `LadderCopy` because there is no iOS half to pair it with: nothing in this SDK posts a
// notification on iOS, so the rung is not rendered there at all rather than rendered as a permanent
// `blocked` row. The version split is the whole point of the rung — POST_NOTIFICATIONS became a
// runtime permission in Android 13, and below that the same `false` means something else entirely.

/** Android 13. Below it POST_NOTIFICATIONS does not exist and no dialog can be raised. */
const NOTIFICATION_PERMISSION_API = 33;

const NOTIFICATION_GRANTED =
  'The tracking foreground service can post its notification, which is what keeps a run visible ' +
  'and keeps the OS from treating the process as idle.';

const NOTIFICATION_DENIED =
  'Notifications are off, so the tracking foreground service posts a notification the user never ' +
  'sees. The run still records — this is a degradation, not a failure — but nothing on the device ' +
  'says a run is live, and Android is quicker to kill an app whose foreground service has no ' +
  'visible notification. Ask again, or use Settings if the dialog stops appearing: two dismissals ' +
  'make it permanently denied.';

const NOTIFICATION_NEEDS_SETTINGS =
  'Android will not raise the notification prompt again — two dismissals make POST_NOTIFICATIONS ' +
  'permanently denied. Open Settings, choose Notifications, and switch them on.';

const NOTIFICATION_PRE_13 =
  'Below Android 13 there is no POST_NOTIFICATIONS prompt: the grant comes at install time, so ' +
  'this rung is already satisfied and the button would raise nothing.';

const NOTIFICATION_PRE_13_OFF =
  'Below Android 13 there is no prompt to raise — notifications for this app were switched off in ' +
  'Settings, and Settings is the only place they can be switched back on. The tracking foreground ' +
  'service will post a notification nobody sees until they are.';

// MARK: - PermissionLadder

export function PermissionLadder() {
  const theme = useTheme();
  const tracking = useTracking();
  const snapshot =
    tracking.state.kind === 'loaded' ? tracking.state.value : undefined;

  // The host owns the prompt counters, because the host owns the prompts —
  // `shouldStopAsking(attempts)` takes them as a parameter for exactly that reason. The OS silently
  // no-ops a repeated request once the user has answered, so a button that keeps calling
  // requestBackground() looks broken rather than persistent.
  const [foregroundAttempts, setForegroundAttempts] = useState(0);
  const [alwaysResult, setAlwaysResult] = useState<AlwaysResult | undefined>(
    undefined
  );

  /// Rung 2. Set by the sheet's own Continue button and never by the sheet being dismissed: a
  /// swipe-down is not a rationale the user read.
  const [hasShownRationale, setHasShownRationale] = useState(false);
  const [isRationalePresented, setIsRationalePresented] = useState(false);

  /// In flight, so the buttons can be disabled rather than re-entered. Two requests in flight is two
  /// continuations against one delegate callback, and the second is answered with an unchanged
  /// status.
  const [isRequesting, setIsRequesting] = useState(false);

  const tier: PermissionTier = snapshot?.tier ?? 'none';

  // Pre-populate rung 3 from the read-only query rather than leaving it `undefined` (→ "ready",
  // i.e. a "Request background" button) until the host presses that button once. On Android 11+
  // the SDK already knows there is no system dialog for "Allow all the time" — requestBackground()
  // would resolve straight to `needsSettings` with no prompt shown — so asking first only costs the
  // host an extra, pointless tap before they reach the real "Open Settings" button.
  useEffect(() => {
    if (tier !== 'foreground' || !hasShownRationale || alwaysResult != null) {
      return;
    }
    let cancelled = false;
    void tracking.getBackgroundRequest().then((kind) => {
      if (!cancelled) setAlwaysResult(kind as AlwaysResult);
    });
    return () => {
      cancelled = true;
    };
  }, [tier, hasShownRationale, alwaysResult, tracking]);

  const accuracy: AccuracyAuthorization = snapshot?.accuracy ?? 'approximate';
  const motion: MotionAuthorization | 'unavailable' =
    snapshot?.motionAuthorization ?? 'notDetermined';
  const activityRecognition: boolean | 'unavailable' =
    snapshot?.activityRecognition ?? false;
  const notificationPermission: boolean | 'unavailable' =
    snapshot?.notificationPermission ?? false;

  /// Rung 4 is asked once and answered once, but Android's answer is a boolean — and `false` is the
  /// same value before the first prompt and after a refusal. The counter is what tells them apart,
  /// exactly as `foregroundAttempts` does for rung 1. iOS needs none: `notDetermined` and `denied`
  /// are different values there.
  const [activityAttempts, setActivityAttempts] = useState(0);

  /// Same reason as `activityAttempts`, and one number further: Android dismisses POST_NOTIFICATIONS
  /// twice before it stops asking, so the counter has to distinguish three cases rather than two.
  const [notificationAttempts, setNotificationAttempts] = useState(0);

  const guarded = async (work: () => Promise<void>) => {
    if (isRequesting) {
      return;
    }
    setIsRequesting(true);
    try {
      await work();
    } finally {
      setIsRequesting(false);
    }
  };

  // MARK: - Derived states

  /// Step 1. ALWAYS FIRST — asking for background from a not-determined state permanently loses
  /// background tracking on first launch.
  const foregroundState = ((): RungState => {
    if (tier === 'always') {
      return {
        kind: 'satisfied',
        detail: 'Always — the strongest rung, granted',
      };
    }
    if (tier === 'foreground') {
      return { kind: 'satisfied', detail: 'Foreground (When-In-Use) granted' };
    }
    if (foregroundAttempts === 0) {
      return { kind: 'ready' };
    }
    // The tier collapses denied and restricted into `none`, so an attempt that came back `none`
    // means the user answered no — the OS will not raise this prompt again.
    return { kind: 'needsSettings', detail: COPY.locationDenied };
  })();

  const rationaleState = ((): RungState => {
    if (tier === 'none') {
      return {
        kind: 'blocked',
        detail:
          'Grant foreground first — the background prompt can only be raised from it',
      };
    }
    if (hasShownRationale) {
      return { kind: 'satisfied', detail: 'Rationale shown' };
    }
    if (tier === 'always') {
      return {
        kind: 'satisfied',
        detail: 'Already on Always; no escalation to explain',
      };
    }
    return { kind: 'ready' };
  })();

  /// Step 3. Only from foreground, and only after the rationale.
  const alwaysState = ((): RungState => {
    if (tier === 'always') {
      return { kind: 'satisfied', detail: 'Background tracking is authorized' };
    }
    if (tier !== 'foreground') {
      return {
        kind: 'blocked',
        detail:
          'Rung 1 first. Asking for background from a not-determined state is how an app loses ' +
          'background tracking permanently',
      };
    }
    if (!hasShownRationale) {
      return { kind: 'blocked', detail: COPY.alwaysRationaleMissing };
    }
    switch (alwaysResult) {
      case undefined:
        return { kind: 'ready' };
      case 'granted':
        // Reachable if the grant was provisional and has since been confirmed down. The tier is the
        // truth, not the result we recorded.
        return { kind: 'refused', detail: COPY.alwaysDowngraded };
      case 'notApplicable':
        return {
          kind: 'satisfied',
          detail:
            'This platform needs no separate background grant at this OS version',
        };
      case 'prompt':
        // Android hands the permission array back to the host to request; the SDK will not raise a
        // system dialog behind the host's back. The tier is what says whether it was granted.
        return {
          kind: 'refused',
          detail:
            'The platform returned "prompt": the host owns the system dialog from here. Ask again ' +
            'after presenting it, and read the tier — not this result — for the outcome',
        };
      case 'denied':
        return { kind: 'needsSettings', detail: COPY.alwaysDenied };
      case 'needsForegroundFirst':
        return {
          kind: 'refused',
          detail:
            'The SDK refused to ask: the app is not on foreground. Climb rung 1 and try again',
        };
      case 'needsSettings':
        return { kind: 'needsSettings', detail: COPY.alwaysExhausted };
      default:
        return { kind: 'ready' };
    }
  })();

  /// Step 4. Optional, and last. Denial costs one background wake path and the activity labels; it
  /// costs nothing in the capture plane, which is why it is not allowed to block the screen.
  ///
  /// ONE RUNG, TWO PLATFORM APIS. iOS answers with a four-case authorization; Android answers with a
  /// boolean, so `false` needs `activityAttempts` to say whether it means "not asked" or "refused".
  /// Both are read on every refresh and exactly one of them is not `'unavailable'`, so the branch is
  /// on the value the bridge returned rather than on `Platform.OS`.
  const activityState = ((): RungState => {
    if (motion === 'unavailable' && activityRecognition === 'unavailable') {
      // Neither namespace answered. Not reachable on a healthy build of either platform, and it is
      // shown rather than hidden because a silently missing rung is how a host ships an app whose
      // activity labels never appear and never explains why.
      return {
        kind: 'blocked',
        detail:
          'Neither the iOS motion namespace nor the Android activity-recognition namespace answered ' +
          'on this device. Tracking is unaffected; the activity labels and one background wake path ' +
          'are simply not available',
      };
    }
    if (tier === 'none') {
      return {
        kind: 'blocked',
        detail:
          'Location first — this is the optional rung, and asking for it during the location ' +
          'prompts stacks two system dialogs',
      };
    }
    if (tier !== 'always' && alwaysResult == null) {
      return {
        kind: 'blocked',
        detail:
          'Answer the background prompt first, so the two system dialogs do not overlap',
      };
    }

    // Android: a boolean plus the attempt counter. Granted is granted; `false` before the first ask
    // is `ready`, and `false` after it is a refusal the OS will stop prompting for.
    if (activityRecognition !== 'unavailable') {
      if (activityRecognition) {
        return { kind: 'satisfied', detail: COPY.activityGranted };
      }
      if (activityAttempts === 0) {
        return { kind: 'ready' };
      }
      // `refused`, not `needsSettings`: Android allows a second ask, and shouldStopAsking(attempts)
      // is the SDK's answer to when that stops being worth doing. The button stays, and the
      // permanently-denied case shows up as a request that returns false without a dialog.
      return { kind: 'refused', detail: COPY.activityDenied };
    }

    // iOS: the authorization enum says everything, so no counter is needed.
    switch (motion) {
      case 'authorized':
        return { kind: 'satisfied', detail: COPY.activityGranted };
      case 'notDetermined':
        return { kind: 'ready' };
      case 'denied':
        return { kind: 'refused', detail: COPY.activityDenied };
      case 'restricted':
        return { kind: 'refused', detail: COPY.activityUnavailable };
      default:
        return {
          kind: 'refused',
          detail:
            'Motion authorization reported a state this build does not recognise. Tracking is ' +
            'unaffected; stage 2a corroboration is skipped',
        };
    }
  })();

  /// Step 5. ANDROID ONLY, AND ONLY ASKABLE ON ANDROID 13+.
  ///
  /// Last for the same reason motion is fourth: it is the one rung whose refusal costs nothing in
  /// the capture plane, and asking for it while the location dialogs are still on screen buys a
  /// dismissal rather than an answer. The rung is not rendered at all on iOS — see the copy block.
  const notificationState = ((): RungState => {
    if (tier === 'none') {
      return {
        kind: 'blocked',
        detail:
          'Location first. This is what the tracking foreground service posts, so it is worth ' +
          'nothing until there is a run to announce — and asking now stacks a third dialog on the ' +
          'location ones',
      };
    }

    // Below Android 13 the grant is an install-time one and no dialog exists, so `false` means the
    // user switched notifications off and only Settings can move it. Offering a button here would
    // raise nothing at all and read as broken.
    if (Number(Platform.Version) < NOTIFICATION_PERMISSION_API) {
      return notificationPermission === true
        ? { kind: 'satisfied', detail: NOTIFICATION_PRE_13 }
        : { kind: 'needsSettings', detail: NOTIFICATION_PRE_13_OFF };
    }

    if (notificationPermission === true) {
      return { kind: 'satisfied', detail: NOTIFICATION_GRANTED };
    }
    if (notificationAttempts === 0) {
      return { kind: 'ready' };
    }
    // Two dismissals is Android's own rule for POST_NOTIFICATIONS, so the second refusal is where
    // the button stops being worth offering and Settings takes over.
    return notificationAttempts >= 2
      ? { kind: 'needsSettings', detail: NOTIFICATION_NEEDS_SETTINGS }
      : { kind: 'refused', detail: NOTIFICATION_DENIED };
  })();

  /// The orthogonal axis. NOT a rung — the user sets it independently of the tier, and it can be off
  /// while Always is on.
  const accuracyState: RungState =
    accuracy === 'precise'
      ? { kind: 'satisfied', detail: 'Precise location is on' }
      : { kind: 'needsSettings', detail: COPY.reducedAccuracy };

  // MARK: - Rows

  const tintFor = (state: RungState) => {
    switch (state.kind) {
      case 'blocked':
        return theme.idle;
      case 'ready':
        return theme.status.warn;
      case 'satisfied':
        return theme.status.good;
      default:
        return theme.status.bad;
    }
  };

  const glyphFor = (state: RungState) => {
    switch (state.kind) {
      case 'blocked':
        return '🔒';
      case 'ready':
        return '⚪️';
      case 'satisfied':
        return '✅';
      case 'refused':
        return '⚠️';
      default:
        return '⚙️';
    }
  };

  const rung = (
    number: number,
    title: string,
    state: RungState,
    actionTitle: string,
    action: () => void
  ) => (
    <View style={{ gap: spacing.tight }} key={title}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.row }}
      >
        <Text style={{ fontSize: 14 }}>{glyphFor(state)}</Text>
        <Text
          style={{
            fontSize: 15,
            fontWeight: '600',
            color:
              state.kind === 'satisfied' ? theme.secondaryLabel : theme.label,
            flex: 1,
          }}
        >
          {number}. {title}
        </Text>
        <Pill text={state.kind.toUpperCase()} tint={tintFor(state)} />
      </View>

      {state.kind !== 'ready' ? <Note>{state.detail}</Note> : null}

      {state.kind === 'ready' || state.kind === 'refused' ? (
        <ActionButton
          title={actionTitle}
          onPress={action}
          disabled={isRequesting}
        />
      ) : null}

      {state.kind === 'needsSettings' ? (
        <ActionButton
          title="Open Settings"
          glyph="⚙️"
          onPress={() => void tracking.openAppSettings()}
        />
      ) : null}
    </View>
  );

  return (
    <DiagnosticCard title="Permission ladder" glyph="🔐">
      <View style={{ gap: spacing.section }}>
        {rung(
          1,
          COPY.foregroundTitle,
          foregroundState,
          'Request foreground',
          () =>
            void guarded(async () => {
              setForegroundAttempts((count) => count + 1);
              await tracking.requestForeground();
            })
        )}

        {rung(
          2,
          'Background rationale',
          rationaleState,
          'Why background access?',
          () => setIsRationalePresented(true)
        )}

        {rung(
          3,
          COPY.alwaysTitle,
          alwaysState,
          'Request background',
          () =>
            void guarded(async () => {
              const kind = await tracking.requestBackground();
              setAlwaysResult(kind as AlwaysResult);
            })
        )}

        {/* Rung 4 under the name the platform's own Settings app uses, calling the namespace that
            exists there. Both calls are always present on the bridge and the wrong one rejects
            `unsupportedOnPlatform`, so this branch decides which prompt is raised, not whether the
            call is legal. */}
        {rung(
          4,
          COPY.activityTitle,
          activityState,
          activityRecognition !== 'unavailable'
            ? 'Request physical activity'
            : 'Request motion',
          () =>
            void guarded(async () => {
              if (activityRecognition !== 'unavailable') {
                setActivityAttempts((count) => count + 1);
                await tracking.requestActivityRecognition();
                return;
              }
              await tracking.requestMotion();
            })
        )}

        {/* Rung 5 exists only where the notification it guards exists. Rendered on the strength of
            the android namespace having answered — the same test rung 4 uses — rather than hidden
            behind a Platform.OS check that would have to be kept in step with the bridge. */}
        {notificationPermission !== 'unavailable'
          ? rung(
              5,
              'Notifications (foreground service)',
              notificationState,
              'Request notifications',
              () =>
                void guarded(async () => {
                  setNotificationAttempts((count) => count + 1);
                  await tracking.requestNotification();
                })
            )
          : null}

        <Divider />

        {/* Precise Location, which is not a rung: the user sets it independently of the tier, so it
            gates nothing below it and nothing below it gates it. */}
        <View style={{ gap: spacing.tight }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: spacing.row,
            }}
          >
            <Text style={{ fontSize: 14 }}>{glyphFor(accuracyState)}</Text>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '600',
                color: theme.label,
                flex: 1,
              }}
            >
              Precise Location
            </Text>
            <Pill text={accuracy.toUpperCase()} tint={tintFor(accuracyState)} />
          </View>
          <Note>{accuracyState.detail}</Note>
          {accuracyState.kind === 'needsSettings' ? (
            <ActionButton
              title="Open Settings"
              glyph="⚙️"
              onPress={() => void tracking.openAppSettings()}
            />
          ) : null}
        </View>

        <Note>
          shouldStopAsking(attempts) is the SDK's answer to "offer Settings
          instead of another prompt". The host owns the counters because the
          host owns the prompts.
        </Note>
      </View>

      {/* Rung 2, in the host's own words. The SDK shows no UI on purpose: a location prompt is
          product copy, and the sentence that decides whether a user taps "Change to Always" belongs
          to the app, not to a library. */}
      <Sheet
        isVisible={isRationalePresented}
        title="Background access"
        onDismiss={() => setIsRationalePresented(false)}
        confirmTitle="Continue"
        onConfirm={() => {
          setHasShownRationale(true);
          setIsRationalePresented(false);
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: '600', color: theme.label }}>
          {COPY.alwaysRationaleTitle}
        </Text>
        <Note>{COPY.alwaysRationaleBody}</Note>
        <Note>{COPY.alwaysRationaleForegroundCost}</Note>
        <Note>{COPY.alwaysRationaleBackgroundGain}</Note>
        <Note>
          You can change this later in Settings, but only in Settings.
        </Note>
      </Sheet>
    </DiagnosticCard>
  );
}

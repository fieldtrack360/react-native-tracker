import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Share } from 'react-native';
import Tracker, {
  TrackerSync,
  onPoints,
  onProviderStateChange,
  onStateChange,
  onTrackerEvent,
  type AccuracyAuthorization,
  type BatteryInfo,
  type DeviceSensors,
  type MotionAuthorization,
  type MotionState,
  type PermissionTier,
  type ProviderState,
  type TrackerEvent,
  type TrackSession,
} from '@fieldtrack360/react-native-tracker';
import { CaptureLog } from './captureLog';

// The app's core state: the SDK's event stream on one side, the five tabs on the other — the port
// of SampleApp/Core/AppState/TrackingViewModel.swift.
//
// It owns three things nothing else may own — the event subscription, the resolved session and the
// capture log — because all three have to be single. Two subscriptions would double every line in
// the log; two session resolutions would let Track and Decisions describe different runs, which is
// the exact failure the shared SessionPicker exists to prevent. A React context is how "one owner,
// read by every tab" is spelled here; the iOS sample says it with one `@State` in `RootView`.

// MARK: - ViewState

/// Screen state, for every screen in this app.
///
/// Four cases rather than a boolean and an optional error, because "loaded with nothing in it" and
/// "never asked" are different facts and the Decisions tab has to tell them apart: NO DECISIONS
/// RECORDED and ALL N HIDDEN BY THE FILTERS mean opposite things.
export type ViewState<T> =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; value: T }
  | { kind: 'failed'; message: string };

// MARK: - TrackingSnapshot

/// Everything the status card shows, resolved once so the five tabs cannot disagree about it.
export type TrackingSnapshot = {
  isReady: boolean;
  isTracking: boolean;
  motionState: MotionState;
  detectedActivity?: string;

  tier: PermissionTier;
  accuracy: AccuracyAuthorization;

  /** iOS: Motion & Fitness (CMMotionActivityManager). `'unavailable'` on Android, where the
   *  equivalent consent is `activityRecognition` below. */
  motionAuthorization: MotionAuthorization | 'unavailable';

  /** Android: the ACTIVITY_RECOGNITION runtime permission — "Physical activity" in the system
   *  dialog. `'unavailable'` on iOS, where the equivalent consent is `motionAuthorization` above.
   *
   *  TWO NAMES FOR ONE RUNG. Both platforms gate the same two things — the activity classifier that
   *  labels a leg walking/driving and one of the background wake paths — behind a consent the user
   *  can refuse independently of location, so the ladder shows exactly one of them and names it
   *  whatever the OS names it in Settings. A ladder that said "Motion & Fitness" on Android sends
   *  the tester looking for a row that does not exist. */
  activityRecognition: boolean | 'unavailable';

  /** Android: whether the app may post notifications. `'unavailable'` on iOS, which needs no
   *  equivalent — nothing in this SDK posts a notification there.
   *
   *  NOT A LOCATION RUNG, AND NOT COSMETIC. Android runs a tracking session inside a foreground
   *  service, and a foreground service must post a notification. From Android 13 POST_NOTIFICATIONS
   *  is a runtime permission, so a refused user gets a service whose notification is suppressed —
   *  the run still records, but the OS treats an app with no visible notification as a stronger
   *  candidate for being killed, and the tester loses the one on-device indication that a run is
   *  live. Below Android 13 the grant comes at install time and this reads `true` unless the user
   *  has switched notifications off in Settings. */
  notificationPermission: boolean | 'unavailable';

  provider?: ProviderState;
  sensors?: DeviceSensors;
  /** Undefined only when the read itself failed. */
  battery?: BatteryInfo;

  /** `selectedSessionId ?? currentSession()?.id`. THE SESSION EVERY DIAGNOSTIC TAB DESCRIBES. */
  sessionId?: string;

  /** The session was picked on Home rather than being the live one. */
  isPinnedSession: boolean;

  /** Accepted points stored against `sessionId`. */
  pointCount: number;

  /** The last error the SDK reported, kept until something replaces it. A cleared error is a field
   *  report nobody can answer. */
  lastError?: string;
};

// MARK: - Not thresholds

/// How many lines the on-screen feed keeps. A list bound, not a decision: nothing compares it, and
/// the durable record is the capture log.
const LOG_CAPACITY = 300;

/// The page a session dump reads. `buildTrack` raises `truncated` when a page comes back full, so
/// both reads use the same bound and the warning stays honest.
const DUMP_PAGE_SIZE = 5000;

// MARK: - Context

type TrackingContextValue = {
  state: ViewState<TrackingSnapshot>;
  sessions: TrackSession[];
  log: string[];
  captureLogSizeKB: number;

  /** SESSION PINNING. A session picked here wins over the live one, and all four diagnostic tabs
   *  read this single selection — so Track, Debug and Decisions always describe the same run. */
  selectedSessionId?: string;
  selectSession: (sessionId: string | undefined) => void;
  /** The pin, or the live session when nothing is pinned. */
  resolvedSessionId?: string;

  /** Track-tab render flags. Pure presentation; the tabs re-read them, nothing here recomputes. */
  snapToRoad: boolean;
  setSnapToRoad: (value: boolean) => void;
  showRawLayer: boolean;
  setShowRawLayer: (value: boolean) => void;

  /** Raised on `error(backgroundPermissionMissing)` and on a mid-session downgrade. A DEGRADATION,
   *  not a failure: the SDK keeps capturing in the foreground with only foreground authorization. */
  alwaysRationale?: string;
  dismissAlwaysRationale: () => void;

  refresh: () => Promise<void>;
  refreshPermissions: () => Promise<void>;
  loadSessions: () => Promise<void>;
  start: (tag?: string) => Promise<void>;
  stop: () => Promise<void>;

  requestForeground: () => Promise<PermissionTier>;
  requestBackground: () => Promise<string>;
  getBackgroundRequest: () => Promise<string>;
  requestMotion: () => Promise<MotionAuthorization | 'unavailable'>;
  requestActivityRecognition: () => Promise<boolean | 'unavailable'>;
  requestNotification: () => Promise<boolean | 'unavailable'>;
  shouldStopAsking: (attempts: number) => Promise<boolean>;
  openAppSettings: () => Promise<boolean>;

  shareCaptureLog: () => Promise<void>;
  clearCaptureLog: () => void;
  dumpSession: () => Promise<void>;
  showCurrentLocation: () => Promise<void>;
  recordFixture: () => Promise<void>;

  /** For the tabs that write their own lines into the shared record — the Fences and Sync screens
   *  both do, because a crossing is often the explanation for what the tracking feed did next. */
  note: (kind: string, detail: string) => void;
};

const TrackingContext = createContext<TrackingContextValue | null>(null);

export function useTracking(): TrackingContextValue {
  const value = useContext(TrackingContext);
  if (!value) {
    throw new Error('useTracking must be used inside <TrackingProvider>');
  }
  return value;
}

// MARK: - Provider

export function TrackingProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ViewState<TrackingSnapshot>>({
    kind: 'idle',
  });
  const [sessions, setSessions] = useState<TrackSession[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [captureLogSizeKB, setCaptureLogSizeKB] = useState(0);
  const [selectedSessionId, setSelectedSessionId] = useState<
    string | undefined
  >(undefined);
  const [snapToRoad, setSnapToRoad] = useState(true);
  const [showRawLayer, setShowRawLayer] = useState(true);
  const [alwaysRationale, setAlwaysRationale] = useState<string | undefined>(
    undefined
  );

  const captureLog = useRef(new CaptureLog()).current;

  // The facts that are read rather than rendered. Kept in a ref for the same reason the iOS view
  // model marks them `@ObservationIgnored`: they are inputs to the snapshot, not a second copy of
  // it, and re-rendering on each one would redraw the tab on every provider callback.
  const facts = useRef<{
    tier: PermissionTier;
    accuracy: AccuracyAuthorization;
    motionAuthorization: MotionAuthorization | 'unavailable';
    activityRecognition: boolean | 'unavailable';
    notificationPermission: boolean | 'unavailable';
    provider?: ProviderState;
    sensors?: DeviceSensors;
    battery?: BatteryInfo;
    detectedActivity?: string;
    lastError?: string;
    isReady: boolean;
    isTracking: boolean;
    motionState: MotionState;
    pinnedSessionId?: string;
  }>({
    tier: 'none',
    accuracy: 'approximate',
    motionAuthorization: 'notDetermined',
    activityRecognition: false,
    notificationPermission: false,
    isReady: false,
    isTracking: false,
    motionState: 'stopped',
  });

  const hasStarted = useRef(false);

  // Live sync needs an accepted-point signal per running session (Android does not auto-enqueue the
  // sync worker on accepted points even with autoSync on — requestSync() must be called after each
  // one). Re-pointed at the new session's onPoints stream on every start(), torn down on stop().
  const unsubscribePoints = useRef<() => void>(() => {});

  // MARK: - The on-screen feed

  /// One monospaced line, newest first, capped at LOG_CAPACITY.
  const record = useCallback((kind: string, detail: string) => {
    const padded = kind.length >= 9 ? kind : kind + ' '.repeat(9 - kind.length);
    const now = new Date();
    const two = (value: number) => String(value).padStart(2, '0');
    const stamp = `${two(now.getHours())}:${two(now.getMinutes())}:${two(now.getSeconds())}`;
    setLog((previous) =>
      [`${stamp}  ${padded} ${detail}`, ...previous].slice(0, LOG_CAPACITY)
    );
  }, []);

  const note = useCallback(
    (kind: string, detail: string) => {
      captureLog.note(kind, detail);
      setCaptureLogSizeKB(captureLog.sizeKB());
    },
    [captureLog]
  );

  // MARK: - Snapshot plumbing

  const makeSnapshot = useCallback(
    (sessionId: string | undefined, pointCount: number): TrackingSnapshot => ({
      isReady: facts.current.isReady,
      isTracking: facts.current.isTracking,
      motionState: facts.current.motionState,
      detectedActivity: facts.current.detectedActivity,
      tier: facts.current.tier,
      accuracy: facts.current.accuracy,
      motionAuthorization: facts.current.motionAuthorization,
      activityRecognition: facts.current.activityRecognition,
      notificationPermission: facts.current.notificationPermission,
      provider: facts.current.provider,
      sensors: facts.current.sensors,
      battery: facts.current.battery,
      sessionId,
      isPinnedSession: facts.current.pinnedSessionId != null,
      pointCount,
      lastError: facts.current.lastError,
    }),
    []
  );

  /// Rebuilds everything except the two numbers that cost a database read.
  const rebuildSnapshot = useCallback(() => {
    setState((previous) => {
      if (previous.kind !== 'loaded') {
        return previous;
      }
      return {
        kind: 'loaded',
        value: makeSnapshot(
          previous.value.sessionId,
          previous.value.pointCount
        ),
      };
    });
  }, [makeSnapshot]);

  /// Mutates in place, or does nothing before the first load. Nothing here is the source of truth —
  /// the next `refresh()` rebuilds from storage regardless.
  const mutate = useCallback(
    (change: (snapshot: TrackingSnapshot) => TrackingSnapshot) => {
      setState((previous) =>
        previous.kind === 'loaded'
          ? { kind: 'loaded', value: change(previous.value) }
          : previous
      );
    },
    []
  );

  // MARK: - Reads

  /// Rebuilds the snapshot, resolving the session the whole app is describing.
  const refresh = useCallback(async () => {
    try {
      // SESSION PINNING: a session picked on Home wins over the live one.
      const sessionId =
        facts.current.pinnedSessionId ??
        (await Tracker.currentSession())?.id ??
        undefined;

      // A missing session id would count every point in the database, which reads as a wildly wrong
      // number for a run that has not started yet.
      const pointCount = sessionId ? await Tracker.getCount({ sessionId }) : 0;

      const sdkState = await Tracker.getState();
      facts.current.isReady = sdkState.isReady;
      facts.current.isTracking = sdkState.isTracking;
      facts.current.motionState = sdkState.motionState;
      facts.current.provider = sdkState.providerState;

      setState({ kind: 'loaded', value: makeSnapshot(sessionId, pointCount) });
      setCaptureLogSizeKB(captureLog.sizeKB());
    } catch (error) {
      note('NOTE', `refresh failed: ${String(error)}`);
      setState({ kind: 'failed', message: String(error) });
    }
  }, [captureLog, makeSnapshot, note]);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await Tracker.getSessions());
    } catch (error) {
      // Never swallowed: an empty picker and a failed query look identical on screen.
      note('NOTE', `sessions could not be loaded: ${String(error)}`);
      record('SESSIONS', `could not be loaded — ${String(error)}`);
    }
  }, [note, record]);

  /// Re-reads the authorization tier, accuracy, motion consent and sensors.
  ///
  /// Called after every request and whenever Home reappears, because all of them move underneath a
  /// running app: the user can revoke location in Settings, downgrade background authorization days
  /// after a provisional grant, or switch off precise location without touching the tier at all.
  const refreshPermissions = useCallback(async () => {
    try {
      facts.current.tier = await Tracker.permissions.getTier();
      facts.current.accuracy = await Tracker.permissions.getAccuracy();
    } catch (error) {
      record('PERM', `could not be read — ${String(error)}`);
    }
    try {
      // No Platform.OS branch: the ios namespace is always present and rejects
      // `unsupportedOnPlatform` on Android, which is the answer rather than an error.
      facts.current.motionAuthorization =
        await Tracker.ios.getMotionAuthorization();
    } catch {
      facts.current.motionAuthorization = 'unavailable';
    }
    try {
      // The Android half of the same rung, read the same way and for the same reason: the android
      // namespace is always present and rejects `unsupportedOnPlatform` on iOS. Reading BOTH on
      // every refresh is what lets the ladder pick the rung by which read succeeded rather than by
      // a Platform.OS branch it would then have to keep in sync with the bridge.
      facts.current.activityRecognition =
        await Tracker.android.hasActivityRecognition();
    } catch {
      facts.current.activityRecognition = 'unavailable';
    }
    try {
      // Read on every refresh rather than once, because this is the permission a user is most
      // likely to switch off from the notification shade itself — long-press, Turn off — while the
      // run that posted it is still going.
      facts.current.notificationPermission =
        await Tracker.android.hasNotificationPermission();
    } catch {
      facts.current.notificationPermission = 'unavailable';
    }
    try {
      facts.current.sensors = await Tracker.getSensors();
    } catch (error) {
      record('SENSORS', `could not be probed — ${String(error)}`);
    }
    try {
      facts.current.battery = await Tracker.getBatteryInfo();
    } catch {
      facts.current.battery = undefined;
    }
    try {
      // The provider snapshot, read HERE rather than only in refresh().
      //
      // The capture log's run header is written straight after this call and before the first
      // refresh(), so without this read every field log opens with "PROVIDER | not read yet" — and
      // that line is the one that answers "why is nothing being recorded": it carries gpsEnabled,
      // networkEnabled and fusedAvailable on Android, locationServicesEnabled on iOS. A run header
      // missing it sends the reader to adb for a fact the app already had.
      const sdkState = await Tracker.getState();
      facts.current.isReady = sdkState.isReady;
      facts.current.isTracking = sdkState.isTracking;
      facts.current.motionState = sdkState.motionState;
      facts.current.provider = sdkState.providerState;
    } catch (error) {
      record('PROVIDER', `could not be read — ${String(error)}`);
    }
    rebuildSnapshot();
  }, [rebuildSnapshot, record]);

  // MARK: - Events

  /// Authorization moves underneath a running app, and both directions matter.
  ///
  /// A mid-session downgrade is the case hosts forget: the OS may confirm a provisional background
  /// grant with the user days later and take it away, and the tracker keeps running with less than
  /// it started with. The rationale is raised rather than the session torn down.
  const handleProviderChange = useCallback(
    (provider: ProviderState) => {
      const previous = facts.current.provider;
      facts.current.provider = provider;
      facts.current.tier = provider.permissionTier;
      facts.current.accuracy = provider.accuracyAuthorization;
      rebuildSnapshot();
      record(
        'PROVIDER',
        `auth ${provider.permissionTier} · accuracy ${provider.accuracyAuthorization}` +
          ` · powerSave ${provider.powerSave ? 'on' : 'off'}`
      );

      if (
        previous?.permissionTier === 'always' &&
        provider.permissionTier !== 'always'
      ) {
        setAlwaysRationale(
          'Background authorization was withdrawn while a run was in progress. Tracking continues ' +
            'while the app is open; it stops as soon as the app is backgrounded. Allow "Always" ' +
            'again to record complete trips.'
        );
        record('PERM', `downgraded from always to ${provider.permissionTier}`);
      }

      if (provider.permissionTier === 'none') {
        facts.current.lastError =
          'Location authorization was withdrawn; no fix can be delivered.';
        rebuildSnapshot();
      }

      if (provider.ios && !provider.ios.locationServicesEnabled) {
        facts.current.lastError =
          'Location Services is switched off for this device.';
        rebuildSnapshot();
      }
    },
    [rebuildSnapshot, record]
  );

  /// `backgroundPermissionMissing` is a DEGRADATION, not a failure.
  ///
  /// The SDK emits it and keeps capturing rather than refusing to start, because refusing throws
  /// away the foreground case entirely — a user with the app open on a walk would get nothing. The
  /// sample's job here is to show the rationale and carry on, which is the handling a host copies.
  const handleError = useCallback(
    (code: string, message: string) => {
      if (code === 'backgroundPermissionMissing') {
        setAlwaysRationale(message);
        record('DEGRADED', `${code} — foreground tracking continues`);
      } else {
        facts.current.lastError = `${code}: ${message}`;
        record('ERROR', `${code} — ${message}`);
      }
      rebuildSnapshot();
    },
    [rebuildSnapshot, record]
  );

  /// THE CAPTURE LOG IS WRITTEN FIRST, EVERY TIME.
  ///
  /// It is the durable record; the on-screen feed is a convenience capped at 300 lines. An order
  /// that formatted the UI line first would put the cheap, disposable half of this function ahead of
  /// the half a field report depends on.
  const handleEvent = useCallback(
    async (event: TrackerEvent) => {
      captureLog.event(event);
      setCaptureLogSizeKB(captureLog.sizeKB());

      switch (event.type) {
        case 'location':
          mutate((snapshot) => ({
            ...snapshot,
            pointCount: snapshot.pointCount + 1,
          }));
          record(
            'POINT',
            `${event.point.accuracyM.toFixed(1)}m · ${event.point.acceptReason}`
          );
          break;

        case 'locationRejected':
          record(
            event.decision.verdict.toUpperCase(),
            `${event.decision.reason} · moved ${event.decision.distanceMovedM.toFixed(1)}m` +
              ` · σ${event.decision.sigma.toFixed(1)}/${event.decision.threshold.toFixed(1)}`
          );
          break;

        case 'motionChange':
          facts.current.motionState = event.state;
          mutate((snapshot) => ({ ...snapshot, motionState: event.state }));
          record('MOTION', event.state);
          break;

        case 'activityChange':
          facts.current.detectedActivity = event.activity;
          mutate((snapshot) => ({
            ...snapshot,
            detectedActivity: event.activity,
          }));
          record(
            'ACTIVITY',
            `${event.activity} · confidence ${event.confidence}`
          );
          break;

        case 'enabledChange':
          facts.current.isTracking = event.enabled;
          mutate((snapshot) => ({ ...snapshot, isTracking: event.enabled }));
          record('ENABLED', event.enabled ? 'tracking' : 'stopped');
          // A session has just opened or closed: the picker and the resolved session both move.
          await loadSessions();
          await refresh();
          break;

        case 'providerChange':
          handleProviderChange(event.state);
          break;

        case 'heartbeat':
          record('HEART', new Date(event.atMs).toLocaleTimeString());
          break;

        // Recorded here as well as on the Fences screen: a tester reading one feed should not have
        // to know which screen owns which event, and a crossing is often the explanation for what
        // the tracking feed did next.
        case 'geofenceEnter':
          record('FENCE', `enter ${event.crossing.geofenceId}`);
          break;
        case 'geofenceExit':
          record('FENCE', `exit ${event.crossing.geofenceId}`);
          break;
        case 'geofenceDwell':
          record('FENCE', `dwell ${event.crossing.geofenceId}`);
          break;
        case 'geofenceAdded':
          record('FENCE', `added ${event.geofenceId}`);
          break;
        case 'geofenceRemoved':
          record('FENCE', `removed ${event.geofenceId}`);
          break;

        case 'powerSaveChange':
          record('POWER', event.enabled ? 'power save on' : 'power save off');
          await refreshPermissions();
          break;

        case 'sessionInterrupted':
          // Reported, not adopted. `start()` opens a fresh session; this row is the evidence that
          // the OS terminated the process mid-run.
          record('SESSION', `interrupted ${event.session.id.slice(0, 8)}`);
          await loadSessions();
          break;

        case 'diagnostic':
          record('DIAG', event.message);
          break;

        case 'error':
          handleError(event.code, event.message);
          break;

        default:
          record('EVENT', 'unrecognised event — SDK is newer than this build');
      }
    },
    [
      captureLog,
      handleError,
      handleProviderChange,
      loadSessions,
      mutate,
      record,
      refresh,
      refreshPermissions,
    ]
  );

  // MARK: - Lifecycle

  /// Permissions, then the run header, then the sessions, then the event stream.
  ///
  /// The order is the content. The run header carries the permission and sensor context that makes
  /// every line after it interpretable, so it has to be written before the first event can arrive —
  /// and the events have to be consumed last, because a subscription opened first would deliver
  /// lines into a log with no banner above them.
  useEffect(() => {
    if (hasStarted.current) {
      return;
    }
    hasStarted.current = true;

    let unsubscribeEvents = () => {};
    let unsubscribeState = () => {};
    let unsubscribeProvider = () => {};

    const boot = async () => {
      setState({ kind: 'loading' });

      // ready() first — never swallow the result. Everything downstream is gated on the runtime it
      // builds, so a silent failure here presents as `permissionDenied` on a Start tap long
      // afterwards, with a granted permission ladder sitting directly beneath it.
      //
      // persistRawFixes / persistRawPoints / persistDecisions are OFF by default in the SDK because
      // they are diagnostics, not production behaviour. The sample turns them on because the sample
      // exists to diagnose: layers 1 and 2 of the three-layer reading have no other source.
      const result = await Tracker.ready({
        trackingMode: 'adaptive',
        accuracy: { profile: 'balanced' },
        // 1 s, against a default of 60 s. The default is a battery figure and it is the right one
        // for a delivery day; a sample whose whole purpose is diagnosis should sample at the rate
        // the thing being diagnosed happens.
        intervalMs: 1000,
        persistRawFixes: true,
        persistRawPoints: true,
        persistDecisions: true,
        android: {
          // MUST be <= intervalMs. Android's GeolocationConfig defaults it to 30 s and the SDK
          // validates `intervalMs >= fastestIntervalMs`, so asking for a 1 s cadence without moving
          // this floor makes ready() refuse with `invalidConfig … EC-120`. A refused ready() is not
          // a warning: nothing downstream is configured, so start() opens a session that never
          // receives a fix and every getCurrentLocation() ends in fixTimeout — which reads like a
          // dead GPS and is not. iOS has no equivalent floor, which is why this lives in the
          // android namespace rather than in the shared block.
          fastestIntervalMs: 1000,
        },
      });
      if (!result.ok) {
        record('READY', `failed — ${result.code}: ${result.message}`);
        // The capture log too, not only the on-screen feed: a run whose configuration was refused
        // explains every empty block below it, and that fact has to survive in the durable record.
        captureLog.note('READY', `failed — ${result.code}: ${result.message}`);
        facts.current.lastError = `${result.code}: ${result.message}`;
      } else {
        record('READY', 'ready() succeeded');
        captureLog.note('READY', 'ready() succeeded');
      }

      await refreshPermissions();

      captureLog.runHeader({
        sensors: facts.current.sensors,
        tier: facts.current.tier,
        accuracy: facts.current.accuracy,
        motion: String(facts.current.motionAuthorization),
        activity: String(facts.current.activityRecognition),
        notifications: String(facts.current.notificationPermission),
        provider: facts.current.provider,
      });
      setCaptureLogSizeKB(captureLog.sizeKB());

      await loadSessions();
      await refresh();

      unsubscribeEvents = onTrackerEvent((event) => {
        void handleEvent(event);
      });
      unsubscribeState = onStateChange((sdkState) => {
        facts.current.isReady = sdkState.isReady;
        facts.current.isTracking = sdkState.isTracking;
        facts.current.motionState = sdkState.motionState;
        facts.current.provider = sdkState.providerState;
        rebuildSnapshot();
      });
      unsubscribeProvider = onProviderStateChange(handleProviderChange);
    };

    void boot();

    return () => {
      unsubscribeEvents();
      unsubscribeState();
      unsubscribeProvider();
      unsubscribePoints.current();
    };
    // Deliberately once, for the life of the app. A second run would open a second subscription and
    // double every line in the log and in the feed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // MARK: - Tracking

  const start = useCallback(
    async (tag?: string) => {
      note('NOTE', `start requested tag=${tag ?? 'none'}`);
      const result = await Tracker.start(tag);
      if (result.ok) {
        // Starting a run releases the pin: the instruments follow the run that was just started,
        // which is what somebody pressing Start is asking for.
        facts.current.pinnedSessionId = undefined;
        setSelectedSessionId(undefined);
        facts.current.lastError = undefined;
        record('START', `session ${result.value.id.slice(0, 8)}`);

        unsubscribePoints.current();
        unsubscribePoints.current = onPoints(result.value.id, () => {
          void TrackerSync.requestSync();
        });
      } else {
        // A refusal is not a crash and not a silent no-op. `start()` refuses for exactly two
        // reasons — no authorization at all, and reduced accuracy — and both are fixable by the
        // user, so both have to reach the screen.
        facts.current.lastError = `${result.code}: ${result.message}`;
        record('START', `refused — ${result.code}: ${result.message}`);
        note(
          'NOTE',
          `start refused code=${result.code} message=${result.message}`
        );
      }
      await loadSessions();
      await refresh();
    },
    [loadSessions, note, record, refresh]
  );

  const stop = useCallback(async () => {
    note('NOTE', 'stop requested');
    unsubscribePoints.current();
    unsubscribePoints.current = () => {};
    const result = await Tracker.stop();
    if (result.ok) {
      record(
        'STOP',
        `session ${result.value ? result.value.id.slice(0, 8) : '—'}`
      );
    } else {
      facts.current.lastError = `${result.code}: ${result.message}`;
      record('STOP', `failed — ${result.code}: ${result.message}`);
    }
    await loadSessions();
    await refresh();
  }, [loadSessions, note, record, refresh]);

  // MARK: - The permission ladder
  //
  // Every rung is routed through here rather than called straight off `Tracker.permissions` so the
  // outcome reaches the capture log. Authorization is the single largest variable between two field
  // runs of the same scenario, and a log that does not record when it changed cannot explain them.

  const requestForeground = useCallback(async () => {
    const tier = await Tracker.permissions.requestForeground();
    note('PERM', `requestForeground -> ${tier}`);
    record('PERM', `foreground → ${tier}`);
    await refreshPermissions();
    return tier;
  }, [note, record, refreshPermissions]);

  const requestBackground = useCallback(async () => {
    const result = await Tracker.permissions.requestBackground();
    note('PERM', `requestBackground -> ${result.kind}`);
    record('PERM', `background → ${result.kind}`);
    await refreshPermissions();
    return result.kind;
  }, [note, record, refreshPermissions]);

  // Read-only twin of requestBackground(): on Android 11+ the SDK already knows a request would
  // land on `needsSettings` (no system dialog exists for "Allow all the time" past API 29), so the
  // ladder can show the Settings button straight away instead of making the host tap a "Request
  // background" button that is known to go nowhere.
  const getBackgroundRequest = useCallback(async () => {
    const result = await Tracker.permissions.getBackgroundRequest();
    note('PERM', `getBackgroundRequest -> ${result.kind}`);
    return result.kind;
  }, [note]);

  const requestMotion = useCallback(async () => {
    try {
      const result = await Tracker.ios.requestMotion();
      note('PERM', `requestMotion -> ${result}`);
      record('PERM', `motion → ${result}`);
      await refreshPermissions();
      return result;
    } catch {
      // Android: `unsupportedOnPlatform`. Not an error to show — the rung simply does not exist
      // there, and the ladder says so rather than offering a button that cannot work.
      record('PERM', 'motion → unavailable on this platform');
      return 'unavailable' as const;
    }
  }, [note, record, refreshPermissions]);

  /// The Android rung 4. ACTIVITY_RECOGNITION is a runtime permission like the location pair, so
  /// this raises a real system dialog ("Physical activity") — and, like the location prompts, two
  /// refusals make it permanently denied and only Settings can move it afterwards.
  const requestActivityRecognition = useCallback(async () => {
    try {
      const granted = await Tracker.android.requestActivityRecognition();
      note('PERM', `requestActivityRecognition -> ${granted}`);
      record(
        'PERM',
        `activity recognition → ${granted ? 'granted' : 'denied'}`
      );
      await refreshPermissions();
      return granted;
    } catch {
      // iOS: `unsupportedOnPlatform`, the mirror image of requestMotion() on Android.
      record('PERM', 'activity recognition → unavailable on this platform');
      return 'unavailable' as const;
    }
  }, [note, record, refreshPermissions]);

  /// The Android rung 5, and only on Android 13+.
  ///
  /// Below API 33 the SDK's `notificationPermissions()` is an empty array, so the bridge raises no
  /// dialog and resolves the current state — the call is safe at every API level and the ladder does
  /// not need a version check to make it. What the ladder DOES need the version for is the sentence
  /// it shows: below 33 a `false` here means the user switched notifications off in Settings, and
  /// telling them to answer a dialog that will never appear is worse than saying nothing.
  const requestNotification = useCallback(async () => {
    try {
      const granted = await Tracker.android.requestNotification();
      note('PERM', `requestNotification -> ${granted}`);
      record('PERM', `notifications → ${granted ? 'granted' : 'denied'}`);
      await refreshPermissions();
      return granted;
    } catch {
      // iOS: `unsupportedOnPlatform`. Nothing in this SDK posts a notification there.
      record('PERM', 'notifications → unavailable on this platform');
      return 'unavailable' as const;
    }
  }, [note, record, refreshPermissions]);

  const shouldStopAsking = useCallback(
    (attempts: number) => Tracker.permissions.shouldStopAsking(attempts),
    []
  );

  const openAppSettings = useCallback(
    () => Tracker.permissions.openAppSettings(),
    []
  );

  // MARK: - The capture log

  const shareCaptureLog = useCallback(async () => {
    if (captureLog.isEmpty()) {
      record('LOG', 'nothing to share yet');
      return;
    }
    try {
      await Share.share({ message: captureLog.text() });
    } catch (error) {
      record('LOG', `share failed — ${String(error)}`);
    }
  }, [captureLog, record]);

  /// Step 2 of the field-run protocol, immediately before a run. The run banner is re-emitted, so
  /// clearing does not cost the device and permission context the run is about to be read against.
  const clearCaptureLog = useCallback(() => {
    captureLog.clear();
    setCaptureLogSizeKB(captureLog.sizeKB());
    record('LOG', 'cleared');
  }, [captureLog, record]);

  /// Writes the four analysis blocks and the track summary for the resolved session.
  ///
  /// This is the "After" half of the field-run protocol, and without a caller HIST never exists —
  /// which would leave the most useful block in the log unreachable from the device that recorded
  /// it.
  const dumpSession = useCallback(async () => {
    const sessionId =
      state.kind === 'loaded' ? state.value.sessionId : undefined;
    if (!sessionId) {
      record('DUMP', 'no session selected');
      return;
    }
    try {
      const query = { sessionId, limit: DUMP_PAGE_SIZE };
      const rawFixes = await Tracker.getRawFixes(sessionId);
      const decisions = await Tracker.getDecisions(
        sessionId,
        DUMP_PAGE_SIZE,
        0
      );
      const points = await Tracker.getPoints(query);

      captureLog.sessionDump({ sessionId, rawFixes, decisions, points });

      const track = await Tracker.buildTrack(query, { snapToRoad });
      captureLog.trackSummary(track);

      setCaptureLogSizeKB(captureLog.sizeKB());
      record(
        'DUMP',
        `${sessionId.slice(0, 8)} — ${rawFixes.length} raw → ${points.length} stored`
      );
    } catch (error) {
      facts.current.lastError = String(error);
      record('DUMP', `failed — ${String(error)}`);
      rebuildSnapshot();
    }
  }, [captureLog, rebuildSnapshot, record, snapToRoad, state]);

  /// One fix, without a session — the `getCurrentLocation()` path.
  ///
  /// Deliberately callable while stopped, because that is the case it exists for: a host asking
  /// "where am I" before any track is being recorded. `feedIngestor` is left at its default, so the
  /// fix is reported and never stored: a button on a diagnostics screen must not add points to the
  /// track being measured.
  const showCurrentLocation = useCallback(async () => {
    const result = await Tracker.getCurrentLocation();
    if (result.ok) {
      const detail =
        `${result.value.latitude.toFixed(5)}, ${result.value.longitude.toFixed(5)} ` +
        `±${result.value.accuracyM.toFixed(0)} m`;
      note('ONESHOT', detail);
      record('ONESHOT', detail);
    } else {
      // The message carries the diagnostic — authorization, master switch, accuracy grant, power
      // save. Logged whole rather than summarised, because summarising it is what turns a settings
      // problem into a bug report. On iOS every failure collapses to `fixTimeout`: read the
      // message, do not branch on the code for this method.
      note('ONESHOT', `${result.code} — ${result.message}`);
      record('ONESHOT', `${result.code} — ${result.message}`);
    }
  }, [note, record]);

  /// Step 4 of the field-run protocol: export a fixture for anything anomalous, BEFORE proposing a
  /// constant change. iOS-only on the bridge; the namespace is always present and rejects on
  /// Android, so there is no platform branch here either.
  const recordFixture = useCallback(async () => {
    const sessionId =
      state.kind === 'loaded' ? state.value.sessionId : undefined;
    if (!sessionId) {
      record('FIXTURE', 'no session selected');
      return;
    }
    const name = `session-${sessionId.slice(0, 8)}-${Math.floor(Date.now() / 1000)}`;
    try {
      const json = await Tracker.ios.exportFixture(sessionId, name);
      note('FIXTURE', `recorded ${name}`);
      record('FIXTURE', `recorded ${name} (${json.length} bytes) — sharing`);
      await Share.share({ message: json });
    } catch (error) {
      record('FIXTURE', `failed — ${String(error)}`);
    }
  }, [note, record, state]);

  // MARK: - Session pinning

  const selectSession = useCallback(
    (sessionId: string | undefined) => {
      if (sessionId === facts.current.pinnedSessionId) {
        return;
      }
      facts.current.pinnedSessionId = sessionId;
      setSelectedSessionId(sessionId);
      // The setter kicks a refresh so the status card's point count follows the selection.
      void refresh();
    },
    [refresh]
  );

  const resolvedSessionId =
    selectedSessionId ??
    (state.kind === 'loaded' ? state.value.sessionId : undefined);

  const value = useMemo<TrackingContextValue>(
    () => ({
      state,
      sessions,
      log,
      captureLogSizeKB,
      selectedSessionId,
      selectSession,
      resolvedSessionId,
      snapToRoad,
      setSnapToRoad,
      showRawLayer,
      setShowRawLayer,
      alwaysRationale,
      dismissAlwaysRationale: () => setAlwaysRationale(undefined),
      refresh,
      refreshPermissions,
      loadSessions,
      start,
      stop,
      requestForeground,
      requestBackground,
      getBackgroundRequest,
      requestMotion,
      requestActivityRecognition,
      requestNotification,
      shouldStopAsking,
      openAppSettings,
      shareCaptureLog,
      clearCaptureLog,
      dumpSession,
      showCurrentLocation,
      recordFixture,
      note,
    }),
    [
      alwaysRationale,
      captureLogSizeKB,
      clearCaptureLog,
      dumpSession,
      getBackgroundRequest,
      loadSessions,
      log,
      note,
      openAppSettings,
      recordFixture,
      refresh,
      refreshPermissions,
      requestActivityRecognition,
      requestBackground,
      requestForeground,
      requestMotion,
      requestNotification,
      resolvedSessionId,
      selectSession,
      selectedSessionId,
      sessions,
      shareCaptureLog,
      shouldStopAsking,
      showCurrentLocation,
      showRawLayer,
      snapToRoad,
      start,
      state,
      stop,
    ]
  );

  return (
    <TrackingContext.Provider value={value}>
      {children}
    </TrackingContext.Provider>
  );
}

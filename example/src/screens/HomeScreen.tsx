import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type {
  MotionState,
  PermissionTier,
  TrackerResult,
  TrackFix,
} from '@fieldtrack360/react-native-tracker';
import { radius, spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  CollapseChevron,
  DiagnosticCard,
  Divider,
  ExplanationBox,
  FactRow,
  LogPane,
  Note,
  Screen,
  Sheet,
  shortId,
  withAlpha,
} from '../ui';
import { useTracking } from '../state/tracking';
import { CAPTURE_LOG_FILE_NAME } from '../state/captureLog';
import { PermissionLadder } from './PermissionLadder';

// The instrument's front panel — the port of SampleApp/Modules/Home/HomeView.swift.
//
// Everything on this screen answers a question a field tester asks in the first thirty seconds of a
// run: is it recording, what does it think the device is doing, which rung of the ladder are we on,
// which session is this, how big is the log, and what is the last thing that went wrong. There is no
// decoration — a control that is not answering one of those is not here.
export function HomeScreen({
  isPermissionLadderVisible,
  onOpenPermissionLadder,
  onClosePermissionLadder,
  onOpenSync,
}: {
  isPermissionLadderVisible: boolean;
  onOpenPermissionLadder: () => void;
  onClosePermissionLadder: () => void;
  onOpenSync: () => void;
}) {
  const theme = useTheme();
  const tracking = useTracking();

  /// Guards the Start/Stop pair against a second tap while the first is in flight. `start()` is
  /// idempotent in the SDK, but a button that stays tappable through a two-second authorization
  /// check reads as unresponsive.
  const [isSwitching, setIsSwitching] = useState(false);

  /// Collapsed by default: it is a one-time explainer for the two header icons, not a diagnostic —
  /// and it now sits below Status so it does not push the numbers a tester checks first off screen.
  const [isShortcutsExpanded, setIsShortcutsExpanded] = useState(false);

  const [isCaptureLogExpanded, setIsCaptureLogExpanded] = useState(false);
  const [isEventsExpanded, setIsEventsExpanded] = useState(false);

  /// Collapsed by default, like every other diagnostic here — a tester only opens it when they
  /// actually want a fix, not on every launch.
  const [isCurrentLocationExpanded, setIsCurrentLocationExpanded] =
    useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [currentLocationResult, setCurrentLocationResult] = useState<
    TrackerResult<TrackFix> | undefined
  >();

  const fetchCurrentLocation = async () => {
    setIsLocating(true);
    try {
      setCurrentLocationResult(await tracking.showCurrentLocation());
    } finally {
      setIsLocating(false);
    }
  };

  /// Short id until tapped — the full id is what a tester needs to match a run against a
  /// server-side log, but is too long to sit in the grid the rest of Status uses.
  const [isSessionExpanded, setIsSessionExpanded] = useState(false);
  const revealSessionId = (sessionId: string | undefined) => {
    if (!sessionId) {
      return;
    }
    Clipboard.setString(sessionId);
    setIsSessionExpanded(true);
    setTimeout(() => setIsSessionExpanded(false), 10000);
  };

  const { state } = tracking;
  const snapshot = state.kind === 'loaded' ? state.value : undefined;
  const isTracking = snapshot?.isTracking === true;

  /// Every rung of the ladder is up: Always, precise, the activity consent this platform names, and
  /// — on Android — notifications. `'unavailable'` is a satisfied rung, not a missing one: it means
  /// the platform has no such consent to grant, so a device that can never show it must still be
  /// allowed to read as complete.
  const isEveryPermissionGranted =
    snapshot != null &&
    snapshot.tier === 'always' &&
    snapshot.accuracy === 'precise' &&
    (snapshot.motionAuthorization === 'unavailable' ||
      snapshot.motionAuthorization === 'authorized') &&
    snapshot.activityRecognition !== false &&
    snapshot.notificationPermission !== false;

  const switching = async (work: () => Promise<void>) => {
    setIsSwitching(true);
    try {
      await work();
    } finally {
      setIsSwitching(false);
    }
  };

  const confirmClear = () => {
    Alert.alert(
      'Clear the capture log?',
      'Every run banner and every recorded decision in the log is deleted. Share it first if this ' +
        'run is not finished being explained.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: tracking.clearCaptureLog,
        },
      ]
    );
  };

  return (
    <Screen>
      {/* MARK: - Status */}
      <DiagnosticCard
        title="Location Tracking Status"
        glyph="🧭"
        pulseColor={isTracking ? theme.status.good : undefined}
      >
        {state.kind === 'idle' ? (
          <Note>ready() has not completed yet.</Note>
        ) : null}

        {state.kind === 'loading' ? (
          <Note>Resolving configuration and restoring filter state…</Note>
        ) : null}

        {state.kind === 'failed' ? (
          <ExplanationBox text={state.message} tint={theme.status.bad} />
        ) : null}

        {snapshot ? (
          <View style={{ gap: spacing.tight }}>
            <FactGroup theme={theme} filled>
              <FactRow
                name="Tracking"
                value={snapshot.isTracking ? 'RECORDING' : 'STOPPED'}
                tint={snapshot.isTracking ? theme.status.good : theme.idle}
                stackedFont
                spaceBetween
              />
            </FactGroup>

            <View style={{ flexDirection: 'row', gap: spacing.row }}>
              <View style={{ flex: 1 }}>
                <FactGroup theme={theme} filled>
                  <FactRow
                    name="Motion state"
                    value={snapshot.motionState}
                    tint={motionTint(snapshot.motionState, theme)}
                    stacked
                  />
                </FactGroup>
              </View>
              <View style={{ flex: 1 }}>
                <FactGroup theme={theme} filled>
                  <FactRow
                    name="Authorization"
                    value={snapshot.tier}
                    tint={tierTint(snapshot.tier, theme)}
                    stacked
                  />
                </FactGroup>
              </View>
              <View style={{ flex: 1 }}>
                <FactGroup theme={theme} filled>
                  <FactRow name="Accuracy" value={snapshot.accuracy} stacked />
                </FactGroup>
              </View>
            </View>

            {/* Tap to reveal the full session id — copies it to the clipboard and collapses back to
                the short id after 10s. The short id is enough to eyeball, the full one is what a
                tester needs to match a run against a server-side log. */}
            <Pressable onPress={() => revealSessionId(snapshot.sessionId)}>
              <FactGroup theme={theme} filled>
                <FactRow
                  name="Session"
                  value={
                    isSessionExpanded
                      ? (snapshot.sessionId ?? '—')
                      : shortId(snapshot.sessionId)
                  }
                  tint={motionTint(snapshot.motionState, theme)}
                  stackedFont
                  spaceBetween
                />
              </FactGroup>
            </Pressable>

            <View style={{ flexDirection: 'row', gap: spacing.row }}>
              <View style={{ flex: 1 }}>
                <FactGroup theme={theme} filled>
                  <FactRow
                    name="Accepted points"
                    value={snapshot.pointCount}
                    stacked
                  />
                </FactGroup>
              </View>
              {snapshot.battery ? (
                <View style={{ flex: 1 }}>
                  <FactGroup theme={theme} filled>
                    <FactRow
                      name="Battery"
                      value={
                        snapshot.battery.percent != null
                          ? `${snapshot.battery.percent}%${snapshot.battery.isCharging ? ' (charging)' : ''}`
                          : 'unknown'
                      }
                      tint={
                        snapshot.battery.isLow
                          ? theme.status.bad
                          : snapshot.battery.isCharging
                            ? theme.status.good
                            : undefined
                      }
                      stacked
                    />
                  </FactGroup>
                </View>
              ) : null}
            </View>

            {snapshot.detectedActivity ? (
              <FactRow name="Activity" value={snapshot.detectedActivity} />
            ) : null}
            {snapshot.isLocationSuspended ? (
              <>
                <Divider />
                {/* The SDK is already retrying this outage on its own (CaptureSuspended →
                    CaptureResumed) — a raw error code here would read as something the tester
                    has to act on, when waiting is the correct response. */}
                <FactRow
                  name="Location"
                  value="GPS Off detected..."
                  tint={theme.status.warn}
                />
              </>
            ) : snapshot.lastError ? (
              <>
                <Divider />
                {/* Kept on screen rather than flashed as a toast. A backgroundPermissionMissing is a
                    degradation the run continues under, and the tester needs to still be able to
                    read it an hour later when the track has a hole in it. */}
                <FactGroup theme={theme} filled>
                  <FactRow
                    name="Last error"
                    value={snapshot.lastError}
                    tint={theme.status.bad}
                    stackedFont
                    spaceBetween
                  />
                </FactGroup>
              </>
            ) : null}
          </View>
        ) : null}

        <TrackingToggleButton
          theme={theme}
          isTracking={isTracking}
          isBusy={isSwitching}
          onStart={() => {
            // Always is the rung start() actually needs for a complete run; foreground-only
            // still records, but silently loses every background leg. Send the tester to the
            // ladder instead of starting a run they will not recognise as degraded.
            if (snapshot?.tier !== 'always') {
              onOpenPermissionLadder();
              return;
            }
            void switching(() => tracking.start('sample'));
          }}
          onStop={() => void switching(() => tracking.stop())}
        />
      </DiagnosticCard>

      {/* MARK: - Current location
          A session-less "where am I", independent of tracking — a tester can arm a fix with no run
          ever started. Collapsed by default like the other diagnostics. */}
      <DiagnosticCard
        title="Current location"
        glyph="📍"
        onHeaderPress={() =>
          setIsCurrentLocationExpanded((expanded) => !expanded)
        }
        right={
          <CollapseChevron expanded={isCurrentLocationExpanded} theme={theme} />
        }
      >
        {isCurrentLocationExpanded ? (
          <>
            <ActionRow>
              <ActionButton
                title={isLocating ? 'Locating…' : 'Get current location'}
                glyph={isLocating ? undefined : '📍'}
                disabled={isLocating}
                onPress={() => void fetchCurrentLocation()}
              />
            </ActionRow>

            {currentLocationResult?.ok ? (
              <View style={{ flexDirection: 'row', gap: spacing.row }}>
                <View style={{ flex: 1 }}>
                  <FactGroup theme={theme} filled>
                    <FactRow
                      name="Latitude"
                      value={currentLocationResult.value.latitude.toFixed(5)}
                      stacked
                    />
                  </FactGroup>
                </View>
                <View style={{ flex: 1 }}>
                  <FactGroup theme={theme} filled>
                    <FactRow
                      name="Longitude"
                      value={currentLocationResult.value.longitude.toFixed(5)}
                      stacked
                    />
                  </FactGroup>
                </View>
                <View style={{ flex: 1 }}>
                  <FactGroup theme={theme} filled>
                    <FactRow
                      name="Accuracy"
                      value={`${currentLocationResult.value.accuracyM.toFixed(0)}m`}
                      stacked
                    />
                  </FactGroup>
                </View>
              </View>
            ) : currentLocationResult && !currentLocationResult.ok ? (
              <ExplanationBox
                text={currentLocationResult.message}
                tint={theme.status.bad}
              />
            ) : null}
          </>
        ) : null}
      </DiagnosticCard>

      {/* MARK: - Header shortcuts
          Upload and the permission ladder moved into the header (🔄 / 🔐) so Home stays a status
          panel rather than a settings page. This card is the one place that still says what those
          two icons open, for a tester who has not pressed them yet — collapsed by default since it
          is a one-time explainer, not a diagnostic. */}
      <DiagnosticCard
        title="Permission & Server Sync"
        glyph="🛡️"
        onHeaderPress={() => setIsShortcutsExpanded((expanded) => !expanded)}
        right={<CollapseChevron expanded={isShortcutsExpanded} theme={theme} />}
      >
        {isShortcutsExpanded ? (
          <FactGroup theme={theme} filled>
            <Pressable onPress={onOpenSync}>
              <View style={{ flexDirection: 'row', gap: spacing.row }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: withAlpha(theme.accent, theme.tintFill),
                  }}
                >
                  <Text style={{ fontSize: 14 }}>🔄</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.tight,
                    }}
                  >
                    <Text style={{ color: theme.label, fontWeight: '600' }}>
                      Server Sync
                    </Text>
                    {tracking.configuredSyncEndpoint ? (
                      <Text
                        style={{ fontSize: 13, color: theme.status.good }}
                        accessibilityLabel="Server sync configured"
                      >
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <Note>
                    Endpoint, queue and the HTTP feed — configuring where points
                    upload to.
                  </Note>
                </View>
              </View>
            </Pressable>
            <Divider />
            <Pressable onPress={onOpenPermissionLadder}>
              <View style={{ flexDirection: 'row', gap: spacing.row }}>
                <View
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 13,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: withAlpha(theme.accent, theme.tintFill),
                  }}
                >
                  <Text style={{ fontSize: 14 }}>🔐</Text>
                </View>
                <View style={{ flex: 1, gap: 2 }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: spacing.tight,
                    }}
                  >
                    <Text style={{ color: theme.label, fontWeight: '600' }}>
                      Required Permission
                    </Text>
                    {isEveryPermissionGranted ? (
                      <Text
                        style={{ fontSize: 13, color: theme.status.good }}
                        accessibilityLabel="All permissions granted"
                      >
                        ✓
                      </Text>
                    ) : null}
                  </View>
                  <Note>
                    Foreground, background, motion and notification permissions
                    — also opens on its own if Start is pressed without Always
                    granted.
                  </Note>
                </View>
              </View>
            </Pressable>
          </FactGroup>
        ) : null}
      </DiagnosticCard>

      {/* A degradation, not a failure. The SDK keeps capturing in the foreground with only
          foreground authorization, and a sample that treated this as fatal would teach hosts to
          throw away the case where the user has the app open on a walk. */}
      {tracking.alwaysRationale ? (
        <DiagnosticCard title="Background access degraded" glyph="⚠️">
          <ExplanationBox text={tracking.alwaysRationale} />
          <ActionRow>
            <ActionButton
              title="Open Settings"
              onPress={() => void tracking.openAppSettings()}
            />
            <ActionButton
              title="Dismiss"
              onPress={tracking.dismissAlwaysRationale}
            />
          </ActionRow>
        </DiagnosticCard>
      ) : null}

      {/* MARK: - The ladder
          Off the flow by default now: opened from the header's 🔐 button, or automatically when
          Start is pressed without Always granted. */}
      <Sheet
        isVisible={isPermissionLadderVisible}
        title="Permission ladder"
        onDismiss={onClosePermissionLadder}
      >
        <PermissionLadder />
      </Sheet>

      {/* MARK: - Capture log */}
      <DiagnosticCard
        title="Capture log"
        glyph="📄"
        onHeaderPress={() => setIsCaptureLogExpanded((expanded) => !expanded)}
        right={
          <CollapseChevron expanded={isCaptureLogExpanded} theme={theme} />
        }
      >
        {isCaptureLogExpanded ? (
          <>
            <FactGroup theme={theme} filled>
              <FactRow
                // No `stackedFont` here, unlike the rows above: it uppercases the name, and a
                // shouted CAPTURE-LOG.TXT stops reading as a filename.
                name={CAPTURE_LOG_FILE_NAME}
                value={`${tracking.captureLogSizeKB}KB Size`}
                tint={theme.accent}
                spaceBetween
              />
            </FactGroup>

            <ActionRow>
              {/* Disabled rather than hidden: a control that vanishes reads as a missing feature, one
                  that greys out reads as a missing input. */}
              <ActionButton
                title="Share Logs"
                glyph="↗"
                disabled={tracking.captureLogSizeKB === 0}
                onPress={() => void tracking.shareCaptureLog()}
              />
              <ActionButton
                title="Clear Logs"
                glyph="🗑"
                destructive
                disabled={tracking.captureLogSizeKB === 0}
                onPress={confirmClear}
              />
            </ActionRow>

            <Note>
              One log, appended to a file on disk with a banner per launch, so
              it survives a relaunch. Clear it before a field run and share it
              after — Share sends the file itself, not a text blob.
            </Note>
          </>
        ) : null}
      </DiagnosticCard>

      {/* MARK: - Event feed */}
      <DiagnosticCard
        title="Events"
        glyph="📋"
        onHeaderPress={() => setIsEventsExpanded((expanded) => !expanded)}
        right={<CollapseChevron expanded={isEventsExpanded} theme={theme} />}
      >
        {isEventsExpanded ? (
          tracking.log.length === 0 ? (
            <Note>
              No events yet. The stream starts at ready() and carries the full
              vocabulary — locations, rejections, motion and provider changes,
              heartbeats and errors.
            </Note>
          ) : (
            /* The durable record is the capture log; this is the convenience copy, capped by the
               shared state. Rendered in a fixed-height pane so a busy drive cannot push the rest of
               the screen off the bottom. */
            <LogPane lines={tracking.log} />
          )
        ) : null}
      </DiagnosticCard>
    </Screen>
  );
}

// MARK: - Tracking toggle button

/// Start and Stop as one control rather than a disabled/enabled pair — only one state is ever
/// reachable from the other, so showing both as separate buttons meant one was always greyed out
/// doing nothing.
function TrackingToggleButton({
  theme,
  isTracking,
  isBusy,
  onStart,
  onStop,
}: {
  theme: ReturnType<typeof useTheme>;
  isTracking: boolean;
  isBusy: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const crossfade = useRef(new Animated.Value(isTracking ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(crossfade, {
      toValue: isTracking ? 1 : 0,
      duration: 260,
      useNativeDriver: false,
    }).start();
  }, [isTracking, crossfade]);

  const backgroundColor = crossfade.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.status.good, theme.status.bad],
  });

  // The label always slides bottom-to-top, whichever way the toggle flips — reusing crossfade's
  // own direction for translateY would reverse the slide on Stop, reading as two different
  // gestures instead of one repeating motion. `shift` is a one-shot value driving only the label,
  // independent of which state crossfade is heading to.
  const shift = useRef(new Animated.Value(1)).current;
  const [outgoingLabel, setOutgoingLabel] = useState<string | null>(null);
  const currentLabel = isTracking ? '■ Stop Tracking' : '▶ Start Tracking';
  const previousLabelRef = useRef(currentLabel);

  useEffect(() => {
    if (previousLabelRef.current === currentLabel) {
      return;
    }
    setOutgoingLabel(previousLabelRef.current);
    previousLabelRef.current = currentLabel;
    shift.setValue(0);
    Animated.timing(shift, {
      toValue: 1,
      duration: 260,
      useNativeDriver: false,
    }).start(() => setOutgoingLabel(null));
  }, [currentLabel, shift]);

  const incomingTranslateY = shift.interpolate({
    inputRange: [0, 1],
    outputRange: [22, 0],
  });
  const incomingOpacity = shift.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, 0, 1],
  });
  const outgoingTranslateY = shift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -22],
  });
  const outgoingOpacity = shift.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0, 0],
  });

  return (
    <Pressable disabled={isBusy} onPress={isTracking ? onStop : onStart}>
      <Animated.View
        style={{
          borderRadius: 14,
          paddingVertical: 16,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor,
          opacity: isBusy ? 0.6 : 1,
          // Tinted with the button's own colour rather than black: a green primary sitting on a
          // near-white card reads as pressed-in under a neutral shadow and as raised under this one.
          shadowColor: isTracking ? theme.status.bad : theme.status.good,
          shadowOpacity: 0.35,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
          elevation: 4,
        }}
      >
        {outgoingLabel ? (
          <Animated.Text
            style={{
              color: theme.onSolid,
              fontSize: 15,
              fontWeight: '700',
              opacity: outgoingOpacity,
              transform: [{ translateY: outgoingTranslateY }],
              position: 'absolute',
            }}
          >
            {outgoingLabel}
          </Animated.Text>
        ) : null}
        <Animated.Text
          style={{
            color: theme.onSolid,
            fontSize: 15,
            fontWeight: '700',
            opacity: outgoingLabel ? incomingOpacity : 1,
            transform: [{ translateY: outgoingLabel ? incomingTranslateY : 0 }],
          }}
        >
          {currentLabel}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

// MARK: - FactGroup

/// A boxed section of related facts — Motion state, Authorization and Accuracy sit side by side in
/// a row where a border on each would read as a grid rather than a set of cards.
function FactGroup({
  theme,
  children,
  filled,
}: {
  theme: ReturnType<typeof useTheme>;
  children: ReactNode;
  /// Tinted fill instead of an outline — for boxes that sit side by side in a row, where a
  /// border on each reads as a grid rather than a set of cards.
  filled?: boolean;
}) {
  return (
    <View
      style={{
        gap: spacing.tight,
        padding: 11,
        borderRadius: radius.inner,
        ...(filled
          ? {
              backgroundColor: theme.fill,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: theme.fillBorder,
            }
          : { borderWidth: 1, borderColor: theme.separator }),
      }}
    >
      {children}
    </View>
  );
}

// MARK: - Tints

function motionTint(
  state: MotionState,
  theme: ReturnType<typeof useTheme>
): string {
  switch (state) {
    case 'moving':
      return theme.status.good;
    case 'stopPending':
      return theme.status.warn;
    default:
      return theme.idle;
  }
}

function tierTint(
  tier: PermissionTier,
  theme: ReturnType<typeof useTheme>
): string {
  switch (tier) {
    case 'always':
      return theme.status.good;
    case 'foreground':
      return theme.status.warn;
    default:
      // An unrecognised tier is treated as the weakest one. Tinting it green would tell the user
      // background capture is safe on the strength of a value this build cannot interpret.
      return theme.status.bad;
  }
}

import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import type {
  BatteryInfo,
  MotionState,
  PermissionTier,
  PowerSource,
} from '@fieldtrack360/react-native-tracker';
import { spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  DiagnosticCard,
  Divider,
  ExplanationBox,
  FactRow,
  LogPane,
  Note,
  Pill,
  Screen,
  Sheet,
  shortId,
  withAlpha,
} from '../ui';
import { useTracking } from '../state/tracking';
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
}: {
  isPermissionLadderVisible: boolean;
  onOpenPermissionLadder: () => void;
  onClosePermissionLadder: () => void;
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

  const { state } = tracking;
  const snapshot = state.kind === 'loaded' ? state.value : undefined;
  const isTracking = snapshot?.isTracking === true;

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
        title="Status"
        glyph="📡"
        right={
          snapshot?.battery ? (
            <BatteryBadge battery={snapshot.battery} theme={theme} />
          ) : undefined
        }
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
            <FactRow
              name="Tracking"
              value={snapshot.isTracking ? 'RECORDING' : 'STOPPED'}
              tint={snapshot.isTracking ? theme.status.good : theme.idle}
            />
            <FactRow
              name="Motion state"
              value={snapshot.motionState}
              tint={motionTint(snapshot.motionState, theme)}
            />
            <FactRow
              name="Authorization"
              value={snapshot.tier}
              tint={tierTint(snapshot.tier, theme)}
            />
            <FactRow name="Accuracy" value={snapshot.accuracy} />
            <FactRow name="Session" value={shortId(snapshot.sessionId)} />
            <FactRow name="Accepted points" value={snapshot.pointCount} />
            {snapshot.battery ? (
              <>
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
                />
              </>
            ) : null}
            {snapshot.detectedActivity ? (
              <FactRow name="Activity" value={snapshot.detectedActivity} />
            ) : null}
            {snapshot.lastError ? (
              <>
                <Divider />
                {/* Kept on screen rather than flashed as a toast. A backgroundPermissionMissing is a
                    degradation the run continues under, and the tester needs to still be able to
                    read it an hour later when the track has a hole in it. */}
                <FactRow
                  name="Last error"
                  value={snapshot.lastError}
                  tint={theme.status.bad}
                />
              </>
            ) : null}
          </View>
        ) : null}

        <ActionRow>
          <ActionButton
            title="Start"
            glyph="▶"
            prominent
            disabled={isSwitching || isTracking}
            onPress={() => {
              // Always is the rung start() actually needs for a complete run; foreground-only
              // still records, but silently loses every background leg. Send the tester to the
              // ladder instead of starting a run they will not recognise as degraded.
              if (snapshot?.tier !== 'always') {
                onOpenPermissionLadder();
                return;
              }
              void switching(() => tracking.start('sample'));
            }}
          />
          <ActionButton
            title="Stop"
            glyph="■"
            disabled={isSwitching || !isTracking}
            onPress={() => void switching(() => tracking.stop())}
          />
        </ActionRow>
      </DiagnosticCard>

      {/* MARK: - Header shortcuts
          Upload and the permission ladder moved into the header (☁️ / 🔐) so Home stays a status
          panel rather than a settings page. This card is the one place that still says what those
          two icons open, for a tester who has not pressed them yet — collapsed by default since it
          is a one-time explainer, not a diagnostic. */}
      <DiagnosticCard
        title="Header shortcuts"
        glyph="ℹ️"
        onHeaderPress={() => setIsShortcutsExpanded((expanded) => !expanded)}
        right={
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: withAlpha(theme.accent, 0.14),
            }}
          >
            <Text
              style={{
                color: theme.accent,
                fontSize: 24,
                fontWeight: '700',
                marginTop: isShortcutsExpanded ? 0 : -5,
                marginBottom: isShortcutsExpanded ? -5 : 0,
                transform: [
                  { rotate: isShortcutsExpanded ? '180deg' : '0deg' },
                ],
              }}
            >
              ▾
            </Text>
          </View>
        }
      >
        {isShortcutsExpanded ? (
          <>
            <View style={{ flexDirection: 'row', gap: spacing.row }}>
              <Text style={{ fontSize: 16 }}>☁️</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: theme.label, fontWeight: '600' }}>
                  Upload
                </Text>
                <Note>
                  Endpoint, queue and the HTTP feed — configuring where points
                  upload to.
                </Note>
              </View>
            </View>
            <Divider />
            <View style={{ flexDirection: 'row', gap: spacing.row }}>
              <Text style={{ fontSize: 16 }}>🔐</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: theme.label, fontWeight: '600' }}>
                  Permission ladder
                </Text>
                <Note>
                  Foreground, background, motion and notification permissions —
                  also opens on its own if Start is pressed without Always
                  granted.
                </Note>
              </View>
            </View>
          </>
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
      <DiagnosticCard title="Capture log" glyph="📄">
        <FactRow name="Size" value={`${tracking.captureLogSizeKB} KB`} />

        <ActionRow>
          {/* Disabled rather than hidden: a control that vanishes reads as a missing feature, one
              that greys out reads as a missing input. */}
          <ActionButton
            title="Share"
            glyph="↗"
            disabled={tracking.captureLogSizeKB === 0}
            onPress={() => void tracking.shareCaptureLog()}
          />
          <ActionButton
            title="Clear"
            glyph="🗑"
            destructive
            disabled={tracking.captureLogSizeKB === 0}
            onPress={confirmClear}
          />
        </ActionRow>

        <ActionRow>
          <ActionButton
            title="Dump"
            glyph="⬇"
            disabled={!tracking.resolvedSessionId}
            onPress={() => void tracking.dumpSession()}
          />
          {/* Not disabled on the session, unlike every other button here: one fix needs ready() and
              nothing else, and being able to press this while stopped is the whole point of the
              API. */}
          <ActionButton
            title="One fix"
            glyph="📍"
            onPress={() => void tracking.showCurrentLocation()}
          />
          <ActionButton
            title="Fixture"
            glyph="📦"
            disabled={!tracking.resolvedSessionId}
            onPress={() => void tracking.recordFixture()}
          />
        </ActionRow>

        <Note>
          One log, appended across the life of the process, with a banner per
          launch. Clear it before a field run and share it after. On this
          platform it lives in memory rather than in a file — React Native ships
          no filesystem API and the sample takes no dependency to get one — so
          the cross-launch comparison the iOS sample relies on is not available
          here.
        </Note>
      </DiagnosticCard>

      {/* MARK: - Event feed */}
      <DiagnosticCard title="Events" glyph="📋">
        {tracking.log.length === 0 ? (
          <Note>
            No events yet. The stream starts at ready() and carries the full
            vocabulary — locations, rejections, motion and provider changes,
            heartbeats and errors.
          </Note>
        ) : (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pill
                text={`${tracking.log.length} LINES`}
                tint={theme.separator}
              />
              <View style={{ flex: 1 }} />
              <Text style={{ color: theme.secondaryLabel, fontSize: 11 }}>
                newest first
              </Text>
            </View>
            {/* The durable record is the capture log; this is the convenience copy, capped by the
                shared state. Rendered in a fixed-height pane so a busy drive cannot push the rest of
                the screen off the bottom. */}
            <LogPane lines={tracking.log} />
          </>
        )}
      </DiagnosticCard>
    </Screen>
  );
}

// MARK: - Battery badge

/// Header glyph on Status: charging beats low beats normal, since a charging-but-low device is
/// answering "why am I still not full" rather than "am I about to die".
function BatteryBadge({
  battery,
  theme,
}: {
  battery: BatteryInfo;
  theme: ReturnType<typeof useTheme>;
}) {
  const glyph = battery.isCharging ? '🔌' : battery.isLow ? '🪫' : '🔋';
  const tint = battery.isLow
    ? theme.status.bad
    : battery.isCharging
      ? theme.status.good
      : theme.label;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Text style={{ fontSize: 16 }}>{glyph}</Text>
      <Text style={{ color: tint, fontWeight: '600', fontSize: 13 }}>
        {battery.percent != null ? `${battery.percent}%` : '—'}
      </Text>
    </View>
  );
}

function powerSourceLabel(source: PowerSource): string {
  switch (source) {
    case 'none':
      return 'On battery';
    case 'ac':
      return 'AC';
    case 'usb':
      return 'USB';
    case 'wireless':
      return 'Wireless';
    case 'dock':
      return 'Dock';
    default:
      return 'Unknown';
  }
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

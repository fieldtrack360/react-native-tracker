import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import Tracker, {
  onTrackerEvent,
  type Geofence,
  type GeofenceCrossing,
  type GeofenceTransition,
} from '@fieldtrack360/react-native-tracker';
import { font, spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  Chip,
  CollapseChevron,
  DiagnosticCard,
  Divider,
  ExplanationBox,
  FactRow,
  LabelledField,
  Note,
  Screen,
} from '../ui';
import { useTracking } from '../state/tracking';

// The geofence instrument — the port of SampleApp/Modules/Geofences/GeofenceView.swift and its own
// view model.
//
// Arranged to answer the three questions a tester actually has, in order: what is armed, what has
// crossed while I was watching, and — the one that matters — what crossed while I was NOT. The live
// feed and the history are deliberately separate lists rather than one merged one, because the
// difference between them is the whole point of storing crossings: a crossing delivered to a
// relaunched app appears only in the second.
//
// Its own state rather than more surface on the shared tracking state, because geofences are
// independent of tracking in the SDK and the screen has to be able to demonstrate that: you can arm
// a fence, close the app, walk out of it and come back to a crossing recorded with no session ever
// having been started.

const HISTORY_LIMIT = 100;
const LIVE_LIMIT = 40;
const MS_PER_MINUTE = 60_000;

/// The radii worth one tap. 100 m is the floor the OS will actually monitor, so it is the first
/// preset rather than a smaller number a tester would have to learn is a lie; the rest walk up in
/// the steps a walk test is planned in.
const RADIUS_PRESETS_M = [100, 200, 500, 1000];
/// Dwell in minutes, with 0 standing for off — the SDK's default, and a different thing from zero.
const DWELL_PRESETS_MIN = [0, 5, 15, 30];
/// How long the button holds its success or failure colour before returning to the arm label.
const OUTCOME_FLASH_MS = 2400;

/// What the button is doing. The arm is the one action on this screen that can take a second — it
/// waits on a location fix — so the control reports the whole round trip rather than only dimming.
type ArmPhase = 'idle' | 'locating' | 'armed' | 'refused';

export function FencesScreen() {
  const theme = useTheme();
  const tracking = useTracking();

  const [fences, setFences] = useState<Geofence[]>([]);
  /// The stored crossing history — the read that matters most on this screen.
  const [history, setHistory] = useState<GeofenceCrossing[]>([]);
  /// Crossings seen live, newest first. Cleared on every launch, unlike the history.
  const [live, setLive] = useState<string[]>([]);
  /// The line under the arm button, and only for an arm that did NOT happen — a missing fix, a
  /// refusal, a bad field. Everything that worked is already said by the button's flash and the
  /// Armed list; everything else on this screen reports to the capture log instead.
  const [armMessage, setArmMessage] = useState<string | undefined>(undefined);
  const [armPhase, setArmPhase] = useState<ArmPhase>('idle');
  const isWorking = armPhase === 'locating';
  /// Cleared on unmount and on every new press, so a second arm never inherits the previous one's
  /// pending return to idle.
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  /// The three lists below the arm card collapse independently, the same way the diagnostics on
  /// Home do — a screen with a dozen armed fences and a hundred stored crossings is otherwise all
  /// scroll. All collapsed by default, like Home's diagnostics: the arm card stays in reach and
  /// each list is opened when a tester goes looking.
  const [isArmedExpanded, setIsArmedExpanded] = useState(false);
  const [isLiveExpanded, setIsLiveExpanded] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  const [radiusText, setRadiusText] = useState('200');
  const [dwellMinutesText, setDwellMinutesText] = useState('');

  /// Whether each row is typing its own value. Held as state rather than derived from "the text
  /// matches no preset", because a tester who clears the field mid-edit would otherwise have the
  /// keyboard yanked away by their own backspace.
  const [isRadiusCustom, setIsRadiusCustom] = useState(false);
  const [isDwellCustom, setIsDwellCustom] = useState(false);

  /// A typed value no preset covers is custom whether or not the chip is still lit — otherwise
  /// toggling Custom off would hide a 37 m radius behind a row of chips none of which is selected,
  /// and the card would be lying about what it is about to arm. A preset tap is the way back.
  const radiusIsCustom =
    isRadiusCustom || !RADIUS_PRESETS_M.includes(Number(radiusText));
  const dwellIsCustom =
    isDwellCustom ||
    !DWELL_PRESETS_MIN.includes(
      dwellMinutesText.trim() === '' ? 0 : Number(dwellMinutesText)
    );

  /// `tracking` is a fresh object on every tracking-state tick, so it cannot go in refresh's deps:
  /// refresh would be rebuilt each tick and the effect below would re-read the platform's fence
  /// list on every location update. The ref keeps the logger current without the identity.
  const noteRef = useRef(tracking.note);
  noteRef.current = tracking.note;

  const refresh = useCallback(async () => {
    try {
      setFences(await Tracker.geofences.list());
    } catch (error) {
      noteRef.current('FENCE', `armed list unavailable: ${String(error)}`);
    }
    try {
      setHistory(await Tracker.geofences.getEvents({ limit: HISTORY_LIMIT }));
    } catch (error) {
      noteRef.current('FENCE', `history unavailable: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(
    () => () => {
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
      }
    },
    []
  );

  useEffect(() => {
    const unsubscribe = onTrackerEvent((event) => {
      let kind: string | undefined;
      let id: string | undefined;
      if (event.type === 'geofenceEnter') {
        kind = 'ENTER';
        id = event.crossing.geofenceId;
      } else if (event.type === 'geofenceExit') {
        kind = 'EXIT';
        id = event.crossing.geofenceId;
      } else if (event.type === 'geofenceDwell') {
        // Worth calling out on screen: this is the one Android does not have, and the timestamp is
        // when the condition was met rather than when it arrived.
        kind = 'DWELL';
        id = event.crossing.geofenceId;
      } else if (event.type === 'geofenceAdded') {
        // Both platforms. The SDK confirming an arm is how a tester tells "the fence never armed"
        // from "the fence armed and never fired" — and the radius on this event is the CLAMPED one,
        // so it is also where a fence asked for at 50 m shows up as the 100 m the OS will monitor.
        kind = 'ADDED';
        id = event.geofence.id;
      } else if (event.type === 'geofenceRemoved') {
        kind = 'REMOVED';
        id = event.geofenceId;
      }
      if (!kind || !id) {
        return;
      }
      const stamp = new Date().toLocaleTimeString();
      setLive((previous) =>
        [`${stamp}  ${kind}  ${id}`, ...previous].slice(0, LIVE_LIMIT)
      );
      void refresh();
    });
    return unsubscribe;
  }, [refresh]);

  /// The two fields, read once. Kept as a memo rather than parsed inside the press so the button
  /// can refuse a bad radius before it is tapped — a control that looks armable and then reports a
  /// typo is the worst version of this card.
  const parsed = useMemo((): {
    error?: string;
    radiusM?: number;
    dwellAfterMs?: number;
  } => {
    const radiusM = Number(radiusText);
    if (radiusText.trim() === '' || !Number.isFinite(radiusM) || radiusM <= 0) {
      return { error: 'Radius must be a positive number of metres' };
    }
    // Empty means no dwell, which is the SDK's default and a different thing from zero.
    if (dwellMinutesText.trim() === '') {
      return { radiusM };
    }
    const minutes = Number(dwellMinutesText);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return { error: 'Dwell must be blank or a positive number of minutes' };
    }
    return { radiusM, dwellAfterMs: Math.round(minutes * MS_PER_MINUTE) };
  }, [radiusText, dwellMinutesText]);

  /// What the button is about to do, in the button. Reads back the CLAMPED floor as well, so a
  /// tester who typed 50 m sees the 100 m the OS will monitor before arming rather than after.
  const armSummary = useMemo(() => {
    if (parsed.error || parsed.radiusM == null) {
      return parsed.error;
    }
    const radius = Math.round(parsed.radiusM);
    const dwell =
      parsed.dwellAfterMs != null
        ? `${Math.round(parsed.dwellAfterMs / MS_PER_MINUTE)} min dwell`
        : 'no dwell';
    const clamped = radius < 100 ? ' (OS floor ~100 m)' : '';
    return `${radius} m · ${dwell}${clamped}`;
  }, [parsed]);

  /// Arms a fence around wherever the device is now.
  ///
  /// Uses getCurrentLocation() rather than the last stored point on purpose: a fence has to be
  /// armable with no session ever having run, and reaching for a stored point would make this screen
  /// depend on the tracking one.
  const addFenceHere = async () => {
    if (parsed.error || parsed.radiusM == null) {
      setArmMessage(parsed.error);
      return;
    }

    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
    }
    setArmMessage(undefined);
    setArmPhase('locating');
    // Every exit from here that is not an arm reads as a refusal on the button, including a missing
    // fix: from the tester's side "no fence exists" is the same outcome whatever refused it.
    let outcome: ArmPhase = 'refused';
    try {
      const fix = await Tracker.getCurrentLocation();
      if (!fix.ok) {
        setArmMessage(`no fix: ${fix.message}`);
        return;
      }

      const result = await Tracker.geofences.add({
        id: `fence-${Math.floor(Date.now() / 1000)}`,
        latitude: fix.value.latitude,
        longitude: fix.value.longitude,
        radiusM: parsed.radiusM,
        ...(parsed.dwellAfterMs != null
          ? { dwellAfterMs: parsed.dwellAfterMs }
          : {}),
      });

      if (result.ok) {
        // Nothing on screen: the button's green flash says it armed and the Armed list below says
        // what armed, so a line repeating it is a third copy of the same fact. The clamped radius
        // the SDK returns — what exists, not what was asked for — goes to the capture log.
        tracking.note(
          'FENCE',
          `armed ${result.value.id} r=${Math.round(result.value.radiusM)}m`
        );
        outcome = 'armed';
      } else {
        // dwellAfterMs is iOS-only: setting it on Android resolves invalidConfig naming the field.
        // A domain refusal, resolved as a value — not a thrown error.
        setArmMessage(`${result.code}: ${result.message}`);
        tracking.note('FENCE', `arm refused ${result.code}: ${result.message}`);
      }
      await refresh();
    } finally {
      setArmPhase(outcome);
      flashTimer.current = setTimeout(
        () => setArmPhase('idle'),
        OUTCOME_FLASH_MS
      );
    }
  };

  const remove = async (fence: Geofence) => {
    const result = await Tracker.geofences.remove(fence.id);
    tracking.note(
      'FENCE',
      result.ok
        ? result.value
          ? `removed ${fence.id}`
          : `${fence.id} was not armed`
        : `remove refused ${result.code}: ${result.message}`
    );
    await refresh();
  };

  /// Removing every fence at once is the one press on this screen that cannot be undone by another
  /// press — a fence armed around a spot the tester has since driven away from cannot be re-armed
  /// from here — so it asks first, the same way Home's clear does.
  const confirmRemoveAll = () => {
    Alert.alert(
      `Remove ${fences.length} armed fence${fences.length === 1 ? '' : 's'}?`,
      'Every fence is unarmed on the platform immediately and stops firing. The recorded crossing ' +
        'history is kept — clear that separately under History.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove all',
          style: 'destructive',
          onPress: () => void removeAll(),
        },
      ]
    );
  };

  const removeAll = async () => {
    const result = await Tracker.geofences.removeAll();
    tracking.note(
      'FENCE',
      result.ok
        ? `removed ${result.value} fence${result.value === 1 ? '' : 's'}`
        : `remove all refused ${result.code}: ${result.message}`
    );
    await refresh();
  };

  /// Clears the crossing history and leaves the fences armed — the two are deliberately separate
  /// calls in the SDK, and this screen should show that.
  const clearHistory = async () => {
    try {
      const removed = await Tracker.geofences.deleteEvents();
      tracking.note('FENCE', `history cleared (${removed} rows)`);
    } catch (error) {
      tracking.note('FENCE', `clear failed: ${String(error)}`);
    }
    await refresh();
  };

  return (
    <Screen>
      {/* MARK: - Arm */}
      <DiagnosticCard title="Arm a fence here" glyph="📍">
        {/* Presets first, fields second. Every radius a walk test actually uses is one tap, and the
            field below stays for the odd value — the keyboard is the exception, not the path. */}
        <View style={{ gap: spacing.tight }}>
          <Text style={{ color: theme.secondaryLabel, fontSize: 12 }}>
            Radius (m)
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing.tight,
            }}
          >
            {RADIUS_PRESETS_M.map((metres) => (
              <Chip
                key={metres}
                title={String(metres)}
                compact
                isOn={!radiusIsCustom && Number(radiusText) === metres}
                onPress={() => {
                  setIsRadiusCustom(false);
                  setRadiusText(String(metres));
                }}
              />
            ))}
            <Chip
              title="Custom"
              compact
              isOn={radiusIsCustom}
              onPress={() => setIsRadiusCustom((custom) => !custom)}
            />
          </View>
          {/* The field is the exception, not the path: it appears only once a tester asks for it,
              carrying whatever the last preset left behind as its starting value. */}
          {radiusIsCustom ? (
            <LabelledField
              name="Radius (m)"
              value={radiusText}
              onChange={setRadiusText}
              keyboardType="decimal-pad"
            />
          ) : null}
        </View>

        <View style={{ gap: spacing.tight }}>
          <Text style={{ color: theme.secondaryLabel, fontSize: 12 }}>
            Dwell (min)
          </Text>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              gap: spacing.tight,
            }}
          >
            {DWELL_PRESETS_MIN.map((minutes) => (
              <Chip
                key={minutes}
                title={minutes === 0 ? 'Off' : String(minutes)}
                compact
                // Off is a real choice, not an absence: it selects in the ink colour so a
                // selected Off reads as loud as a selected dwell.
                tint={minutes === 0 ? theme.label : theme.status.good}
                isOn={
                  dwellIsCustom
                    ? false
                    : minutes === 0
                      ? dwellMinutesText.trim() === ''
                      : Number(dwellMinutesText) === minutes
                }
                onPress={() => {
                  setIsDwellCustom(false);
                  setDwellMinutesText(minutes === 0 ? '' : String(minutes));
                }}
              />
            ))}
            <Chip
              title="Custom"
              compact
              tint={theme.status.good}
              isOn={dwellIsCustom}
              onPress={() => setIsDwellCustom((custom) => !custom)}
            />
          </View>
          {dwellIsCustom ? (
            <LabelledField
              name="Dwell (min)"
              value={dwellMinutesText}
              onChange={setDwellMinutesText}
              placeholder="off"
              keyboardType="decimal-pad"
            />
          ) : null}
        </View>

        {/* One control, four readings: what it will do, that it is waiting on a fix, that a fence
            exists, that one was refused. The colour carries the outcome so the message box below is
            the detail rather than the only signal. */}
        <ActionButton
          title={
            armPhase === 'locating'
              ? 'Finding your location…'
              : armPhase === 'armed'
                ? 'Fence armed'
                : armPhase === 'refused'
                  ? 'Not armed — see below'
                  : 'Arm at current location'
          }
          glyph={
            armPhase === 'armed' ? '✓' : armPhase === 'refused' ? '⚠' : '＋'
          }
          subtitle={armPhase === 'idle' ? armSummary : undefined}
          // Green rather than the app's accent blue: arming is the fence action, and the stored-layer
          // green is the colour this app already uses for "a thing now exists on the platform". The
          // refusal state is the only one that leaves it.
          tone={armPhase === 'refused' ? theme.status.bad : theme.status.good}
          prominent
          busy={isWorking}
          disabled={parsed.error != null}
          onPress={() => void addFenceHere()}
        />

        {armMessage ? (
          <ExplanationBox text={armMessage} tint={theme.idle} />
        ) : null}

        <Note>
          A fence needs ready() and location authorization — not a session. Arm
          one, stop tracking, close the app: it still fires. Below ~100 m
          regions fire unreliably, and iOS allows 20 per app with one reserved
          for the SDK's own stationary fence.
        </Note>
        <Note>
          Dwell is iOS-only. With a dwell set, add() resolves{' '}
          {'{ ok:false, code:"invalidConfig" }'} on Android naming the field — a
          refusal you can read in the message above, not a thrown error.
        </Note>
      </DiagnosticCard>

      {/* MARK: - Armed */}
      <DiagnosticCard
        title="Armed"
        glyph="⭕️"
        onHeaderPress={() => setIsArmedExpanded((expanded) => !expanded)}
        right={<CollapseChevron expanded={isArmedExpanded} theme={theme} />}
      >
        {!isArmedExpanded ? null : fences.length === 0 ? (
          <Note>
            Nothing armed. Read back from the platform, not from a list of our
            own.
          </Note>
        ) : (
          <>
            {fences.map((fence) => (
              <View
                key={fence.id}
                style={{ gap: spacing.hair, paddingBottom: spacing.tight }}
              >
                <FactRow
                  name={fence.id}
                  value={`${Math.round(fence.radiusM)} m`}
                />
                <FactRow
                  name={`${fence.latitude.toFixed(5)}, ${fence.longitude.toFixed(5)}`}
                  value={
                    fence.dwellAfterMs != null
                      ? `dwell ${Math.round(fence.dwellAfterMs / MS_PER_MINUTE)} min`
                      : 'no dwell'
                  }
                  tint={
                    fence.dwellAfterMs != null
                      ? theme.status.good
                      : theme.secondaryLabel
                  }
                />
                {/* The facts sit on `hair` gaps so they read as one block; the destructive button
                    needs air above it so a thumb aiming at the coordinates cannot land on it. */}
                <View style={{ marginTop: spacing.tight }}>
                  <ActionButton
                    title="Remove"
                    glyph="🗑"
                    destructive
                    onPress={() => void remove(fence)}
                  />
                </View>
                <Divider />
              </View>
            ))}
            <ActionButton
              title="Remove all"
              glyph="🗑"
              destructive
              onPress={confirmRemoveAll}
            />
          </>
        )}
      </DiagnosticCard>

      {/* MARK: - Live */}
      <DiagnosticCard
        title="Live feed"
        glyph="📡"
        onHeaderPress={() => setIsLiveExpanded((expanded) => !expanded)}
        right={<CollapseChevron expanded={isLiveExpanded} theme={theme} />}
      >
        {!isLiveExpanded ? null : live.length === 0 ? (
          <Note>
            Crossings seen while this app was running. Empty is normal.
          </Note>
        ) : (
          live.map((line, index) => (
            <Text
              key={`${index}-${line}`}
              style={{
                color: theme.label,
                fontFamily: font.mono,
                fontSize: 12,
              }}
            >
              {line}
            </Text>
          ))
        )}
      </DiagnosticCard>

      {/* MARK: - History */}
      <DiagnosticCard
        title="History"
        glyph="🕘"
        onHeaderPress={() => setIsHistoryExpanded((expanded) => !expanded)}
        right={<CollapseChevron expanded={isHistoryExpanded} theme={theme} />}
      >
        {isHistoryExpanded ? (
          <>
            <Note>
              Read from storage. A crossing delivered to a relaunched app is
              written before any host is subscribed, so this is the only place
              it can be seen — if this list has rows the live feed never showed,
              that is the SDK working as intended.
            </Note>

            {history.length === 0 ? (
              <Note>No crossings recorded.</Note>
            ) : (
              <>
                {history.map((crossing, index) => (
                  <FactRow
                    key={`${crossing.geofenceId}-${crossing.timeMs ?? index}`}
                    name={`${crossing.timeMs ? new Date(crossing.timeMs).toLocaleTimeString() : '—'}  ${crossing.geofenceId}`}
                    value={crossing.transition.toUpperCase()}
                    tint={transitionTint(crossing.transition, theme)}
                  />
                ))}
                <ActionButton
                  title="Clear history"
                  glyph="🗑"
                  destructive
                  onPress={() => void clearHistory()}
                />
              </>
            )}

            <ActionRow>
              <ActionButton
                title="Reload"
                glyph="↻"
                onPress={() => void refresh()}
              />
            </ActionRow>
          </>
        ) : null}
      </DiagnosticCard>
    </Screen>
  );
}

function transitionTint(
  transition: GeofenceTransition,
  theme: ReturnType<typeof useTheme>
): string {
  switch (transition) {
    case 'enter':
      return theme.status.good;
    case 'exit':
      return theme.status.warn;
    // The one Android does not have. Coloured distinctly because "did the dwell fire, and when" is
    // the question this screen exists to answer.
    case 'dwell':
      return theme.layer.filter;
    default:
      return theme.idle;
  }
}

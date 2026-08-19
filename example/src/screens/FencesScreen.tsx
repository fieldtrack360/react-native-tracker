import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
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

export function FencesScreen() {
  const theme = useTheme();
  const tracking = useTracking();

  const [fences, setFences] = useState<Geofence[]>([]);
  /// The stored crossing history — the read that matters most on this screen.
  const [history, setHistory] = useState<GeofenceCrossing[]>([]);
  /// Crossings seen live, newest first. Cleared on every launch, unlike the history.
  const [live, setLive] = useState<string[]>([]);
  const [lastMessage, setLastMessage] = useState<string | undefined>(undefined);
  const [isWorking, setIsWorking] = useState(false);

  const [radiusText, setRadiusText] = useState('200');
  const [dwellMinutesText, setDwellMinutesText] = useState('');

  const refresh = useCallback(async () => {
    try {
      setFences(await Tracker.geofences.list());
    } catch (error) {
      setLastMessage(`armed list unavailable: ${String(error)}`);
    }
    try {
      setHistory(await Tracker.geofences.getEvents({ limit: HISTORY_LIMIT }));
    } catch (error) {
      setLastMessage(`history unavailable: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
      } else if (
        event.type === 'geofenceAdded' ||
        event.type === 'geofenceRemoved'
      ) {
        // Android-only. The SDK confirming an arm is how a tester tells "the fence never armed"
        // from "the fence armed and never fired".
        kind = event.type === 'geofenceAdded' ? 'ADDED' : 'REMOVED';
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

  /// Arms a fence around wherever the device is now.
  ///
  /// Uses getCurrentLocation() rather than the last stored point on purpose: a fence has to be
  /// armable with no session ever having run, and reaching for a stored point would make this screen
  /// depend on the tracking one.
  const addFenceHere = async () => {
    setIsWorking(true);
    try {
      const fix = await Tracker.getCurrentLocation();
      if (!fix.ok) {
        setLastMessage(`no fix: ${fix.message}`);
        return;
      }

      const radiusM = Number(radiusText);
      if (!Number.isFinite(radiusM) || radiusM <= 0) {
        setLastMessage('radius must be a positive number of metres');
        return;
      }

      // Empty means no dwell, which is the SDK's default and a different thing from zero.
      let dwellAfterMs: number | undefined;
      if (dwellMinutesText !== '') {
        const minutes = Number(dwellMinutesText);
        if (!Number.isFinite(minutes) || minutes <= 0) {
          setLastMessage('dwell must be blank or a positive number of minutes');
          return;
        }
        dwellAfterMs = Math.round(minutes * MS_PER_MINUTE);
      }

      const result = await Tracker.geofences.add({
        id: `fence-${Math.floor(Date.now() / 1000)}`,
        latitude: fix.value.latitude,
        longitude: fix.value.longitude,
        radiusM,
        ...(dwellAfterMs != null ? { dwellAfterMs } : {}),
      });

      if (result.ok) {
        // The radius comes back clamped to what the OS will actually monitor, so the message reports
        // what exists rather than what was asked for.
        setLastMessage(
          `armed ${result.value.id} at ${Math.round(result.value.radiusM)} m`
        );
        tracking.note(
          'FENCE',
          `armed ${result.value.id} r=${Math.round(result.value.radiusM)}m`
        );
      } else {
        // dwellAfterMs is iOS-only: setting it on Android resolves invalidConfig naming the field.
        // A domain refusal, resolved as a value — not a thrown error.
        setLastMessage(`${result.code}: ${result.message}`);
        tracking.note('FENCE', `arm refused ${result.code}: ${result.message}`);
      }
      await refresh();
    } finally {
      setIsWorking(false);
    }
  };

  const remove = async (fence: Geofence) => {
    const result = await Tracker.geofences.remove(fence.id);
    setLastMessage(
      result.ok
        ? result.value
          ? `removed ${fence.id}`
          : `${fence.id} was not armed`
        : `${result.code}: ${result.message}`
    );
    await refresh();
  };

  const removeAll = async () => {
    const result = await Tracker.geofences.removeAll();
    setLastMessage(
      result.ok
        ? `removed ${result.value} fence${result.value === 1 ? '' : 's'}`
        : `${result.code}: ${result.message}`
    );
    await refresh();
  };

  /// Clears the crossing history and leaves the fences armed — the two are deliberately separate
  /// calls in the SDK, and this screen should show that.
  const clearHistory = async () => {
    try {
      const removed = await Tracker.geofences.deleteEvents();
      setLastMessage(`history cleared (${removed} rows)`);
    } catch (error) {
      setLastMessage(`clear failed: ${String(error)}`);
    }
    await refresh();
  };

  return (
    <Screen>
      {/* MARK: - Arm */}
      <DiagnosticCard title="Arm a fence here" glyph="📍">
        <View style={{ flexDirection: 'row', gap: spacing.row }}>
          <LabelledField
            name="Radius (m)"
            value={radiusText}
            onChange={setRadiusText}
            keyboardType="decimal-pad"
          />
          <LabelledField
            name="Dwell (min)"
            value={dwellMinutesText}
            onChange={setDwellMinutesText}
            placeholder="off"
            keyboardType="decimal-pad"
          />
        </View>

        <ActionButton
          title="Arm at current location"
          glyph="＋"
          prominent
          disabled={isWorking}
          onPress={() => void addFenceHere()}
        />

        {lastMessage ? (
          <ExplanationBox text={lastMessage} tint={theme.idle} />
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
      <DiagnosticCard title="Armed" glyph="⭕️">
        {fences.length === 0 ? (
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
                <ActionButton
                  title="Remove"
                  glyph="🗑"
                  destructive
                  onPress={() => void remove(fence)}
                />
                <Divider />
              </View>
            ))}
            <ActionButton
              title="Remove all"
              glyph="🗑"
              destructive
              onPress={() => void removeAll()}
            />
          </>
        )}
      </DiagnosticCard>

      {/* MARK: - Live */}
      <DiagnosticCard title="Live feed" glyph="📡">
        {live.length === 0 ? (
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
      <DiagnosticCard title="History" glyph="🕘">
        <Note>
          Read from storage. A crossing delivered to a relaunched app is written
          before any host is subscribed, so this is the only place it can be
          seen — if this list has rows the live feed never showed, that is the
          SDK working as intended.
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

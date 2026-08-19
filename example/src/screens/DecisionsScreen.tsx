import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import Tracker, { type FixDecision } from '@fieldtrack360/react-native-tracker';
import { font, spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  Chip,
  ContentUnavailable,
  DiagnosticCard,
  Note,
  Screen,
  SessionPicker,
  withAlpha,
} from '../ui';
import { useTracking, type ViewState } from '../state/tracking';

// The decision log: why each fix was accepted, skipped or rejected, and the numbers it was judged on
// — the port of SampleApp/Modules/Decisions/DecisionLogView.swift.
//
// The first of the four instruments, and the one that turns "the track is wrong here" into the name
// of a pipeline stage.
//
// ONE DIVERGENCE, forced by the wire: the iOS row prints the fix's timestamp, provider and accuracy
// alongside the verdict. The wire FixDecision carries no `fix`, so those three are not
// available here. The arguable numbers — moved, sigma, gate and effective speed — all are, and they
// are the ones every rejection is argued from.

/// The newest slice of the log. Deep enough that a 30-minute drive fits whole — the shapes below are
/// stated per-run, and a summary over 200 rows of a 4,000-row session cannot be compared against
/// them.
const PAGE_LIMIT = 2_000;

const VERDICTS = ['accept', 'skip', 'reject'] as const;
type VerdictId = (typeof VERDICTS)[number];

type DecisionLog = {
  rows: FixDecision[];
  /** The page came back full, so older verdicts exist that this screen never read. Said out loud,
   *  because a summary computed over a page and presented as a session is a lie about the session. */
  truncated: boolean;
};

export function DecisionsScreen() {
  const theme = useTheme();
  const tracking = useTracking();

  const [state, setState] = useState<ViewState<DecisionLog>>({ kind: 'idle' });
  /// All three on, so the first thing a tester sees is the whole log rather than a slice they did
  /// not ask for.
  const [enabled, setEnabled] = useState<Set<VerdictId>>(new Set(VERDICTS));

  const pinned = tracking.selectedSessionId;

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      // The live session wins, then the newest. Resolved rather than left undefined so the tab lands
      // on something the moment it opens.
      const resolved =
        pinned ??
        (await Tracker.currentSession())?.id ??
        (await Tracker.getSessions())[0]?.id;

      if (!resolved) {
        setState({ kind: 'loaded', value: { rows: [], truncated: false } });
        return;
      }

      const decisions = await Tracker.getDecisions(resolved, PAGE_LIMIT, 0);
      setState({
        kind: 'loaded',
        value: { rows: decisions, truncated: decisions.length >= PAGE_LIMIT },
      });
    } catch (error) {
      setState({
        kind: 'failed',
        message: `The decision log could not be read: ${String(error)}`,
      });
    }
  }, [pinned]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (verdict: VerdictId) => {
    setEnabled((previous) => {
      const next = new Set(previous);
      if (next.has(verdict)) {
        next.delete(verdict);
      } else {
        next.add(verdict);
      }
      return next;
    });
  };

  const log = state.kind === 'loaded' ? state.value : undefined;
  const visible = log
    ? log.rows.filter((row) => enabled.has(verdictId(row.verdict)))
    : [];
  const forcedResets = log ? log.rows.filter(isForcedReset).length : 0;

  return (
    <Screen>
      <DiagnosticCard title="Session" glyph="🕘">
        <SessionPicker
          sessions={tracking.sessions}
          selection={tracking.selectedSessionId}
          onSelect={tracking.selectSession}
          resolvedSessionId={tracking.resolvedSessionId}
        />

        <View style={{ flexDirection: 'row', gap: spacing.tight }}>
          {VERDICTS.map((verdict) => (
            <Chip
              key={verdict}
              title={`${title(verdict)}${
                // No count while the page is not loaded, so a chip shows nothing rather than a wrong
                // number. Counted over the WHOLE page rather than the filtered view — a count that
                // changed when you filtered would be useless for deciding what to filter to.
                log
                  ? `  ${log.rows.filter((row) => verdictId(row.verdict) === verdict).length}`
                  : ''
              }`}
              tint={theme.verdict[verdict]}
              isOn={enabled.has(verdict)}
              onPress={() => toggle(verdict)}
            />
          ))}
        </View>

        <ActionRow>
          <ActionButton title="Reload" glyph="↻" onPress={() => void load()} />
        </ActionRow>
      </DiagnosticCard>

      {state.kind === 'loading' || state.kind === 'idle' ? (
        <DiagnosticCard title="Log" glyph="📓">
          <ActivityIndicator />
          <Note>Reading the decision log…</Note>
        </DiagnosticCard>
      ) : null}

      {state.kind === 'failed' ? (
        <DiagnosticCard title="Log" glyph="📓">
          <ContentUnavailable
            glyph="⚠️"
            title="Log unavailable"
            message={state.message}
            actionTitle="Try again"
            onAction={() => void load()}
          />
        </DiagnosticCard>
      ) : null}

      {log && log.rows.length === 0 ? (
        <DiagnosticCard title="Log" glyph="📓">
          {/* Nothing was ever written. A different fact entirely from everything being filtered out,
              and pointed at the capture side rather than at this screen. */}
          <ContentUnavailable
            glyph="🗄"
            title="No decisions recorded"
            message={
              'Nothing was judged in this session. That is a capture question, not a filter one: ' +
              'either no fix ever reached the pipeline, or persistDecisions is off in the ' +
              'configuration this session was opened with.'
            }
          />
        </DiagnosticCard>
      ) : null}

      {log && log.rows.length > 0 && visible.length === 0 ? (
        <DiagnosticCard title="Log" glyph="📓">
          {/* Everything was written and everything is hidden. Says so, with the number, because a
              tester who reads this as "no decisions" goes looking for a capture bug that is not
              there. */}
          <ContentUnavailable
            glyph="🔻"
            title={`All ${log.rows.length} hidden by the filters`}
            message={`${log.rows.length} decisions were recorded. Every verdict chip is off, so none of them is shown.`}
            actionTitle="Show all verdicts"
            onAction={() => setEnabled(new Set(VERDICTS))}
          />
        </DiagnosticCard>
      ) : null}

      {log && visible.length > 0 ? (
        <>
          <DiagnosticCard
            title={`Top reasons — ${visible.length} shown of ${log.rows.length}`}
            glyph="🔢"
          >
            {/* Computed over the VISIBLE rows on purpose: filtering to Reject and reading the top
                four reject reasons is the fastest route from "the track stopped" to the stage that
                stopped it. */}
            <Text
              style={{
                color: theme.label,
                fontFamily: font.mono,
                fontSize: 12,
              }}
            >
              {topReasons(visible)
                .map(([reason, count]) => `${reason}×${count}`)
                .join('  ·  ') || '—'}
            </Text>
            {log.truncated ? (
              <Note>
                Newest {log.rows.length} verdicts only — older ones are not in
                this summary.
              </Note>
            ) : null}
          </DiagnosticCard>

          <ExpectedShapes forcedResets={forcedResets} />

          <DiagnosticCard title="Log — newest first" glyph="📓">
            {visible.slice(0, 300).map((row, index) => (
              <DecisionRow key={`${index}-${row.reason}`} decision={row} />
            ))}
            {visible.length > 300 ? (
              <Note>
                Showing the newest 300 of {visible.length} matching rows. The
                summary above is computed over all of them.
              </Note>
            ) : null}
            <Note>
              The wire FixDecision carries no fix timestamp, provider or
              accuracy, so those three columns from the iOS row are absent here.
              moved, σ, gate and spd are the numbers every rejection is argued
              from, and all four cross.
            </Note>
          </DiagnosticCard>
        </>
      ) : null}
    </Screen>
  );
}

// MARK: - Row

/// One verdict, with the numbers it was argued from.
///
/// `moved`, `σ`, `gate` and `spd` are the arguable numbers: every rejection in the pipeline is one
/// of them failing a comparison, so a row without them says what happened and hides why.
function DecisionRow({ decision }: { decision: FixDecision }) {
  const theme = useTheme();
  const id = verdictId(decision.verdict);
  const colour = theme.verdict[id];

  return (
    <View style={{ gap: 4, paddingVertical: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text
          style={{
            color: colour,
            backgroundColor: withAlpha(colour, 0.2),
            fontFamily: font.mono,
            fontSize: 10,
            fontWeight: '700',
            paddingHorizontal: 6,
            paddingVertical: 2,
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          {/* Rendered verbatim: the verdict and reason vocabularies are stable API, not free text. */}
          {decision.verdict.toUpperCase()}
        </Text>
        <Text
          style={{
            color: theme.label,
            fontSize: 14,
            fontWeight: '500',
            flex: 1,
          }}
        >
          {decision.reason}
        </Text>
      </View>
      <Text
        style={{
          color: theme.secondaryLabel,
          fontFamily: font.mono,
          fontSize: 12,
        }}
      >
        moved {decision.distanceMovedM.toFixed(1)}m · σ{' '}
        {decision.sigma.toFixed(1)} · gate {decision.threshold.toFixed(1)} · spd{' '}
        {decision.effectiveSpeedMps.toFixed(1)}
      </Text>
      <Text style={{ color: theme.tertiaryLabel, fontSize: 11 }}>
        motion {decision.motionState} · filter{' '}
        {decision.filterLatitude.toFixed(5)},
        {decision.filterLongitude.toFixed(5)}
      </Text>
    </View>
  );
}

// MARK: - Expected shapes

/// The two shapes worth memorising, printed where the numbers are, so a tester can compare without
/// leaving the screen or opening a document.
function ExpectedShapes({ forcedResets }: { forcedResets: number }) {
  return (
    <DiagnosticCard title="What healthy looks like" glyph="🩺">
      <Note>
        🅿️ A parked hour is dominated by Drift Suppressed, Heartbeat Skipped and
        Sigma Gate Outlier, with almost no accepts. Many accepts while parked
        means broken speed-validity flags or a missing wobble guard.
      </Note>
      <Note>
        🚗 A healthy 30-minute drive is 25–35 vehicular accepts, a handful of
        rejects at signal-poor spots, and no Sigma Forced Reset at all.
      </Note>
      {forcedResets > 0 ? (
        <Note>
          ⚠️ Sigma Forced Reset ×{forcedResets} on this page. Repeated forced
          resets mean the drift-tolerance scaling is not doing its job — do not
          widen the sigma gate to hide it.
        </Note>
      ) : null}
    </DiagnosticCard>
  );
}

// MARK: - Vocabulary

/// The three verdicts as a filterable value.
///
/// A host compiles against a vocabulary the SDK owns, so this build may meet a verdict it has never
/// seen. Folding the unknown into `reject` is the safe reading for a diagnostic: an unrecognised
/// verdict is one this UI cannot vouch for, and showing it as accepted would be a lie.
function verdictId(verdict: string): VerdictId {
  const normalised = verdict.toLowerCase();
  if (normalised === 'accept') {
    return 'accept';
  }
  if (normalised === 'skip') {
    return 'skip';
  }
  return 'reject';
}

function title(verdict: VerdictId): string {
  return verdict.charAt(0).toUpperCase() + verdict.slice(1);
}

/// The forced-reset count is surfaced on its own because zero is the expected value on every healthy
/// run, and a non-zero count names its own fix — the drift-tolerance scaling — rather than inviting
/// the sigma gate to be widened, which is the wrong repair for this symptom.
///
/// Matched on the normalised reason rather than a constant: the reason vocabulary is the SDK's, and
/// the bridge carries it as a plain string.
function isForcedReset(decision: FixDecision): boolean {
  return decision.reason
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .includes('forcedreset');
}

/// The top four reasons among the rows on screen, descending. Ties break on the reason string so the
/// line does not reshuffle between reads.
function topReasons(rows: FixDecision[], limit = 4): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) =>
      left[1] === right[1]
        ? left[0].localeCompare(right[0])
        : right[1] - left[1]
    )
    .slice(0, limit);
}

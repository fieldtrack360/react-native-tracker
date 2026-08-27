import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import Tracker, {
  LiveTrackMapView,
  TrackMapView,
  onLiveTrack,
  type LiveTrackUpdate,
  type Track,
} from '@fieldtrack360/react-native-tracker';
import { font, radius, spacing, useTheme } from '../theme';
import {
  Chip,
  ContentUnavailable,
  DiagnosticCard,
  Divider,
  ExplanationBox,
  Note,
  Pill,
  SessionPicker,
  duration as durationText,
  shortId,
} from '../ui';
import { useTracking, type ViewState } from '../state/tracking';
import { TrackTimeline } from './TrackTimeline';

// The plotting output, drawn the way a host would draw it — the port of
// SampleApp/Modules/Track/TrackView.swift.
//
// ONE DIVERGENCE FROM THE iOS SAMPLE, stated here because it is the difference a reader will notice
// first. The iOS sample renders its own MapKit map so it can layer the RAW FIX THREAD and the
// travelling arrows over the built track. React Native has no map of its own, and the bridge exposes
// the SDK's finished views — <TrackMapView> takes a Track and returns a rendered map, with no
// content builder to add to. So this screen draws the SDK's map, and the raw layer is reported as
// counts and notes rather than as a second line. Everything below the map — the ratio, the summary
// and the timeline — is the same instrument.

/// The page this tab reads, matching the one the capture log dumps with.
///
/// A page, not a cap: `buildTrack` raises `truncated` when a read comes back full and this screen
/// prints it, so a long session is reported as clipped rather than drawn short and called complete.
const PAGE_SIZE = 5000;

/// iOS-only renderer styling. `options` is platform-divergent by design (an iOS `RenderOptions`
/// shape here, an Android `RendererOptions` shape there), so this is `undefined` on Android and the
/// Android map keeps the look it already has.
///
/// What it changes, and why. The iOS SDK defaults draw one thick band with large white chevrons
/// stamped on top, which at street zoom covers the road the track is following. Here the line is
/// slimmed to a single unbordered stroke — `basePathColor` matches the green band and
/// `basePathWidth` matches `speedOverlayWidth`, so the base path never peeks out as a casing — and
/// the chevrons are sized to sit inside it; the unobserved gap keeps a thin dashed grey of its own.
const IOS_MAP_OPTIONS = {
  basePathColor: '#22C55E',
  basePathWidth: 3,
  speedBandGreen: '#22C55E',
  speedBandYellow: '#F59E0B',
  speedBandRed: '#EF4444',
  speedOverlayWidth: 5.5,
  speedOverlayOpacity: 0.95,
  arrowSize: 10,
  stopPinSize: 26,
  gapColor: '#94A3B8',
  gapLineWidth: 3,
  gapDashLengths: [6, 6],
  cameraPadding: 28,
};

const MAP_OPTIONS = Platform.OS === 'ios' ? IOS_MAP_OPTIONS : undefined;

/// The zoom step the arrows are rebuilt at. `onArrowZoom` (iOS only) fires on every camera settle,
/// and a rebuild is a database read plus a full plotting pass — so a change is only honoured once
/// it crosses half a zoom level, and the pass is debounced behind the gesture.
const ARROW_ZOOM_STEP = 0.5;
const ARROW_ZOOM_DEBOUNCE_MS = 400;

type TrackPlot = {
  sessionId: string;
  track: Track;
  rawFixCount: number;
  /** Every stored point in the session, not just the page the track was built from. */
  storedPointCount: number;
};

export function TrackScreen() {
  const tracking = useTracking();
  const theme = useTheme();

  const [state, setState] = useState<ViewState<TrackPlot>>({ kind: 'idle' });
  const [mode, setMode] = useState<'plot' | 'live'>('plot');
  const [live, setLive] = useState<LiveTrackUpdate | undefined>(undefined);
  const [rebuildToken, setRebuildToken] = useState(0);
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  // The zoom the direction arrows were built for. iOS asks for a rebuild through `onArrowZoom`;
  // Android's renderer scales its own arrows and never emits it, so this stays undefined there and
  // `buildTrack` keeps its default arrow spacing.
  const [arrowZoom, setArrowZoom] = useState<number | undefined>(undefined);
  const arrowZoomTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );

  const isTracking =
    tracking.state.kind === 'loaded' && tracking.state.value.isTracking;
  const selection = tracking.selectedSessionId;
  const { snapToRoad } = tracking;

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const resolved = selection ?? (await Tracker.currentSession())?.id;
      if (!resolved) {
        setState({
          kind: 'failed',
          message: 'No session has been recorded yet. Start one from Home.',
        });
        return;
      }

      const track = await Tracker.buildTrack(
        { sessionId: resolved, limit: PAGE_SIZE },
        // `zoom` is what makes the arrows follow the camera: the engine thins the anchors it emits
        // for a wide view and packs them in for a close one. Rebuilding is the documented answer to
        // onArrowZoom — the renderer must never rescale what it was handed.
        { snapToRoad, zoom: arrowZoom }
      );

      // The count is a separate read on purpose: buildTrack sees one page, and the ratio at the top
      // of this screen is worthless if its right-hand side silently means "up to 5000".
      const storedPointCount = await Tracker.getCount({ sessionId: resolved });

      // Layer 1 is a diagnostic, so losing it must never lose the track with it.
      let rawFixCount = 0;
      try {
        rawFixCount = (await Tracker.getRawFixes(resolved)).length;
      } catch {
        rawFixCount = 0;
      }

      setState({
        kind: 'loaded',
        value: { sessionId: resolved, track, rawFixCount, storedPointCount },
      });
    } catch (error) {
      setState({ kind: 'failed', message: String(error) });
    }
  }, [selection, snapToRoad, arrowZoom]);

  // Every input that forces a rebuild. Toggling the raw chip is deliberately absent: it changes what
  // is reported, not what was built, and rebuilding a track to change a caption would be a database
  // read and a full plotting pass to change nothing.
  useEffect(() => {
    void load();
  }, [load, rebuildToken]);

  // A run in progress has a live surface worth watching; a finished one has a plot. Either is still
  // reachable by hand from the picker.
  useEffect(() => {
    const pinned = tracking.selectedSessionId != null;
    setMode(isTracking && !pinned ? 'live' : 'plot');
  }, [isTracking, tracking.selectedSessionId]);

  useEffect(() => {
    if (mode !== 'live') {
      return;
    }
    const unsubscribe = onLiveTrack(setLive);
    return unsubscribe;
  }, [mode]);

  // iOS only. Quantise to ARROW_ZOOM_STEP, ignore anything that lands on the step already built,
  // and debounce so a pinch costs one rebuild rather than one per frame.
  const handleArrowZoom = useCallback((zoom: number) => {
    const stepped = Math.round(zoom / ARROW_ZOOM_STEP) * ARROW_ZOOM_STEP;
    if (arrowZoomTimer.current != null) {
      clearTimeout(arrowZoomTimer.current);
    }
    arrowZoomTimer.current = setTimeout(() => {
      setArrowZoom((current) => (current === stepped ? current : stepped));
    }, ARROW_ZOOM_DEBOUNCE_MS);
  }, []);

  // A pending rebuild must not fire into an unmounted screen.
  useEffect(
    () => () => {
      if (arrowZoomTimer.current != null) {
        clearTimeout(arrowZoomTimer.current);
      }
    },
    []
  );

  const plot = state.kind === 'loaded' ? state.value : undefined;
  const warnings = plot?.track.warnings ?? [];
  const isTruncated = warnings.some((warning) =>
    warning.toLowerCase().includes('truncat')
  );
  const isSnapUnavailable = warnings.some((warning) =>
    warning.toLowerCase().includes('snap')
  );
  const hasMapContent =
    mode === 'live' || (plot != null && plot.track.encodedPolyline.length > 0);
  const mapHeight = isMapExpanded ? 600 : 300;
  const mapFrame = {
    height: mapHeight,
    borderRadius: radius.inner,
    overflow: 'hidden' as const,
    backgroundColor: theme.fill,
  };

  return (
    // Transparent, like `Screen`. An opaque ground here would paint over the root backdrop's wash
    // and leave a hard horizontal edge where the scroll view ends and the tab bar's strip begins.
    // This tab keeps its own ScrollView rather than using `Screen` only for the larger bottom
    // inset the expanded map needs.
    <ScrollView
      style={{ flex: 1, backgroundColor: 'transparent' }}
      contentContainerStyle={{
        padding: spacing.screen,
        gap: spacing.section,
        paddingBottom: 48,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* MARK: - Map */}
      <DiagnosticCard
        title={mode === 'live' ? 'Live surface' : 'Plot'}
        glyph="🗺"
        right={
          <View style={{ flexDirection: 'row', gap: spacing.tight }}>
            <Chip
              title={isMapExpanded ? '⤡ Collapse' : '⤢ Expand'}
              isOn={isMapExpanded}
              isEnabled={hasMapContent}
              onPress={() => setIsMapExpanded((expanded) => !expanded)}
            />
            <Chip
              title="↻ Rebuild"
              isOn={false}
              onPress={() => setRebuildToken((token) => token + 1)}
            />
          </View>
        }
      >
        {isTracking ? (
          <View style={{ flexDirection: 'row', gap: spacing.tight }}>
            <Chip
              title="Plot"
              isOn={mode === 'plot'}
              onPress={() => setMode('plot')}
            />
            <Chip
              title="Live"
              isOn={mode === 'live'}
              onPress={() => setMode('live')}
            />
          </View>
        ) : null}

        {/* The live surface is checked first and does not wait on a build: a run that has just
            started has nothing to plot yet, and a screen that showed "nothing to draw" over a
            session actively recording would be lying about the one thing the tester is watching.
            followMode is `follow` rather than `followBearing`: north-up survives a noisy or sparse
            feed, where a chase camera spins on every heading wobble. */}
        {mode === 'live' ? (
          // The clip lives on a wrapper, not on the map. A `borderRadius` on the map view itself is
          // honoured on iOS and ignored on Android — the GoogleMap surface is a separate texture
          // that does not take its parent's corner radius — so the Android map sat in the card with
          // square corners. `overflow: 'hidden'` on an ordinary View clips it on both.
          <View style={mapFrame}>
            <LiveTrackMapView
              update={live}
              followMode="followBearing"
              style={{ flex: 1 }}
            />
          </View>
        ) : state.kind === 'loading' || state.kind === 'idle' ? (
          <View
            style={{
              height: mapHeight,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ActivityIndicator />
            <Note>Building the track…</Note>
          </View>
        ) : state.kind === 'failed' ? (
          <ContentUnavailable
            glyph="🗺"
            title="Nothing to draw"
            message={state.message}
          />
        ) : plot && plot.track.encodedPolyline.length > 0 ? (
          <View style={mapFrame}>
            <TrackMapView
              track={plot.track}
              options={MAP_OPTIONS}
              onArrowZoom={handleArrowZoom}
              style={{ flex: 1 }}
            />
          </View>
        ) : (
          <ContentUnavailable
            glyph="🗺"
            // A single stored point is not "no points stored". The map cannot draw it, which is a
            // different fact and gets a different title.
            title={
              plot && plot.storedPointCount > 0
                ? 'Not enough to draw'
                : 'No points stored'
            }
            message={emptyExplanation(plot)}
          />
        )}
      </DiagnosticCard>

      {/* MARK: - Session and chips */}
      <DiagnosticCard title="Session" glyph="🕘">
        <SessionPicker
          sessions={tracking.sessions}
          selection={tracking.selectedSessionId}
          onSelect={tracking.selectSession}
          resolvedSessionId={plot?.sessionId ?? tracking.resolvedSessionId}
        />

        <View
          style={{ flexDirection: 'row', gap: spacing.tight, flexWrap: 'wrap' }}
        >
          {/* Disabled, never hidden. A control that vanishes reads as a missing feature; one that
              greys out reads as a missing input — which is precisely what an empty raw layer is. */}
          <Chip
            title={`Raw (${plot?.rawFixCount ?? 0})`}
            isOn={tracking.showRawLayer && (plot?.rawFixCount ?? 0) > 0}
            isEnabled={(plot?.rawFixCount ?? 0) > 0}
            onPress={() => tracking.setShowRawLayer(!tracking.showRawLayer)}
          />
          <Chip
            title="Snap"
            isOn={tracking.snapToRoad}
            onPress={() => tracking.setSnapToRoad(!tracking.snapToRoad)}
          />
        </View>

        <Note>
          Snapping happens inside buildTrack, not in the renderer, so changing
          it is a rebuild rather than a redraw — the chip re-reads the session.
        </Note>
      </DiagnosticCard>

      {/* MARK: - Notes */}
      {tracking.showRawLayer && (plot?.rawFixCount ?? 0) > 0 ? (
        <ExplanationBox
          text={
            `${plot?.rawFixCount} raw fixes were captured for this session. The SDK's map view draws ` +
            'the finished track only; the raw thread is a device-only diagnostic with no renderer on ' +
            'this platform, so it is reported here as a count and in the ratio below rather than as a ' +
            'second line. Raw fixes are never uploaded.'
          }
        />
      ) : null}
      {plot && plot.rawFixCount === 0 ? (
        <ExplanationBox
          text={
            'No raw fixes were stored for this session, so layer 1 has nothing to report. Turn on ' +
            'persistRawFixes before the run — it is off by default because it is a diagnostic, not ' +
            'production behaviour.'
          }
        />
      ) : null}
      {isSnapUnavailable ? (
        <ExplanationBox
          text={
            'Road snapping was requested and could not be answered, so this line is raw geometry. ' +
            'Check the snap provider and the network before reading anything into the shape.'
          }
        />
      ) : null}
      {isTruncated ? (
        <ExplanationBox
          text={
            'This session is longer than one read, so the drawn track stops early. The counts below ' +
            'still cover the whole session.'
          }
        />
      ) : null}

      {/* MARK: - Summary */}
      {plot ? <TrackSummaryCard plot={plot} /> : null}

      {/* MARK: - Timeline */}
      {plot ? <TrackTimeline track={plot.track} /> : null}
    </ScrollView>
  );
}

/// A session with fixes and no points is not an empty screen — it is the most interesting screen in
/// the app, and it names the tab that explains it. Three different situations produce this screen,
/// and they need three different sentences.
function emptyExplanation(plot?: TrackPlot): string {
  if (!plot) {
    return 'Nothing has been built yet.';
  }
  if (plot.storedPointCount > 0) {
    // Stored, but a line needs two ends. Common at the very start of a run and for a session that
    // never moved.
    const stored =
      plot.storedPointCount === 1
        ? '1 point was stored'
        : `${plot.storedPointCount} points were stored`;
    return (
      `${stored} for this session, and a track needs two to draw a line. ` +
      'The Decisions tab names the stage that rejected the rest.'
    );
  }
  return plot.rawFixCount > 0
    ? `${plot.rawFixCount} raw fixes were captured for this session and none of them was stored. The Decisions tab names the stage that rejected them.`
    : 'Nothing was captured for this session.';
}

// MARK: - TrackSummaryCard

/// The numbers, with the one that matters at the top.
function TrackSummaryCard({ plot }: { plot: TrackPlot }) {
  const theme = useTheme();
  const { stats } = plot.track;

  /// `—` rather than `0 %` when there is no raw layer: nothing was measured, which is a different
  /// fact from "nothing survived", and they have different fixes.
  const keptText =
    plot.rawFixCount > 0
      ? `${Math.round((plot.storedPointCount / plot.rawFixCount) * 100)}% KEPT`
      : 'NO RAW LAYER';

  const activityBreakdown = Object.entries(stats.activityBreakdownSec ?? {})
    .filter(([, seconds]) => seconds > 0)
    .sort((left, right) => right[1] - left[1]);

  return (
    <DiagnosticCard title="Summary" glyph="📊">
      {/* THE RATIO. The most useful number on this screen: a wide gap is the thing to go and
          explain, and which side of it the loss happened on is the difference between "the pipeline
          discarded them" and "the OS never offered them" — a Decisions-tab question and a
          background-execution question respectively. */}
      <Text
        style={{
          color: theme.secondaryLabel,
          fontSize: font.pill,
          fontWeight: '700',
        }}
      >
        RAW FIXES → STORED POINTS
      </Text>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.row }}
      >
        <Text style={[monoTitle, { color: theme.label }]}>
          {plot.rawFixCount}
        </Text>
        <Text style={{ color: theme.secondaryLabel }}>→</Text>
        <Text style={[monoTitle, { color: theme.label }]}>
          {plot.storedPointCount}
        </Text>
        <View style={{ flex: 1 }} />
        <Pill text={keptText} />
      </View>

      <Divider />

      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        <TrackStat
          label="Distance"
          value={distanceText(stats.distanceMeters)}
        />
        <TrackStat label="Tracked" value={durationText(stats.durationSec)} />
        <TrackStat
          label="Moving"
          value={durationText(stats.movingDurationSec)}
        />
        <TrackStat
          label="Stopped"
          value={durationText(stats.stoppedDurationSec)}
        />
        <TrackStat label="Points" value={String(plot.storedPointCount)} />
        <TrackStat label="Stops" value={String(plot.track.stops.length)} />
        <TrackStat
          label="Segments"
          value={String(plot.track.segments.length)}
        />
        <TrackStat label="Arrows" value={String(plot.track.arrows.length)} />
        <TrackStat label="Session" value={shortId(plot.sessionId)} />
      </View>

      {activityBreakdown.length > 0 ? (
        <>
          <Divider />
          <Text
            style={{
              color: theme.secondaryLabel,
              fontSize: font.pill,
              fontWeight: '700',
            }}
          >
            COMMUTE BREAKDOWN
          </Text>
          {activityBreakdown.map(([name, seconds]) => (
            <View key={name} style={{ flexDirection: 'row' }}>
              <Text
                style={{
                  color: theme.secondaryLabel,
                  fontSize: font.factName,
                  flex: 1,
                }}
              >
                {name}
              </Text>
              <Text
                style={{
                  color: theme.label,
                  fontFamily: font.mono,
                  fontSize: font.factValue,
                }}
              >
                {durationText(seconds)}
              </Text>
            </View>
          ))}
        </>
      ) : null}

      {plot.track.warnings.length > 0 ? (
        <Note>warnings: {plot.track.warnings.join(', ')}</Note>
      ) : null}
    </DiagnosticCard>
  );
}

function TrackStat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View
      style={{ width: '33%', paddingVertical: spacing.hair, gap: spacing.hair }}
    >
      <Text style={{ color: theme.secondaryLabel, fontSize: font.factName }}>
        {label}
      </Text>
      <Text
        selectable
        style={{
          color: theme.label,
          fontFamily: font.mono,
          fontSize: font.factValue,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function distanceText(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(2)} km`
    : `${Math.round(metres)} m`;
}

const monoTitle = {
  fontFamily: font.mono,
  fontSize: 22,
  fontWeight: '600' as const,
};

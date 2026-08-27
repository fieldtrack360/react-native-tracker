import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import Tracker, {
  type FixDecision,
  type RawFix,
  type TrackPoint,
} from '@fieldtrack360/react-native-tracker';
import { font, radius, spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  CollapseChevron,
  ContentUnavailable,
  DiagnosticCard,
  ExplanationBox,
  FactRow,
  Note,
  Screen,
  SessionPicker,
  shortId,
  withAlpha,
} from '../ui';
import { useTracking, type ViewState } from '../state/tracking';

// The three-layer diagnostic: raw fixes, filter output and stored points, read over the same ground
// — the port of SampleApp/Modules/Debug/DebugOverlayView.swift.
//
// The single most useful diagnostic in the system. Nearly every accuracy complaint is answered in
// seconds by seeing which layer the artefact first appears in — which is why the rule that maps a
// layer to an owner is printed on the screen rather than left in a document nobody reads at 2 a.m.
// in a car park.
//
// THE DIVERGENCE FROM iOS, stated once: the iOS sample draws the three layers as coloured discs on
// a MapKit map. React Native has no map to draw arbitrary geometry on and the bridge exposes only
// the SDK's finished track views, so the layers are reported here as counts, extents and the newest
// rows. The RULE is unchanged and it is the part worth copying; what is lost is the ability to see
// separation by eye, which on iOS is what makes the answer instant.

/// Rows per read. The SDK pages by design — an unpaged read of a fortnight-long session is a memory
/// spike waiting to happen.
const PAGE_SIZE = 500;

/// The most rows one layer will read. Three layers of a long session is tens of thousands of rows,
/// and a list that takes a second to lay out is not an instrument.
const READ_CAP = 3_000;

/// Seconds between quiet re-reads while Live is on. A poll rather than an observation because all
/// three layers move independently and only one of them is observable.
const REFRESH_SECONDS = 3;

type LayerId = 'raw' | 'filter' | 'stored';

type LayerData = {
  id: LayerId;
  title: string;
  source: string;
  /** Rows read. Equal to the plottable count unless something was dropped for being unplottable. */
  rowCount: number;
  plottable: Array<{ latitude: number; longitude: number }>;
  /** The read hit its own cap, so this is the newest slice and not the whole layer. Said out loud
   *  rather than silently truncated: a layer that is quietly short looks exactly like a layer that
   *  stopped recording. */
  isTruncated: boolean;
};

type Layers = {
  sessionId: string;
  isPinned: boolean;
  raw: LayerData;
  filter: LayerData;
  stored: LayerData;
};

export function DebugScreen() {
  const theme = useTheme();
  const tracking = useTracking();

  const [state, setState] = useState<ViewState<Layers>>({ kind: 'idle' });
  const [visible, setVisible] = useState<Set<LayerId>>(
    new Set(['raw', 'filter', 'stored'])
  );
  const [isLive, setIsLive] = useState(true);
  /// Collapsed by default, like the diagnostics on Home and the lists on Fences. The layer chips
  /// are a filter over the detail cards below, so a tester opens this card to change what is shown
  /// and closes it again.
  const [isLayersExpanded, setIsLayersExpanded] = useState(false);
  const isLiveRef = useRef(isLive);
  isLiveRef.current = isLive;

  const pinned = tracking.selectedSessionId;

  const read = useCallback(
    async (isReload: boolean) => {
      if (isReload) {
        setState({ kind: 'loading' });
      }
      try {
        const resolved = pinned ?? (await Tracker.currentSession())?.id;
        if (!resolved) {
          setState({
            kind: 'failed',
            message:
              'No session selected and none is open. Start a run on Home, or pick a session.',
          });
          return;
        }

        // Three independent reads, issued together: they answer one question, and a serial read
        // would show a raw layer half a second older than the stored one — which on a running
        // session is a disagreement this screen would attribute to the pipeline.
        const [rawFixes, decisions, points] = await Promise.all([
          Tracker.getRawFixes(resolved).catch(() => [] as RawFix[]),
          readDecisions(resolved),
          readPoints(resolved),
        ]);

        setState({
          kind: 'loaded',
          value: {
            sessionId: resolved,
            isPinned: pinned != null,
            raw: {
              id: 'raw',
              title: '1 · Raw',
              source: 'getRawFixes',
              rowCount: rawFixes.length,
              plottable: rawFixes.filter((fix) =>
                isPlottable(fix.latitude, fix.longitude)
              ),
              isTruncated: rawFixes.length >= READ_CAP,
            },
            filter: {
              id: 'filter',
              title: '2 · Filter',
              source: 'decision.filter*',
              rowCount: decisions.length,
              // A decision recorded before the filter ever seeded carries (0, 0) — the state's own
              // default, not a position. Dropped from the plottable set while still counted as a
              // row that exists.
              plottable: decisions
                .filter((decision) =>
                  isPlottable(decision.filterLatitude, decision.filterLongitude)
                )
                .map((decision) => ({
                  latitude: decision.filterLatitude,
                  longitude: decision.filterLongitude,
                })),
              isTruncated: decisions.length >= READ_CAP,
            },
            stored: {
              id: 'stored',
              title: '3 · Stored',
              source: 'getPoints',
              rowCount: points.length,
              plottable: points.filter((point) =>
                isPlottable(point.latitude, point.longitude)
              ),
              isTruncated: points.length >= READ_CAP,
            },
          },
        });
      } catch (error) {
        // A failed refresh must not blank a screen that is already showing usable layers.
        if (isReload) {
          setState({ kind: 'failed', message: String(error) });
        }
      }
    },
    [pinned]
  );

  useEffect(() => {
    void read(true);
    const timer = setInterval(() => {
      if (isLiveRef.current) {
        void read(false);
      }
    }, REFRESH_SECONDS * 1000);
    return () => clearInterval(timer);
  }, [read]);

  const toggle = (id: LayerId) => {
    setVisible((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const layers = state.kind === 'loaded' ? state.value : undefined;

  return (
    <Screen>
      <DiagnosticCard title="Session" glyph="🕘">
        <SessionPicker
          sessions={tracking.sessions}
          selection={tracking.selectedSessionId}
          onSelect={tracking.selectSession}
          resolvedSessionId={layers?.sessionId ?? tracking.resolvedSessionId}
        />
        {layers ? (
          <FactRow
            name={shortId(layers.sessionId)}
            value={layers.isPinned ? 'pinned' : 'live session'}
          />
        ) : null}
        <ActionRow>
          <ActionButton
            title={isLive ? 'Live: on' : 'Live: off'}
            onPress={() => setIsLive((value) => !value)}
          />
          <ActionButton
            title="Reload"
            glyph="↻"
            onPress={() => void read(true)}
          />
        </ActionRow>
        <Note>
          Live re-reads all three layers every {REFRESH_SECONDS} s, so the
          counts track a running session.
        </Note>
      </DiagnosticCard>

      {state.kind === 'loading' || state.kind === 'idle' ? (
        <DiagnosticCard
          title="Layers"
          glyph="🔶"
          onHeaderPress={() => setIsLayersExpanded((expanded) => !expanded)}
          right={<CollapseChevron expanded={isLayersExpanded} theme={theme} />}
        >
          {isLayersExpanded ? (
            <>
              <ActivityIndicator />
              <Note>Reading layers…</Note>
            </>
          ) : null}
        </DiagnosticCard>
      ) : null}

      {state.kind === 'failed' ? (
        <DiagnosticCard
          title="Layers"
          glyph="🔶"
          onHeaderPress={() => setIsLayersExpanded((expanded) => !expanded)}
          right={<CollapseChevron expanded={isLayersExpanded} theme={theme} />}
        >
          {isLayersExpanded ? (
            <ContentUnavailable
              glyph="🔶"
              title="No layers to read"
              message={state.message}
              actionTitle="Reload"
              onAction={() => void read(true)}
            />
          ) : null}
        </DiagnosticCard>
      ) : null}

      {layers ? (
        <>
          <DiagnosticCard
            title="Layers"
            glyph="🔶"
            onHeaderPress={() => setIsLayersExpanded((expanded) => !expanded)}
            right={
              <CollapseChevron expanded={isLayersExpanded} theme={theme} />
            }
          >
            {isLayersExpanded ? (
              <>
                <View style={{ flexDirection: 'row', gap: spacing.tight }}>
                  {[layers.raw, layers.filter, layers.stored].map((data) => (
                    <LayerChip
                      key={data.id}
                      data={data}
                      isVisible={visible.has(data.id)}
                      onPress={() => toggle(data.id)}
                    />
                  ))}
                </View>
                <Note>
                  Turning a layer off is how the rule below is actually applied
                  — isolate two and the question "is the artefact already here"
                  answers itself. Hiding a layer never changes what was read.
                </Note>
              </>
            ) : null}
          </DiagnosticCard>

          {[layers.raw, layers.filter, layers.stored]
            .filter((data) => visible.has(data.id))
            .map((data) => (
              <LayerDetail key={data.id} data={data} />
            ))}

          {/* MARK: - Empty-layer notes
              An empty layer and a hidden layer look identical, and confusing the two sends somebody
              hunting a capture bug that never happened. Both cases get a sentence. */}
          {layers.raw.rowCount === 0 ? (
            <ExplanationBox
              text={
                'Layer 1 recorded nothing. An empty layer and a disabled one look identical here — ' +
                'enable persistRawFixes in the config, which is off by default because it is a ' +
                'diagnostic, then record again.'
              }
            />
          ) : null}
          {layers.filter.rowCount === 0 ? (
            <ExplanationBox
              text={
                'Layer 2 recorded nothing. Enable persistDecisions in the config — with the decision ' +
                'log off there is no record of where the filter believed it was, and that belief ' +
                'cannot be recovered afterwards.'
              }
            />
          ) : null}
          {layers.stored.rowCount === 0 && layers.raw.rowCount > 0 ? (
            <ExplanationBox
              text={
                'Fixes arrived and nothing was stored. Read the decision log for this session: a wall ' +
                'of Drift Suppressed is a departure-ladder problem, a wall of Sigma Gate Outlier is a ' +
                'filter-lag problem, and they have opposite fixes.'
              }
            />
          ) : null}
          {layers.raw.isTruncated ||
          layers.filter.isTruncated ||
          layers.stored.isTruncated ? (
            <ExplanationBox
              text={
                'A layer hit the read cap, so this screen is showing its newest rows only. The counts ' +
                'marked + are lower bounds.'
              }
            />
          ) : null}

          <DiagnosticRuleCard />
        </>
      ) : null}
    </Screen>
  );
}

// MARK: - Chips

function LayerChip({
  data,
  isVisible,
  onPress,
}: {
  data: LayerData;
  isVisible: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const colour = theme.layer[data.id];
  return (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        gap: 2,
        padding: 9,
        borderRadius: radius.inner,
        borderWidth: 1,
        borderColor: withAlpha(colour, isVisible ? 0.8 : theme.tintEdge),
        backgroundColor: withAlpha(colour, isVisible ? theme.tintFill : 0),
        opacity: isVisible ? 1 : 0.5,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <View
          style={{
            width: 9,
            height: 9,
            borderRadius: 5,
            backgroundColor: colour,
          }}
        />
        <Text style={{ color: theme.label, fontSize: 12, fontWeight: '600' }}>
          {data.title}
        </Text>
      </View>
      <Text style={{ color: theme.label, fontFamily: font.mono, fontSize: 18 }}>
        {data.rowCount}
        {data.isTruncated ? '+' : ''}
      </Text>
      <Text style={{ color: theme.secondaryLabel, fontSize: 11 }}>
        {data.source}
      </Text>
    </Pressable>
  );
}

// MARK: - Layer detail

/// The extent and the newest rows, which is what a list can say and a map says better. The extent is
/// the readable half of "do these three agree": three boxes over the same ground read as agreement,
/// and a layer whose box is somewhere else is the layer that owns the artefact.
function LayerDetail({ data }: { data: LayerData }) {
  const theme = useTheme();
  const colour = theme.layer[data.id];
  const extent = boundingBox(data.plottable);
  /// Collapsed by default, like every other card on the screen: three open layer cards is a full
  /// screen of numbers to scroll past, and a comparison starts by opening the two layers in question.
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <DiagnosticCard
      title={`${data.title} — ${data.source}`}
      glyph="📐"
      onHeaderPress={() => setIsExpanded((expanded) => !expanded)}
      right={<CollapseChevron expanded={isExpanded} theme={theme} />}
    >
      {isExpanded ? (
        <>
          <FactRow
            name="Rows read"
            value={`${data.rowCount}${data.isTruncated ? '+' : ''}`}
            tint={colour}
          />
          <FactRow name="Plottable" value={data.plottable.length} />
          {data.rowCount !== data.plottable.length ? (
            <Note>
              {data.rowCount - data.plottable.length} row
              {data.rowCount - data.plottable.length === 1 ? '' : 's'} carried
              no usable position — a decision recorded before the filter seeded
              holds (0, 0), which is the state's own default and not a place.
            </Note>
          ) : null}
          {extent ? (
            <>
              <FactRow
                name="North / south"
                value={`${extent.north.toFixed(5)} / ${extent.south.toFixed(5)}`}
              />
              <FactRow
                name="East / west"
                value={`${extent.east.toFixed(5)} / ${extent.west.toFixed(5)}`}
              />
              <FactRow name="Span" value={`${Math.round(extent.spanM)} m`} />
            </>
          ) : (
            <Note>Nothing plottable in this layer.</Note>
          )}
        </>
      ) : null}
    </DiagnosticCard>
  );
}

// MARK: - Diagnostic rule

/// The highest-value sentence in the diagnostics doc, on the screen where it is used.
///
/// A card like the other reference cards, collapsed by default: the person reading it is usually in
/// a car park with a field report, so it stays one tap away on this screen rather than behind an
/// info button somewhere else.
function DiagnosticRuleCard() {
  const theme = useTheme();
  const rule = (id: LayerId, claim: string, owner: string) => (
    <View key={claim} style={{ flexDirection: 'row', gap: 8 }}>
      <View
        style={{
          width: 9,
          height: 9,
          borderRadius: 5,
          marginTop: 4,
          backgroundColor: theme.layer[id],
        }}
      />
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.label, fontSize: 12, fontWeight: '600' }}>
          {claim}
        </Text>
        <Text style={{ color: theme.secondaryLabel, fontSize: 11 }}>
          → {owner}
        </Text>
      </View>
    </View>
  );

  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <DiagnosticCard
      title="How to read this"
      glyph="🧭"
      onHeaderPress={() => setIsExpanded((expanded) => !expanded)}
      right={<CollapseChevron expanded={isExpanded} theme={theme} />}
    >
      {isExpanded ? (
        <View style={{ gap: 8 }}>
          {rule(
            'raw',
            'Artefact already in RAW',
            'an OS or configuration problem — check the distance filter, automatic pausing, authorization and accuracy authorization.'
          )}
          {rule(
            'filter',
            'Raw clean but FILTER wrong',
            'a pipeline stage or a mis-tuned constant — go to the decision log for that timestamp.'
          )}
          {rule(
            'stored',
            'Filter right but STORED disagrees',
            'a persistence or dedup bug — check the uuid derivation and the query ordering.'
          )}
          <Note>
            The layer an artefact first appears in names the owner. Never soften
            a stage to fix a symptom another stage owns.
          </Note>
        </View>
      ) : null}
    </DiagnosticCard>
  );
}

// MARK: - Reads

async function readDecisions(sessionId: string): Promise<FixDecision[]> {
  const collected: FixDecision[] = [];
  let offset = 0;
  while (collected.length < READ_CAP) {
    const page = await Tracker.getDecisions(sessionId, PAGE_SIZE, offset);
    collected.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }
  return collected;
}

async function readPoints(sessionId: string): Promise<TrackPoint[]> {
  const collected: TrackPoint[] = [];
  let offset = 0;
  while (collected.length < READ_CAP) {
    const page = await Tracker.getPoints({
      sessionId,
      limit: PAGE_SIZE,
      offset,
    });
    collected.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }
  return collected;
}

// MARK: - Geometry

function isPlottable(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return false;
  }
  return !(latitude === 0 && longitude === 0);
}

function boundingBox(
  coordinates: Array<{ latitude: number; longitude: number }>
) {
  const first = coordinates[0];
  if (!first) {
    return undefined;
  }
  let north = first.latitude;
  let south = first.latitude;
  let east = first.longitude;
  let west = first.longitude;
  for (const coordinate of coordinates) {
    north = Math.max(north, coordinate.latitude);
    south = Math.min(south, coordinate.latitude);
    east = Math.max(east, coordinate.longitude);
    west = Math.min(west, coordinate.longitude);
  }
  // The diagonal, in metres — one number a tester can compare between two layers without doing
  // arithmetic on degrees.
  const metresPerDegree = 111_320;
  const latitudeSpan = (north - south) * metresPerDegree;
  const longitudeSpan =
    (east - west) *
    metresPerDegree *
    Math.cos(((north + south) / 2) * (Math.PI / 180));
  const spanM = Math.sqrt(
    latitudeSpan * latitudeSpan + longitudeSpan * longitudeSpan
  );
  return { north, south, east, west, spanM };
}

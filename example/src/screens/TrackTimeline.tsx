import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import type {
  StopNode,
  Track,
  TrackSegment,
} from '@fieldtrack360/react-native-tracker';
import { font, spacing, useTheme } from '../theme';
import { DiagnosticCard } from '../ui';

// The cluster-based expandable timeline, derived from Track.segments — the port of
// SampleApp/Modules/Track/TrackTimelineSection.swift.
//
// Each cluster is one leg: the arrival stop, the travel between it and the next stop, and the next
// arrival. The engine already decided all of it; nothing here recomputes geometry or re-segments.

type TravelInfo = {
  /** Index in track.segments — the identity the expansion set holds. */
  segIndex: number;
  segment: TrackSegment;
};

type Cluster = {
  startStop?: StopNode;
  travel?: TravelInfo;
  endStop?: StopNode;
};

/// Segments alternate: travel?, [stop, travel]*, stop?. Each cluster covers the travel between two
/// stops; the end stop of cluster N is the start stop of cluster N+1.
function buildClusters(track: Track): Cluster[] {
  const clusters: Cluster[] = [];
  let pendingStop: StopNode | undefined;

  track.segments.forEach((segment, index) => {
    if (segment.type === 'stop') {
      if (segment.stopIndex != null && segment.stopIndex < track.stops.length) {
        pendingStop = track.stops[segment.stopIndex];
      }
      return;
    }
    clusters.push({
      startStop: pendingStop,
      travel: { segIndex: index, segment },
    });
    pendingStop = undefined;
  });

  // A trailing stop with no following travel is still a row — it is where the run ended, or where
  // it is still sitting.
  if (pendingStop) {
    clusters.push({ startStop: pendingStop });
  }

  return clusters.map((cluster, index) => ({
    ...cluster,
    endStop:
      index + 1 < clusters.length ? clusters[index + 1]!.startStop : undefined,
  }));
}

export function TrackTimeline({ track }: { track: Track }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const clusters = buildClusters(track);

  if (clusters.length === 0) {
    return null;
  }

  const toggle = (segIndex: number) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(segIndex)) {
        next.delete(segIndex);
      } else {
        next.add(segIndex);
      }
      return next;
    });
  };

  return (
    <DiagnosticCard title="Timeline" glyph="🧭">
      {clusters.map((cluster, index) => (
        <View key={`cluster-${index}`}>
          {cluster.startStop ? (
            <StopRow
              stop={cluster.startStop}
              timezone={track.timezone}
              role="arrival"
            />
          ) : null}

          {cluster.travel ? (
            <>
              <TravelRow
                travel={cluster.travel}
                timezone={track.timezone}
                isExpanded={expanded.has(cluster.travel.segIndex)}
                onToggle={() => toggle(cluster.travel!.segIndex)}
              />
              {/* The dual window. A travelStartMs ahead of the segment's own start means the engine
                  knows the drive began before the first fix it could keep — a signal blackout, not a
                  late departure. iOS-only on the wire. */}
              {(cluster.travel.segment.ios?.travelStartMs ?? 0) > 0 ? (
                <PhantomLegNote
                  segment={cluster.travel.segment}
                  timezone={track.timezone}
                />
              ) : null}
            </>
          ) : null}

          {cluster.endStop ? (
            <StopRow
              stop={cluster.endStop}
              timezone={track.timezone}
              role="departure"
            />
          ) : null}

          {index < clusters.length - 1 ? (
            <View style={{ paddingLeft: 13 }}>
              <View
                style={{
                  width: 2,
                  height: 12,
                  backgroundColor: theme.separator,
                }}
              />
            </View>
          ) : null}
        </View>
      ))}
    </DiagnosticCard>
  );
}

// MARK: - Travel

function TravelRow({
  travel,
  timezone,
  isExpanded,
  onToggle,
}: {
  travel: TravelInfo;
  timezone: string;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  const segment = travel.segment;

  return (
    <View style={{ paddingVertical: 6, gap: 6 }}>
      <Pressable
        onPress={onToggle}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.row }}
      >
        <View
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: bandColour(segment.speedBand, theme),
          }}
        >
          <Text style={{ fontSize: 12 }}>{activityIcon(segment)}</Text>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.label, fontSize: 14, fontWeight: '500' }}>
            {segment.activity ?? 'Travel'}
          </Text>
          {!isExpanded ? (
            <Text style={{ color: theme.secondaryLabel, fontSize: 12 }}>
              {segment.distanceMeters > 0
                ? formatDistance(segment.distanceMeters)
                : ''}
              {segment.distanceMeters > 0 && segment.durationSec > 0
                ? '  ·  '
                : ''}
              {segment.durationSec > 0
                ? formatDuration(segment.durationSec)
                : ''}
            </Text>
          ) : null}
        </View>

        <Text style={{ color: theme.secondaryLabel }}>
          {isExpanded ? '⌃' : '⌄'}
        </Text>
      </Pressable>

      {isExpanded ? (
        <View
          style={{ paddingLeft: 34, flexDirection: 'row', flexWrap: 'wrap' }}
        >
          {segment.distanceMeters > 0 ? (
            <TravelStat
              label="Distance"
              value={formatDistance(segment.distanceMeters)}
            />
          ) : null}
          {segment.durationSec > 0 ? (
            <TravelStat
              label="Duration"
              value={formatDuration(segment.durationSec)}
            />
          ) : null}
          {segment.avgSpeedMps > 0 ? (
            <TravelStat
              label="Avg speed"
              value={formatSpeed(segment.avgSpeedMps)}
            />
          ) : null}
          {segment.maxSpeedMps > 0 ? (
            <TravelStat
              label="Max speed"
              value={formatSpeed(segment.maxSpeedMps)}
            />
          ) : null}
          {segment.p75SpeedMps > 0 ? (
            <TravelStat
              label="p75 speed"
              value={formatSpeed(segment.p75SpeedMps)}
            />
          ) : null}
          {segment.startMs > 0 && segment.endMs > 0 ? (
            <TravelStat label="Time" value={timeRange(segment, timezone)} />
          ) : null}
          {segment.speedBand ? (
            <TravelStat label="Band" value={segment.speedBand} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function TravelStat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ width: '33%', paddingVertical: 3 }}>
      <Text style={{ color: theme.secondaryLabel, fontSize: 11 }}>{label}</Text>
      <Text style={{ color: theme.label, fontSize: 12, fontWeight: '600' }}>
        {value}
      </Text>
    </View>
  );
}

function PhantomLegNote({
  segment,
  timezone,
}: {
  segment: TrackSegment;
  timezone: string;
}) {
  const theme = useTheme();
  const start = segment.ios?.travelStartMs ?? 0;
  return (
    <View
      style={{
        paddingLeft: 34,
        paddingBottom: 4,
        flexDirection: 'row',
        gap: 6,
      }}
    >
      <Text style={{ fontSize: 11 }}>⚠️</Text>
      <Text style={{ color: theme.secondaryLabel, fontSize: 11, flex: 1 }}>
        Signal gap during drive · drive window {time(start, timezone)}–
        {time(segment.startMs, timezone)}
      </Text>
    </View>
  );
}

// MARK: - Stops

function StopRow({
  stop,
  timezone,
  role,
}: {
  stop: StopNode;
  timezone: string;
  role: 'arrival' | 'departure';
}) {
  const theme = useTheme();
  const ms =
    role === 'arrival' ? stop.arrivalMs : (stop.departureMs ?? stop.arrivalMs);

  const dwell = (() => {
    if (role !== 'arrival') {
      return '';
    }
    if (stop.isOngoing) {
      const elapsed = Math.round(Date.now() / 1000 - stop.arrivalMs / 1000);
      return elapsed > 0 ? `Stopped ${formatDuration(elapsed)}` : 'Ongoing';
    }
    return stop.dwellSec > 0 ? `Stopped ${formatDuration(stop.dwellSec)}` : '';
  })();

  return (
    <View
      style={{ flexDirection: 'row', gap: spacing.row, paddingVertical: 6 }}
    >
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 14,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: stop.isOngoing
            ? theme.layer.filter + '28'
            : theme.fill,
        }}
      >
        <Text style={{ fontSize: 13 }}>{stop.isOngoing ? '📍' : '⏸'}</Text>
      </View>

      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row' }}>
          <Text
            style={{
              color: theme.label,
              fontSize: 14,
              fontWeight: '600',
              flex: 1,
            }}
          >
            {stop.isOngoing ? 'Currently here' : `Stop ${stop.index + 1}`}
          </Text>
          <Text style={{ color: theme.secondaryLabel, fontSize: 12 }}>
            {time(ms, timezone)}
          </Text>
        </View>
        {stop.address ? (
          <Text
            numberOfLines={2}
            style={{ color: theme.secondaryLabel, fontSize: 12 }}
          >
            {stop.address}
          </Text>
        ) : null}
        {dwell ? (
          <Text
            style={{
              color: stop.isOngoing ? theme.layer.filter : theme.secondaryLabel,
              fontSize: 12,
            }}
          >
            {dwell}
          </Text>
        ) : null}
        <Text
          style={{
            color: theme.tertiaryLabel,
            fontSize: 11,
            fontFamily: font.mono,
          }}
        >
          r {Math.round(stop.radiusM)} m · {stop.pointCount} points
        </Text>
      </View>
    </View>
  );
}

// MARK: - Formatting

function activityIcon(segment: TrackSegment): string {
  if (segment.activityIcon) {
    return segment.activityIcon;
  }
  switch (segment.activity) {
    case 'flight':
      return '✈️';
    case 'train':
      return '🚄';
    case 'driving':
      return '🚗';
    case 'riding':
      return '🛵';
    case 'cycling':
      return '🚲';
    case 'running':
      return '🏃';
    case 'walking':
      return '🚶';
    default:
      return '🗺️';
  }
}

function bandColour(
  band: string | undefined,
  theme: ReturnType<typeof useTheme>
): string {
  switch (band) {
    case 'green':
      return theme.status.good + '40';
    case 'yellow':
      return theme.status.warn + '40';
    default:
      return theme.status.bad + '40';
  }
}

function formatDistance(metres: number): string {
  return metres >= 1000
    ? `${(metres / 1000).toFixed(2)} km`
    : `${Math.round(metres)} m`;
}

function formatSpeed(mps: number): string {
  return `${Math.round(mps * 3.6)} km/h`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainderSeconds = seconds % 60;
  if (minutes < 60) {
    return remainderSeconds === 0
      ? `${minutes}min`
      : `${minutes}min ${remainderSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes === 0
    ? `${hours}hr`
    : `${hours}hr ${remainderMinutes}min`;
}

/// The track's own timezone, not the device's: a run recorded in another zone is read back in the
/// zone it happened in, which is what makes a timeline comparable against a field report.
function time(ms: number, timezone: string): string {
  if (!ms) {
    return '';
  }
  try {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timezone,
    });
  } catch {
    return new Date(ms).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    });
  }
}

function timeRange(segment: TrackSegment, timezone: string): string {
  return `${time(segment.startMs, timezone)}–${time(segment.endMs, timezone)}`;
}

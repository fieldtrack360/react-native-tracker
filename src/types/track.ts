// Plotting / Track tree / live surface. buildTrack/export* return JSON strings;
// these are the decoded shapes AFTER the native mapper normalizes both platforms onto one wire
// shape. Platform-only members are namespaced; the two SDKs' raw JSON diverges hard (zero-overlap
// TrackJSONPoint keys, renamed/extra TrackStats fields, iOS-only TrackSegment.travelStartMs).
import type { SegmentType } from './enums';

export type GeoPoint = { latitude: number; longitude: number };

export type Bounds = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type TrackStats = {
  distanceMeters: number;
  durationSec: number;
  movingDurationSec: number;
  stoppedDurationSec: number;
  activityBreakdownSec: Record<string, number>;
  /** Android computes these; iOS does not carry them. */
  android?: {
    maxSpeedMps: number;
    avgMovingSpeedMps: number;
    pointCount: number;
    stopCount: number;
  };
};

export type TrackJsonPoint = {
  timeMs: number;
  latitude: number;
  longitude: number;
  accuracyM: number;
  speedMps: number;
  bearingDeg: number;
  activity?: string;
  /** Android carries an index, source and mock flag with no iOS counterpart. */
  android?: { index: number; source: string; isMock: boolean };
};

export type TrackSegment = {
  from: number;
  to: number;
  type: SegmentType;
  startMs: number;
  endMs: number;
  distanceMeters: number;
  durationSec: number;
  avgSpeedMps: number;
  maxSpeedMps: number;
  p75SpeedMps: number;
  activity?: string;
  activityIcon?: string;
  speedBand?: string;
  encodedPolyline: string;
  stopIndex?: number;
  /** iOS only. */
  ios?: { travelStartMs: number };
};

export type StopNode = {
  index: number;
  latitude: number;
  longitude: number;
  arrivalMs: number;
  departureMs?: number;
  dwellSec: number;
  radiusM: number;
  pointCount: number;
  address?: string;
  isOngoing: boolean;
};

export type ArrowAnchor = {
  latitude: number;
  longitude: number;
  bearing: number;
  segment: number;
};

export type Track = {
  version: number;
  sessionId?: string;
  generatedAtMs: number;
  from: number;
  to: number;
  timezone: string;
  /** Read this when decoding the polyline — the default is 6, not 5. */
  precision: number;
  bounds?: Bounds;
  stats: TrackStats;
  encodedPolyline: string;
  points: TrackJsonPoint[];
  segments: TrackSegment[];
  stops: StopNode[];
  arrows: ArrowAnchor[];
  warnings: string[];
};

// Identical fields on both platforms.
export type TrackOptions = {
  zoom?: number;
  includeRawPoints?: boolean;
  consolidateStops?: boolean;
  stopRadiusM?: number;
  stopMinDwellSec?: number;
  smoothing?: 'none' | 'spline' | 'bezier';
  splineSpacingM?: number;
  bezierMinAngleDeg?: number;
  bezierCutbackM?: number;
  snapToRoad?: boolean;
  snapMaxOffRoadM?: number;
  polylinePrecision?: number;
  speedBandsKmph?: number[];
  arrowMinSegmentM?: number;
  simplifyEpsilonM?: number;
};

export type PuckState = {
  latitude: number;
  longitude: number;
  speedMps: number;
  headingDeg?: number;
  accuracyM: number;
};

// Capacity 1: a live frame is a replacement, never buffered.
export type LiveTrackUpdate = {
  sessionId: string;
  sequence: number;
  precision: number;
  frozenTailPolyline: string;
  liveHead: GeoPoint[];
  puck?: PuckState;
};

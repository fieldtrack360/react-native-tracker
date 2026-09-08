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

// Identical fields on both platforms, apart from the `android` block.
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

  /** Android SDK 1.0.10. Bounds on the road geometry INJECTED between two snapped fixes.
   *  `snapMaxOffRoadM` above governs whether a *point* may be moved onto the road; these govern
   *  whether the road *between* two such points may be drawn at all. Different claims, and the
   *  second is the larger one — a wrong point is metres wrong, a wrong span is a confident line
   *  down streets nobody drove. A field capture injected ~2 km of road between two fixes ~100 m
   *  apart before this bound existed.
   *
   *  Android-only: the iOS `TrackOptions` has `snapToRoad` and `snapMaxOffRoadM` and no
   *  counterpart to either of these. Sent on iOS they are ignored, not an error. */
  android?: {
    /** How much longer than the straight line between two snapped fixes the injected path may be.
     *  Default 2.5 — a straight runs at 1.0, a bend up to ~1.6, a one-way system round three sides
     *  of a block at ~3. Also, quietly, a speed limit: two fixes at the 12 s vehicular tier are
     *  ~120 m apart, so 2.5 admits a 500 m road path between them and refuses a 900 m one, and
     *  900 m in 12 s is 270 km/h. `Infinity` restores the unbounded pre-1.0.10 behaviour. */
    snapMaxDetourFactor?: number;
    /** The flat allowance under `snapMaxDetourFactor`, metres. Default 200. The ratio is
     *  meaningless as the chord approaches zero, and the chord approaches zero exactly where the
     *  geometry is most worth injecting: two fixes either side of a roundabout island sit 15 m
     *  apart with 150 m of road between them — a factor of ten, and completely correct. A junction
     *  turn, a U-turn and a hairpin all have that shape. */
    snapBridgeFlatM?: number;
  };
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

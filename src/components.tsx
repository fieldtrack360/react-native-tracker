import * as React from 'react';
import type { ViewProps, NativeSyntheticEvent } from 'react-native';
import TrackMapViewNative from './TrackMapViewNativeComponent';
import LiveTrackMapViewNative from './LiveTrackMapViewNativeComponent';
import type { GeoPoint, Track, LiveTrackUpdate } from './types';

// Typed React wrappers over the Fabric components. The wrappers own the ONLY
// JSON.stringify boundary: the app works with the typed Track / LiveTrackUpdate objects (as
// returned by buildTrack / delivered by onLiveTrack) and the wrapper serialises them into the
// `track` / `update` string props the native view decodes. The native view NEVER
// recomputes geometry — it renders exactly what the engine produced.

// The follow mode both platforms have under different native names.
export type CameraFollowMode = 'none' | 'follow' | 'followBearing';

// ── <TrackMapView track={…} /> ────────────────────────────────────────────────

export type TrackMapViewProps = Omit<ViewProps, 'children'> & {
  /** The finished track (from buildTrack). Serialised to the `track` string prop. */
  track: Track;
  /**
   * Optional renderer styling. PLATFORM-DIVERGENT and intentionally untyped/unmerged: an iOS
   * RenderOptions-shaped object on iOS, an Android RendererOptions-shaped object on Android.
   * Serialised as-is to the `options` string prop.
   */
  options?: object;
  /**
   * The renderer needs the arrows rebuilt at a new zoom. Rebuild the track with
   * `buildTrack(query, { ...options, zoom })` and pass the new `track` — do NOT rescale.
   */
  onArrowZoom?: (zoom: number) => void;
};

export function TrackMapView({
  track,
  options,
  onArrowZoom,
  ...viewProps
}: TrackMapViewProps): React.ReactElement {
  const handleArrowZoom = React.useCallback(
    (e: NativeSyntheticEvent<{ zoom: number }>) => {
      onArrowZoom?.(e.nativeEvent.zoom);
    },
    [onArrowZoom]
  );

  return (
    <TrackMapViewNative
      {...viewProps}
      track={JSON.stringify(track)}
      options={options != null ? JSON.stringify(options) : undefined}
      onArrowZoom={onArrowZoom != null ? handleArrowZoom : undefined}
    />
  );
}

// ── <LiveTrackMapView update={…} /> ───────────────────────────────────────────

export type LiveTrackMapViewProps = Omit<ViewProps, 'children'> & {
  /**
   * The latest live frame (from onLiveTrack). Serialised to the `update` string prop. On Android
   * the view rebuilds the native LiveTrackUpdate from this; on iOS the host feeds the SwiftUI view
   * from the native live stream and this is a liveness signal only (reconstructionNotes).
   */
  update?: LiveTrackUpdate;
  /**
   * Optional live renderer styling. PLATFORM-DIVERGENT and untyped/unmerged (iOS LiveOptions vs
   * Android LiveTrackRenderer.Options; the follow-camera framing has no lossless mapping —
   * followDistanceMeters/followPitchDegrees vs followZoom/followTilt).
   */
  options?: object;
  /** Camera follow mode. */
  followMode?: CameraFollowMode;
  /** Optional initial camera centre when there is no update yet (iOS `initialCentre`). */
  initialCentre?: GeoPoint;
  /** iOS only: the follow-state flipped (e.g. the user panned away from the puck). */
  onFollowingChange?: (isFollowing: boolean) => void;
};

export function LiveTrackMapView({
  update,
  options,
  followMode,
  initialCentre,
  onFollowingChange,
  ...viewProps
}: LiveTrackMapViewProps): React.ReactElement {
  const handleFollowingChange = React.useCallback(
    (e: NativeSyntheticEvent<{ isFollowing: boolean }>) => {
      onFollowingChange?.(e.nativeEvent.isFollowing);
    },
    [onFollowingChange]
  );

  return (
    <LiveTrackMapViewNative
      {...viewProps}
      update={update != null ? JSON.stringify(update) : undefined}
      options={options != null ? JSON.stringify(options) : undefined}
      followMode={followMode}
      initialCentre={initialCentre}
      onFollowingChange={
        onFollowingChange != null ? handleFollowingChange : undefined
      }
    />
  );
}

import { codegenNativeComponent } from 'react-native';
import type { CodegenTypes, HostComponent, ViewProps } from 'react-native';

// Fabric spec — <LiveTrackMapView>. Renders the LIVE track over LiveTrackRenderer (Android)
// / the SwiftUI LiveTrackMapView (iOS). The renderer drops stale sequences, grows the frozen tail
// incrementally, redraws the unsettled head and animates the puck — none of that is reimplemented
// in JS.
//
// `update` crosses as a JSON STRING prop (the LiveTrackUpdate shape in src/types/track.ts, as
// delivered by onLiveTrack). Capacity 1: each frame replaces the last, never buffered.
//
//   PLATFORM ASYMMETRY (see reconstructionNotes): on ANDROID the native LiveTrackUpdate has a
//   public constructor, so the view rebuilds it from `update` and feeds LiveTrackRenderer.render.
//   On iOS the native LiveTrackUpdate is NOT Codable and has NO accessible initializer — it cannot
//   be reconstructed from JSON — so the iOS host feeds the SwiftUI view from the native
//   Tracker.shared.liveTrack() stream directly and ignores `update` for geometry. The prop stays in
//   the contract for API symmetry and as a liveness signal.
//
// `followMode` crosses as a string ("none" | "follow" | "followBearing") — both platforms have it
// under different names (iOS CameraFollowMode / Android LiveTrackRenderer.CameraFollowMode).
// `initialCentre` is an optional { latitude, longitude }. `options` is the DIVERGENT renderer
// styling JSON (iOS LiveOptions vs Android LiveTrackRenderer.Options — do NOT unify: iOS uses
// followDistanceMeters/followPitchDegrees, Android followZoom/followTilt).
//
// `onFollowingChange` { isFollowing } surfaces iOS's `isFollowing` Binding as a prop+event pair
// (the SDK flips it to false when the user pans away from the puck). Android has no follow-state
// callback — it only sets cameraFollow — so Android never emits this event (documented).

type FollowingChangeEvent = Readonly<{
  isFollowing: boolean;
}>;

export interface NativeProps extends ViewProps {
  /** Wire LiveTrackUpdate JSON string (src/types/track.ts). Android decodes it; iOS ignores it. */
  update?: string;
  /** Optional live renderer styling JSON. Platform-divergent. */
  options?: string;
  /** Camera follow mode: "none" | "follow" | "followBearing". */
  followMode?: string;
  /** Optional initial camera centre when there is no update yet. */
  initialCentre?: Readonly<{
    latitude: CodegenTypes.Double;
    longitude: CodegenTypes.Double;
  }>;
  /** iOS only: emitted when the follow-state Binding flips (e.g. user pans). Payload { isFollowing }. */
  onFollowingChange?: CodegenTypes.DirectEventHandler<FollowingChangeEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'LiveTrackMapView'
) as HostComponent<NativeProps>;

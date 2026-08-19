import { codegenNativeComponent } from 'react-native';
import type { CodegenTypes, HostComponent, ViewProps } from 'react-native';

// Fabric spec — <TrackMapView>. Renders the FINISHED track the engine already computed;
// the view layer never recomputes geometry. Codegen turns this into the C++ Props /
// EventEmitter / ComponentDescriptor (RNTrackerSpec) + the Android ManagerInterface/Delegate; an
// unimplemented prop/event fails the New-Arch build on both platforms.
//
// The Track is large and per-zoom-rebuilt, so it crosses as a JSON STRING prop (`track`) the
// native view decodes into the platform's native Track object (buildTrack already returns
// this JSON). `options` is the renderer styling, an optional JSON string, documented as DIVERGENT
// per platform (iOS RenderOptions vs Android RendererOptions — do NOT unify).
//
// Arrow refresh is a DIRECT EVENT `onArrowZoom` { zoom }. Android polls needsArrowRefresh() on
// camera idle and emits with the new camera zoom; iOS forwards its onArrowZoomChange push callback
// to the same event. JS reacts by calling buildTrack at the new zoom and passing a NEW `track`
// prop — it does not rescale.

type ArrowZoomEvent = Readonly<{
  zoom: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  /** Wire Track JSON string (the shape in src/types/track.ts, produced by buildTrack). */
  track: string;
  /** Optional renderer styling JSON. Platform-divergent — not a unified shape. */
  options?: string;
  /** Emitted when the renderer needs the arrows rebuilt at a new zoom. Payload: { zoom }. */
  onArrowZoom?: CodegenTypes.DirectEventHandler<ArrowZoomEvent>;
}

export default codegenNativeComponent<NativeProps>(
  'TrackMapView'
) as HostComponent<NativeProps>;

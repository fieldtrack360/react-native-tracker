#import "TrackMapViewComponentView.h"

// Codegen output for the RNTrackerSpec component set. These headers are generated at the first
// New-Arch build from src/TrackMapViewNativeComponent.ts; the exact class/struct names below
// (TrackMapViewComponentDescriptor, TrackMapViewProps, TrackMapViewEventEmitter,
// RCTTrackMapViewViewProtocol) are what codegen emits for component name "TrackMapView" and must be
// reconciled against the emitted RNTrackerSpec headers on that first build (buildNotes).
#import <react/renderer/components/RNTrackerSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNTrackerSpec/EventEmitters.h>
#import <react/renderer/components/RNTrackerSpec/Props.h>
#import <react/renderer/components/RNTrackerSpec/RCTComponentViewHelpers.h>

#import <React/RCTConversions.h>

// TrackMapHostView (Swift) — hosts the SwiftUI TrackMapView. Exposed via the pod's generated
// Swift header (module name = pod name = "Tracker").
#import "Tracker-Swift.h"

using namespace facebook::react;

@interface TrackMapViewComponentView () <RCTTrackMapViewViewProtocol>
@end

@implementation TrackMapViewComponentView {
  TrackMapHostView *_hostView;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<TrackMapViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const TrackMapViewProps>();
    _props = defaultProps;

    _hostView = [TrackMapHostView new];

    // Bridge SwiftUI TrackMapView.onArrowZoomChange -> Fabric direct event onArrowZoom { zoom }.
    __weak TrackMapViewComponentView *weakSelf = self;
    _hostView.onArrowZoom = ^(float zoom) {
      __strong TrackMapViewComponentView *strongSelf = weakSelf;
      if (strongSelf == nil) { return; }
      const auto emitter =
          std::static_pointer_cast<const TrackMapViewEventEmitter>(strongSelf->_eventEmitter);
      if (emitter) {
        emitter->onArrowZoom(TrackMapViewEventEmitter::OnArrowZoom{ .zoom = (double)zoom });
      }
    };

    self.contentView = _hostView;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &oldViewProps = *std::static_pointer_cast<TrackMapViewProps const>(_props);
  const auto &newViewProps = *std::static_pointer_cast<TrackMapViewProps const>(props);

  const bool trackChanged   = newViewProps.track != oldViewProps.track;
  const bool optionsChanged = newViewProps.options != oldViewProps.options;

  if (trackChanged || optionsChanged) {
    NSString *track = RCTNSStringFromStringNilIfEmpty(newViewProps.track);
    NSString *options = RCTNSStringFromStringNilIfEmpty(newViewProps.options);
    [_hostView updateWithTrackJSON:track optionsJSON:options];
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [_hostView teardown];
  [super prepareForRecycle];
}

@end

// Registration entry the codegen RCTThirdPartyFabricComponentsProvider looks up for "TrackMapView".
Class<RCTComponentViewProtocol> TrackMapViewCls(void)
{
  return TrackMapViewComponentView.class;
}

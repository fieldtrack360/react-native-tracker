#import "LiveTrackMapViewComponentView.h"

// Codegen output for component name "LiveTrackMapView" (from src/LiveTrackMapViewNativeComponent.ts).
// Names below must be reconciled against the emitted RNTrackerSpec headers on the first build.
#import <react/renderer/components/RNTrackerSpec/ComponentDescriptors.h>
#import <react/renderer/components/RNTrackerSpec/EventEmitters.h>
#import <react/renderer/components/RNTrackerSpec/Props.h>
#import <react/renderer/components/RNTrackerSpec/RCTComponentViewHelpers.h>

#import <React/RCTConversions.h>

// LiveTrackMapHostView (Swift) — hosts the SwiftUI LiveTrackMapView.
#import "Tracker-Swift.h"

using namespace facebook::react;

@interface LiveTrackMapViewComponentView () <RCTLiveTrackMapViewViewProtocol>
@end

@implementation LiveTrackMapViewComponentView {
  LiveTrackMapHostView *_hostView;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<LiveTrackMapViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const LiveTrackMapViewProps>();
    _props = defaultProps;

    _hostView = [LiveTrackMapHostView new];

    // Bridge the SwiftUI isFollowing Binding -> Fabric direct event onFollowingChange { isFollowing }.
    __weak LiveTrackMapViewComponentView *weakSelf = self;
    _hostView.onFollowingChange = ^(BOOL isFollowing) {
      __strong LiveTrackMapViewComponentView *strongSelf = weakSelf;
      if (strongSelf == nil) { return; }
      const auto emitter =
          std::static_pointer_cast<const LiveTrackMapViewEventEmitter>(strongSelf->_eventEmitter);
      if (emitter) {
        emitter->onFollowingChange(
            LiveTrackMapViewEventEmitter::OnFollowingChange{ .isFollowing = (bool)isFollowing });
      }
    };

    self.contentView = _hostView;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newViewProps = *std::static_pointer_cast<LiveTrackMapViewProps const>(props);

  NSString *update = RCTNSStringFromStringNilIfEmpty(newViewProps.update);
  NSString *options = RCTNSStringFromStringNilIfEmpty(newViewProps.options);
  NSString *followMode = RCTNSStringFromStringNilIfEmpty(newViewProps.followMode);

  // initialCentre is a codegen struct with plain doubles (0/0 when JS omitted it). Pass nil for the
  // unset case so the Swift host keeps its default (no forced centre).
  NSNumber *lat = nil;
  NSNumber *lng = nil;
  if (newViewProps.initialCentre.latitude != 0.0 || newViewProps.initialCentre.longitude != 0.0) {
    lat = @(newViewProps.initialCentre.latitude);
    lng = @(newViewProps.initialCentre.longitude);
  }

  [_hostView updateWithUpdateJSON:update
                      optionsJSON:options
                       followMode:followMode
                 initialCentreLat:lat
                 initialCentreLng:lng];

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle
{
  [_hostView teardown];
  [super prepareForRecycle];
}

@end

Class<RCTComponentViewProtocol> LiveTrackMapViewCls(void)
{
  return LiveTrackMapViewComponentView.class;
}

#import <UIKit/UIKit.h>
#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

// Fabric host for <TrackMapView>. RCTViewComponentView subclass — the New-Arch view
// component. Implementation is ObjC++ (.mm) so it can talk to the codegen C++ Props/EventEmitter;
// the actual SwiftUI hosting lives in TrackMapHostView (TrackerMapView.swift).
@interface TrackMapViewComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END

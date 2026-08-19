#import <UIKit/UIKit.h>
#import <React/RCTViewComponentView.h>

NS_ASSUME_NONNULL_BEGIN

// Fabric host for <LiveTrackMapView>. RCTViewComponentView subclass; the SwiftUI
// LiveTrackMapView (a UIViewRepresentable over MKMapView) is hosted by LiveTrackMapHostView
// (TrackerMapView.swift), which feeds it from the native Tracker.shared.liveTrack() stream
// (reconstructionNotes: LiveTrackUpdate cannot be rebuilt from JSON on iOS).
@interface LiveTrackMapViewComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END

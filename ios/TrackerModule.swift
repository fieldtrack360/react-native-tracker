import Foundation
import TrackerCore

// Swift implementation behind the ObjC++ TurboModule host (TrackerModule.mm). Exposes @objc
// static entry points that take plain ObjC block closures, so no React headers are needed
// here — the .mm owns the RCTPromise blocks and wraps them.
//
// PHASE 1: getState() only. Grows into the full facade in Phase 2/3.
@objc(TrackerImpl)
public final class TrackerImpl: NSObject {

  /// getState(): reads the @MainActor Tracker.shared.state and resolves the wire dict.
  /// No behaviour, no defaulting — just transport.
  @objc(getStateOnResolve:onReject:)
  public static func getState(onResolve: @escaping (NSDictionary) -> Void,
                              onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let dict = TrackerMappers.stateDict(Tracker.shared.state)
      onResolve(dict as NSDictionary)
    }
  }
}

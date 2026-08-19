import Foundation
import TrackerCore
import TrackerGeo

// live surface — setActiveRoute / isOffRoute. `onLiveTrack` is Phase 4, not here.
//
// Both facade methods are `async` and NON-throwing on the iOS surface, and — unlike
// `permissions()` — they are NOT @MainActor:
//   `final public func setActiveRoute(_ route: [TrackerGeo.GeoPoint]) async`      (TrackerCore)
//   `final public func isOffRoute() async -> Swift.Bool`                          (TrackerCore)
// So a plain detached Task is the correct hop: no MainActor, no throw. `onReject` is provided
// for signature symmetry with the scaffold blocks but never fires (no domain failure).
//
// Input decode is inline. TrackerMappers is native→wire (output) only; `GeoPoint` here is an
// argument shape (wire→native) with no output mapper to call.
extension TrackerImpl {

  /// setActiveRoute(points): projects the live puck only; never changes stored evidence or
  /// historical tracks. An empty array clears the route — handled natively, just passed through.
  /// `GeoPoint(latitude:longitude:)` per TrackerGeo; wire keys `latitude`/`longitude`.
  @objc(setActiveRoutePoints:onResolve:onReject:)
  public static func setActiveRoute(points: NSArray,
                                    onResolve: @escaping () -> Void,
                                    onReject: @escaping (NSString, NSString) -> Void) {
    let route: [GeoPoint] = points.compactMap { element in
      guard let dict = element as? [String: Any],
            let lat = (dict["latitude"] as? NSNumber)?.doubleValue,
            let lon = (dict["longitude"] as? NSNumber)?.doubleValue else { return nil }
      return GeoPoint(latitude: lat, longitude: lon)
    }
    Task {
      await Tracker.shared.setActiveRoute(route)
      onResolve()
    }
  }

  /// isOffRoute(): whether the current live puck has diverged from the active route.
  @objc(isOffRouteOnResolve:onReject:)
  public static func isOffRoute(onResolve: @escaping (NSNumber) -> Void,
                                onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let off = await Tracker.shared.isOffRoute()
      onResolve(NSNumber(value: off))
    }
  }
}
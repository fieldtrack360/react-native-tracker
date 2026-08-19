import Foundation
import TrackerCore
import TrackerGeo
import TrackerSnap

// Road snapping — Swift entry points behind the ObjC++ TurboModule host (TrackerModule.mm).
// Each @objc static func takes plain ObjC block closures (no React headers in Swift): a no-arg
// onResolve for the Promise<void> and (code, message) onReject for a bridge fault.
//
// Threading: Tracker.shared.setRoadSnapProvider(_:) is a nonisolated, synchronous method on the
// Sendable Tracker facade (TrackerCore.swiftinterface:361 — no @MainActor, no async), and
// OSRMSnapProvider construction is synchronous, so there is no actor hop and no Task here — the
// work runs inline on the TurboModule's calling queue.
//
// Mappers: this subsystem calls NO TrackerMappers functions — the inputs are plain strings and
// the return is void, so there is nothing to normalize.
extension TrackerImpl {

  /// setOsrmSnapProvider. `baseURL` crosses as a string; OSRMSnapProvider.init takes a
  /// Foundation.URL (TrackerSnap.swiftinterface:13), so we parse it here and reject
  /// `invalidConfig` (a bad-argument bridge fault) when it will not parse. `profile` nil =>
  /// use the SDK default ("driving") by omitting the argument.
  @objc(setOsrmSnapProviderWithBaseURL:profile:onResolve:onReject:)
  public static func setOsrmSnapProvider(baseURL: NSString,
                                         profile: NSString?,
                                         onResolve: @escaping () -> Void,
                                         onReject: @escaping (NSString, NSString) -> Void) {
    guard let url = URL(string: baseURL as String) else {
      onReject("invalidConfig", "setOsrmSnapProvider: baseUrl is not a parseable URL")
      return
    }
    let provider: OSRMSnapProvider
    if let profile = profile as String? {
      provider = OSRMSnapProvider(baseURL: url, profile: profile)
    } else {
      provider = OSRMSnapProvider(baseURL: url)
    }
    Tracker.shared.setRoadSnapProvider(provider)
    onResolve()
  }

  /// clearRoadSnapProvider. iOS TrackerCore exposes no clear API and no Disabled provider,
  /// so instead of a native "disable" we install a bridge-defined no-op
  /// RoadSnapProvider that hands the input path back unchanged. buildTrack then snaps points to
  /// themselves — i.e. raw geometry — which is exactly what Android's RoadSnapProvider.Disabled
  /// yields. Cannot fail => never rejects.
  @objc(clearRoadSnapProviderOnResolve:onReject:)
  public static func clearRoadSnapProvider(onResolve: @escaping () -> Void,
                                           onReject: @escaping (NSString, NSString) -> Void) {
    Tracker.shared.setRoadSnapProvider(RawGeometrySnapProvider())
    onResolve()
  }
}

/// Bridge-defined no-op road snapper used by clearRoadSnapProvider(). Conforms to
/// TrackerGeo.RoadSnapProvider (TrackerGeo.swiftinterface:396-399) and returns the input
/// geometry verbatim from both overloads, forcing buildTrack to keep raw geometry. It has no
/// stored properties, so Sendable (required by the protocol) is inferred.
private struct RawGeometrySnapProvider: RoadSnapProvider {
  func snap(path: [GeoPoint]) async throws -> [GeoPoint] { path }
  func snap(request: SnapRequest) async throws -> [GeoPoint] { request.path }
}
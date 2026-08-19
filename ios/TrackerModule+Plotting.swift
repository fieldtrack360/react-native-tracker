import Foundation
import TrackerCore
import TrackerGeo

// Plotting — buildTrack / exportPolylineJson / exportGeoJson. @objc static entry points behind
// the ObjC++ TurboModule host (TrackerModule.mm); each takes plain ObjC block closures so no React
// headers are needed here — the .mm owns the RCTPromise blocks and wraps them.
//
// Threading: buildTrack / exportPolylineJSON / exportGeoJSON are non-isolated `async throws` on the
// Sendable `Tracker` facade (NOT @MainActor — only state reads are), so a plain Task runs them off
// the main actor. These are reads: a native throw rejects the Promise.
//
// Mapping: buildTrack maps the native `Track` OBJECT to the one wire JSON string via the foundation
// mapper TrackerMappers.trackJSON (there is no native JSON string to decode; the two SDKs' Codable
// JSON diverge hard — see TrackerMappers). export* return the SDK's JSON string directly
// (pass-through, no mapper). NOTE the iOS SDK selectors are exportPolylineJSON / exportGeoJSON (caps
// JSON); the JS/bridge names are exportPolylineJson / exportGeoJson — the casing is absorbed here.
//
// Depends on foundation input mappers (TrackerMappers): `pointQuery(_ dict: NSDictionary?)
// -> PointQuery` and `trackOptions(_ dict: NSDictionary?) -> TrackOptions`, both returning the SDK
// defaults (PointQuery() / TrackOptions()) when the dict is nil (JS omitted the arg).
extension TrackerImpl {

  /// buildTrack(query?, options?) → wire Track JSON string.
  @objc(buildTrackQuery:options:onResolve:onReject:)
  public static func buildTrack(query: NSDictionary?,
                                options: NSDictionary?,
                                onResolve: @escaping (NSString) -> Void,
                                onReject: @escaping (NSString, NSString) -> Void) {
    let q = TrackerMappers.pointQuery(query)
    let o = TrackerMappers.trackOptions(options)
    Task {
      do {
        let track = try await Tracker.shared.buildTrack(q, options: o)
        let json = try TrackerMappers.trackJSON(track)
        onResolve(json as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// exportPolylineJson(query?, options?) → SDK polyline JSON string (pass-through).
  @objc(exportPolylineJsonQuery:options:onResolve:onReject:)
  public static func exportPolylineJson(query: NSDictionary?,
                                        options: NSDictionary?,
                                        onResolve: @escaping (NSString) -> Void,
                                        onReject: @escaping (NSString, NSString) -> Void) {
    let q = TrackerMappers.pointQuery(query)
    let o = TrackerMappers.trackOptions(options)
    Task {
      do {
        let json = try await Tracker.shared.exportPolylineJSON(q, options: o)
        onResolve(json as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// exportGeoJson(query?, options?) → SDK GeoJSON string (pass-through; coord order [lon,lat]).
  @objc(exportGeoJsonQuery:options:onResolve:onReject:)
  public static func exportGeoJson(query: NSDictionary?,
                                   options: NSDictionary?,
                                   onResolve: @escaping (NSString) -> Void,
                                   onReject: @escaping (NSString, NSString) -> Void) {
    let q = TrackerMappers.pointQuery(query)
    let o = TrackerMappers.trackOptions(options)
    Task {
      do {
        let json = try await Tracker.shared.exportGeoJSON(q, options: o)
        onResolve(json as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }
}
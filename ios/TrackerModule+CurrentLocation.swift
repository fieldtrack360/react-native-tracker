import Foundation
import TrackerCore
import TrackerGeo

// currentLocation — Swift side of the bridge. TrackerModule.mm owns the RCTPromise blocks
// and forwards here through TrackerImpl. Domain failures resolve `ok:false`;
// iOS has NO bridge-fault path for this method (feedIngestor IS supported on iOS — see surface
// line 346), so this always resolves and never rejects. All wire vocabulary/renames stay in
// TrackerMappers (rule 2).
extension TrackerImpl {

  /// getCurrentLocation(feedIngestor:) → TrackerResult<TrackFix>.
  /// Surface (TrackerCore.swiftinterface:346):
  ///   `final public func getCurrentLocation(feedIngestor: Swift.Bool = false) async
  ///      -> TrackerCore.TrackerResult<TrackerGeo.TrackFix>`
  /// feedIngestor is forwarded verbatim — Android is the side that rejects it, not iOS.
  /// The facade func is nonisolated `async` (`Tracker` is `Sendable`; the method carries no
  /// `@MainActor`, unlike `permissions()`/`getSensors()`), so a plain `Task` is the correct actor
  /// context — no MainActor hop is needed or wanted here.
  @objc(getCurrentLocationFeedIngestor:onResolve:onReject:)
  public static func getCurrentLocation(feedIngestor: Bool,
                                        onResolve: @escaping (NSDictionary) -> Void,
                                        onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let result = await Tracker.shared.getCurrentLocation(feedIngestor: feedIngestor)
      switch result {
      case .success(let fix):
        // ok:true — `value` is the typed TrackFix wire shape from the foundation core-shape mapper.
        onResolve(["ok": true, "value": TrackerMappers.trackFixDict(fix)] as NSDictionary)
      case .failure(let code, let message):
        // Domain failure resolves ok:false (never rejects). iOS `ErrorCode` is a String-backed
        // enum whose `rawValue` is already the wire vocabulary (incl. `internalError`), so no remap
        // is needed on iOS — only Android special-cases `INTERNAL`. iOS defect: `code` is always
        // `.fixTimeout`; `message` names the true cause.
        onResolve(["ok": false, "code": code.rawValue, "message": message] as NSDictionary)
      }
    }
  }
}
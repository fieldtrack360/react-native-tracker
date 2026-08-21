import Foundation
import TrackerCore
import TrackerGeo

// currentLocation — Swift side of the bridge. TrackerModule.mm owns the RCTPromise blocks
// and forwards here through TrackerImpl. Domain failures resolve `ok:false`;
// iOS has NO bridge-fault path for this method, so this always resolves and never rejects.
// All wire vocabulary/renames stay in TrackerMappers (rule 2).
extension TrackerImpl {

  /// getCurrentLocation() → TrackerResult<TrackFix>.
  /// Surface (TrackerCore.swiftinterface):
  ///   `final public func getCurrentLocation(feedIngestor: Swift.Bool = true) async
  ///      -> TrackerCore.TrackerResult<TrackerGeo.TrackFix>`
  ///
  /// BEHAVIOUR NOTE — the default FLIPPED. It was `false` when this bridge was written, and the
  /// 1.0.0 rebuild at commit b4afe5ba made it `true`. The argument is still omitted here, so on iOS
  /// a one-shot is now ALSO handed to the ingest consumer: judged by the same gates as a streamed
  /// fix and, when a session is open, stored as a point on it. Nothing is bypassed — a one-shot
  /// still cannot inject an unvalidated point — but a screen that asks "where am I" adds a point to
  /// the user's track each time it opens, and Android's one-shot is still snapshot-only, so this is
  /// now a REAL divergence rather than the parity the previous comment claimed. Pass
  /// `feedIngestor: false` here if the bridge should go back to matching Android.
  /// The facade func is nonisolated `async` (`Tracker` is `Sendable`; the method carries no
  /// `@MainActor`, unlike `permissions()`/`getSensors()`), so a plain `Task` is the correct actor
  /// context — no MainActor hop is needed or wanted here.
  @objc(getCurrentLocationOnResolve:onReject:)
  public static func getCurrentLocation(onResolve: @escaping (NSDictionary) -> Void,
                                        onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let result = await Tracker.shared.getCurrentLocation()
      switch result {
      case .success(let fix):
        // ok:true — `value` is the typed TrackFix wire shape from the foundation core-shape mapper.
        onResolve(["ok": true, "value": TrackerMappers.trackFixDict(fix)] as NSDictionary)
      case .failure(let code, let message):
        // Domain failure resolves ok:false (never rejects). iOS `ErrorCode` is a String-backed
        // enum whose `rawValue` is already the wire vocabulary (incl. `internalError`), so no remap
        // is needed on iOS — only Android special-cases `INTERNAL`. The old iOS defect where `code`
        // was always `.fixTimeout` is FIXED as of the rebuild at commit a6a19731: the failures now
        // name themselves, and three of them cross for the first time — `oneShotBusy`,
        // `oneShotCircuitOpen` and `fixRejected`. The last two must NOT be retried, so a host that
        // still treats every failure as "retry later" is now wrong in a way it was not before.
        onResolve(["ok": false, "code": code.rawValue, "message": message] as NSDictionary)
      }
    }
  }
}
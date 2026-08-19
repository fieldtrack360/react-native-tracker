import Foundation
import TrackerCore

// lifecycle — ready / start / stop. @objc static entry points taking plain ObjC block
// closures, so no React headers are needed here (TrackerModule.mm owns the RCTPromise blocks).
//
// Result policy: a DOMAIN failure RESOLVES the envelope { ok:false, code, message };
// the Promise REJECTS only for a bridge fault — here, config JSON that will not decode / invalid
// config. ready/start/stop are `async` (non-throwing) on the Sendable
// `Tracker.shared`. ready's success value is the @MainActor `TrackerState`, so every hop runs in a
// `Task { @MainActor in }` (matching the getState scaffold) — the facade calls are nonisolated and
// suspend off the main actor, then resume on it to map via TrackerMappers.
extension TrackerImpl {

  /// ready(config?). `configJSON` is the config JSON string (nil → SDK defaults).
  /// Relies on `TrackerMappers.decodeConfig(_:) throws -> TrackerConfig` (config subsystem): a
  /// throw (undecodable JSON or config refusal) is a bridge fault → reject `invalidConfig`.
  /// Success maps via `TrackerMappers.stateDict(_:)`; failure via `TrackerMappers.errorCode(_:)`.
  @objc(readyWithConfigJSON:onResolve:onReject:)
  public static func ready(configJSON: NSString?,
                           onResolve: @escaping (NSDictionary) -> Void,
                           onReject: @escaping (NSString, NSString) -> Void) {
    let json = configJSON as String?
    Task { @MainActor in
      let config: TrackerConfig
      if let json {
        do {
          config = try TrackerMappers.decodeConfig(json)
        } catch {
          onReject("invalidConfig" as NSString, String(describing: error) as NSString)
          return
        }
      } else {
        config = TrackerConfig()
      }
      let result = await Tracker.shared.ready(config)
      switch result {
      case .success(let state):
        onResolve(["ok": true, "value": TrackerMappers.stateDict(state)] as NSDictionary)
      case .failure(let code, let message):
        onResolve(["ok": false,
                   "code": TrackerMappers.errorCode(code),
                   "message": message] as NSDictionary)
      }
    }
  }

  /// start(tag?). No bridge fault here — a domain failure resolves ok:false. Success maps via
  /// `TrackerMappers.sessionDict(_:)`; failure via `TrackerMappers.errorCode(_:)`.
  @objc(startWithTag:onResolve:onReject:)
  public static func start(tag: NSString?,
                           onResolve: @escaping (NSDictionary) -> Void,
                           onReject: @escaping (NSString, NSString) -> Void) {
    let tagStr = tag as String?
    Task { @MainActor in
      let result = await Tracker.shared.start(tag: tagStr)
      switch result {
      case .success(let session):
        onResolve(["ok": true, "value": TrackerMappers.sessionDict(session)] as NSDictionary)
      case .failure(let code, let message):
        onResolve(["ok": false,
                   "code": TrackerMappers.errorCode(code),
                   "message": message] as NSDictionary)
      }
    }
  }

  /// stop(). iOS success value is `TrackSession?` — a nil session resolves value:null.
  /// A domain failure resolves ok:false.
  @objc(stopOnResolve:onReject:)
  public static func stop(onResolve: @escaping (NSDictionary) -> Void,
                          onReject: @escaping (NSString, NSString) -> Void) {
    Task { @MainActor in
      let result = await Tracker.shared.stop()
      switch result {
      case .success(let session):
        let value: Any = session.map { TrackerMappers.sessionDict($0) } ?? NSNull()
        onResolve(["ok": true, "value": value] as NSDictionary)
      case .failure(let code, let message):
        onResolve(["ok": false,
                   "code": TrackerMappers.errorCode(code),
                   "message": message] as NSDictionary)
      }
    }
  }
}
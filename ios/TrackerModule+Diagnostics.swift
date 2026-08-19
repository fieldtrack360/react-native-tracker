import Foundation
import TrackerCore
import TrackerGeo

// Diagnostics — the Swift half behind the ObjC++ TurboModule host (TrackerModule.mm). @objc
// static entry points taking plain ObjC block closures; no React headers here. All wire vocabulary
// (enum stringify, field renames) lives in TrackerMappers — these funcs are transport only
// ( rule 2). Reads are `async throws` on the facade, so a throw becomes a Promise
// rejection; the changePace domain result RESOLVES ok:false and never rejects.
//
// The facade (`Tracker.shared`) is Sendable and these members are NOT MainActor-isolated
// (getRawFixes/getRawPoints/getDecisions/offerFix/exportFixture/changePace are async on the
// Sendable class; getSensors is synchronous), so they run from a plain detached Task.
extension TrackerImpl {

  // getRawFixes(sessionId) — [RawFix] serialized to the wire JSON string.
  @objc(getRawFixesSessionId:onResolve:onReject:)
  public static func getRawFixes(sessionId: NSString,
                                 onResolve: @escaping (NSString) -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let fixes = try await Tracker.shared.getRawFixes(sessionID: sessionId as String)
        onResolve(try serializeDiagnostics(fixes.map { TrackerMappers.rawFixDict($0) }) as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  // getRawPoints(sessionId) — [RawPoint] serialized to the wire JSON string.
  @objc(getRawPointsSessionId:onResolve:onReject:)
  public static func getRawPoints(sessionId: NSString,
                                  onResolve: @escaping (NSString) -> Void,
                                  onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let points = try await Tracker.shared.getRawPoints(sessionID: sessionId as String)
        onResolve(try serializeDiagnostics(points.map { TrackerMappers.rawPointDict($0) }) as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  // getDecisions(sessionId?, limit?, offset?) — [FixDecision] → wire JSON string.
  // Surface defaults limit=200/offset=0 are applied when JS omits them.
  @objc(getDecisionsSessionId:limit:offset:onResolve:onReject:)
  public static func getDecisions(sessionId: NSString?,
                                  limit: NSNumber?,
                                  offset: NSNumber?,
                                  onResolve: @escaping (NSString) -> Void,
                                  onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let decisions = try await Tracker.shared.getDecisions(
          sessionID: sessionId as String?,
          limit: limit?.intValue ?? 200,
          offset: offset?.intValue ?? 0)
        onResolve(try serializeDiagnostics(decisions.map { TrackerMappers.fixDecisionDict($0) }) as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  // offerFix(fix) — decode the wire TrackFix (iOS field names already ARE the wire names, so no
  // rename) and hand it to the facade, which validates it (offerFix does NOT bypass validation).
  // `offerFix` is async & non-throwing on iOS, so this path never rejects.
  @objc(offerFixFix:onResolve:onReject:)
  public static func offerFix(fix: NSDictionary,
                              onResolve: @escaping () -> Void,
                              onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      await Tracker.shared.offerFix(trackFix(fromWire: fix))
      onResolve()
    }
  }

  // getSensors() — DeviceSensors (union). Synchronous & non-isolated on the facade.
  @objc(getSensorsOnResolve:onReject:)
  public static func getSensors(onResolve: @escaping (NSDictionary) -> Void,
                                onReject: @escaping (NSString, NSString) -> Void) {
    onResolve(TrackerMappers.sensorsDict(Tracker.shared.getSensors()) as NSDictionary)
  }

  // ios.exportFixture(sessionId, name) — iOS-only; returns a package-scoped fixture as a JSON
  // string (the string is all that crosses). `async throws` → a throw rejects.
  @objc(exportFixtureSessionId:name:onResolve:onReject:)
  public static func exportFixture(sessionId: NSString,
                                   name: NSString,
                                   onResolve: @escaping (NSString) -> Void,
                                   onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let json = try await Tracker.shared.exportFixture(sessionID: sessionId as String,
                                                          name: name as String)
        onResolve(json as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  // ios.changePace(isMoving) — iOS-only; TrackerResult<Void>. A domain failure RESOLVES
  // ok:false, it does not reject. iOS ErrorCode is String-backed and its rawValue is already
  // the wire vocabulary (no iOS renames), so `code.rawValue` is the wire error code.
  @objc(changePaceIsMoving:onResolve:onReject:)
  public static func changePace(isMoving: Bool,
                                onResolve: @escaping (NSDictionary) -> Void,
                                onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      switch await Tracker.shared.changePace(isMoving: isMoving) {
      case .success:
        onResolve(["ok": true] as NSDictionary)
      case .failure(let code, let message):
        onResolve(["ok": false, "code": code.rawValue, "message": message] as NSDictionary)
      }
    }
  }

  // MARK: - transport helpers (diagnostics-local, file-private)

  /// Serialize a mapped wire array to the JSON string the contract carries. A serialize
  /// fault is a bridge fault → the caller rejects.
  private static func serializeDiagnostics(_ rows: [[String: Any]]) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: rows, options: [])
    return String(decoding: data, as: UTF8.self)
  }

  /// Wire TrackFix dict → native `TrackerGeo.TrackFix`. iOS TrackFix field names ARE the wire names
  /// (accuracyM / monotonicNanos / altitudeM / verticalAccuracyM / receivedAtMonotonicNanos / …),
  /// so this is a direct read with NO rename; `android.satelliteCount` is Android-only and has
  /// no iOS home (dropped). Missing fields fall to the native ctor defaults; the facade validates.
  private static func trackFix(fromWire d: NSDictionary) -> TrackFix {
    TrackFix(
      timeMs: (d["timeMs"] as? NSNumber)?.int64Value ?? 0,
      monotonicNanos: (d["monotonicNanos"] as? NSNumber)?.int64Value ?? 0,
      receivedAtMonotonicNanos: (d["receivedAtMonotonicNanos"] as? NSNumber)?.int64Value ?? 0,
      latitude: (d["latitude"] as? NSNumber)?.doubleValue ?? 0,
      longitude: (d["longitude"] as? NSNumber)?.doubleValue ?? 0,
      accuracyM: (d["accuracyM"] as? NSNumber)?.floatValue ?? 0,
      altitudeM: (d["altitudeM"] as? NSNumber)?.doubleValue,
      verticalAccuracyM: (d["verticalAccuracyM"] as? NSNumber)?.floatValue,
      speedMps: (d["speedMps"] as? NSNumber)?.floatValue ?? 0,
      bearingDeg: (d["bearingDeg"] as? NSNumber)?.floatValue ?? 0,
      hasSpeed: (d["hasSpeed"] as? NSNumber)?.boolValue ?? false,
      hasBearing: (d["hasBearing"] as? NSNumber)?.boolValue ?? false,
      provider: (d["provider"] as? String) ?? TrackFix.unknownProvider,
      isMock: (d["isMock"] as? NSNumber)?.boolValue ?? false,
      speedAccuracyMps: (d["speedAccuracyMps"] as? NSNumber)?.floatValue,
      bearingAccuracyDeg: (d["bearingAccuracyDeg"] as? NSNumber)?.floatValue
    )
  }

  /// android.getBatteryInfo() — Android-only; rejects on iOS. The iOS facade exposes no
  /// battery reading at all (TrackPoint carries none either), so there is nothing to shim.
  @objc(androidGetBatteryInfoOnResolve:onReject:)
  public static func androidGetBatteryInfo(onResolve: @escaping (NSDictionary) -> Void,
                                           onReject: @escaping (NSString, NSString) -> Void) {
    onReject("unsupportedOnPlatform", "androidGetBatteryInfo() is Android-only; not available on iOS")
  }
}

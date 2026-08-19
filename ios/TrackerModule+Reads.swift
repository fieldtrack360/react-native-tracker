import Foundation
import TrackerCore
import TrackerGeo

// reads — getPoints / getCount / getOdometerMeters / getSessions / currentSession.
// Async facade calls on Tracker.shared. The facade's state is MainActor-isolated, but these read
// methods are nonisolated `async throws`, so they run from a plain (off-main) Task — keeping the
// getPoints serialization off the main thread. Reads throw natively → the bridge method REJECTS.
// All wire vocabulary/renames live in TrackerMappers; the array→JSON-string
// serialization for the unbounded getPoints happens here, per the mappers' documented convention
// ("the module serializes them with JSONSerialization").
extension TrackerImpl {

  // Build a native PointQuery WITHOUT normalizing: override only the fields the caller
  // supplied so the SDK's own defaults apply (limit stays PointQuery.defaultLimit, offset 0).
  // Inbound arg decode incl. the wire `sessionId` → iOS `sessionID` rename.
  private static func makePointQuery(_ query: NSDictionary?) -> PointQuery {
    var q = PointQuery()
    guard let query = query else { return q }
    if let v = query["sessionId"] as? String { q.sessionID = v }
    if let v = query["fromMs"] as? NSNumber { q.fromMs = v.int64Value }
    if let v = query["toMs"] as? NSNumber { q.toMs = v.int64Value }
    if let v = query["limit"] as? NSNumber { q.limit = Int(truncating: v) }
    if let v = query["offset"] as? NSNumber { q.offset = Int(truncating: v) }
    return q
  }

  /// getPoints(query?) → JSON string (unbounded). Per-point map via
  /// TrackerMappers.trackPointDict; the array is serialized to the wire JSON string here.
  @objc(getPointsQuery:onResolve:onReject:)
  public static func getPoints(query: NSDictionary?,
                               onResolve: @escaping (NSString) -> Void,
                               onReject: @escaping (NSString, NSString) -> Void) {
    let q = makePointQuery(query)
    Task {
      do {
        let points = try await Tracker.shared.getPoints(q)
        let dicts = points.map { TrackerMappers.trackPointDict($0) }
        let data = try JSONSerialization.data(withJSONObject: dicts, options: [])
        onResolve(String(decoding: data, as: UTF8.self) as NSString)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// getCount(query?) → number.
  @objc(getCountQuery:onResolve:onReject:)
  public static func getCount(query: NSDictionary?,
                              onResolve: @escaping (NSNumber) -> Void,
                              onReject: @escaping (NSString, NSString) -> Void) {
    let q = makePointQuery(query)
    Task {
      do {
        let count = try await Tracker.shared.getCount(q)
        onResolve(NSNumber(value: count))
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// getOdometerMeters() → number (meters).
  @objc(getOdometerMetersOnResolve:onReject:)
  public static func getOdometerMeters(onResolve: @escaping (NSNumber) -> Void,
                                       onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let meters = try await Tracker.shared.getOdometerMeters()
        onResolve(NSNumber(value: meters))
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// getSessions(fromMs?, toMs?) → TrackSession[] (typed). Nil filters pass through as the
  /// facade's own `nil` defaults (no normalization). Per-session map via TrackerMappers.sessionDict.
  @objc(getSessionsFromMs:toMs:onResolve:onReject:)
  public static func getSessions(fromMs: NSNumber?,
                                 toMs: NSNumber?,
                                 onResolve: @escaping (NSArray) -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let sessions = try await Tracker.shared.getSessions(fromMs: fromMs?.int64Value,
                                                            toMs: toMs?.int64Value)
        let dicts = sessions.map { TrackerMappers.sessionDict($0) }
        onResolve(dicts as NSArray)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// currentSession() → TrackSession | null (resolves nil when no session is open).
  @objc(currentSessionOnResolve:onReject:)
  public static func currentSession(onResolve: @escaping (NSDictionary?) -> Void,
                                    onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        if let s = try await Tracker.shared.currentSession() {
          onResolve(TrackerMappers.sessionDict(s) as NSDictionary)
        } else {
          onResolve(nil)
        }
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }
}
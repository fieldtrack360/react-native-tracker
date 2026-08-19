import Foundation
import TrackerCore

// Geofencing — iOS half. Return types take the Android shape (TrackerResult); the bare Bool/Int
// from removeGeofence/removeAllGeofences are wrapped in { ok:true } here (a — wrapping a
// success is lossless). get(id) is shimmed by filtering getGeofences() (b). All wire
// vocabulary/renames live in TrackerMappers.
extension TrackerImpl {

  /// add — wire fence → native, then addGeofence → TrackerResult wire. dwellAfterMs and the
  /// notify flags are iOS-native, so iOS never refuses them (only the Android mapper does, c/d).
  @objc(geofenceAddFence:onResolve:onReject:)
  public static func geofenceAdd(fence: NSDictionary,
                                 onResolve: @escaping (NSDictionary) -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    guard let g = TrackerMappers.geofenceFromWire(fence) else {
      onResolve(["ok": false, "code": "invalidConfig",
                 "message": "geofence is missing a required field (id/latitude/longitude/radiusM)"] as NSDictionary)
      return
    }
    Task {
      let result = await Tracker.shared.addGeofence(g)
      switch result {
      case .success(let added):
        onResolve(["ok": true, "value": TrackerMappers.geofenceDict(added)] as NSDictionary)
      case .failure(let code, let message):
        onResolve(["ok": false, "code": code.rawValue, "message": message] as NSDictionary)
      }
    }
  }

  /// list.
  @objc(geofenceListOnResolve:onReject:)
  public static func geofenceList(onResolve: @escaping (NSArray) -> Void,
                                  onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let fences = await Tracker.shared.getGeofences()
      onResolve(fences.map { TrackerMappers.geofenceDict($0) } as NSArray)
    }
  }

  /// get(id) — iOS shim: filter getGeofences() (b). Resolves nil when not found.
  @objc(geofenceGetId:onResolve:onReject:)
  public static func geofenceGet(id: String,
                                 onResolve: @escaping (NSDictionary?) -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      if let g = await Tracker.shared.getGeofences().first(where: { $0.id == id }) {
        onResolve(TrackerMappers.geofenceDict(g) as NSDictionary)
      } else {
        onResolve(nil)
      }
    }
  }

  /// remove(id) — bare Bool wrapped in { ok:true } (a).
  @objc(geofenceRemoveId:onResolve:onReject:)
  public static func geofenceRemove(id: String,
                                    onResolve: @escaping (NSDictionary) -> Void,
                                    onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let removed = await Tracker.shared.removeGeofence(id: id)
      onResolve(["ok": true, "value": removed] as NSDictionary)
    }
  }

  /// removeAll — bare Int wrapped in { ok:true } (a).
  @objc(geofenceRemoveAllOnResolve:onReject:)
  public static func geofenceRemoveAll(onResolve: @escaping (NSDictionary) -> Void,
                                       onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let count = await Tracker.shared.removeAllGeofences()
      onResolve(["ok": true, "value": count] as NSDictionary)
    }
  }

  /// getEvents(opts?) — the source of truth. iOS ignores fromMs/toMs (not in the native
  /// signature); honours geofenceId/limit/offset (defaults 200/0). Throws → reject.
  @objc(geofenceGetEventsOpts:onResolve:onReject:)
  public static func geofenceGetEvents(opts: NSDictionary?,
                                       onResolve: @escaping (NSArray) -> Void,
                                       onReject: @escaping (NSString, NSString) -> Void) {
    let geofenceID = opts?["geofenceId"] as? String
    let limit = (opts?["limit"] as? NSNumber).map { Int(truncating: $0) } ?? 200
    let offset = (opts?["offset"] as? NSNumber).map { Int(truncating: $0) } ?? 0
    Task {
      do {
        let events = try await Tracker.shared.getGeofenceEvents(geofenceID: geofenceID, limit: limit, offset: offset)
        onResolve(events.map { TrackerMappers.crossingDict($0) } as NSArray)
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }

  /// deleteEvents(geofenceId?) — iOS's native delete returns Void; the wire returns a count, so
  /// the pre-delete count is read first (a read, not invented behaviour) and resolved. Throws → reject.
  @objc(geofenceDeleteEventsGeofenceId:onResolve:onReject:)
  public static func geofenceDeleteEvents(geofenceId: String?,
                                          onResolve: @escaping (NSNumber) -> Void,
                                          onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      do {
        let count = try await Tracker.shared.getGeofenceEvents(geofenceID: geofenceId, limit: Int.max, offset: 0).count
        try await Tracker.shared.deleteGeofenceEvents(geofenceID: geofenceId)
        onResolve(NSNumber(value: count))
      } catch {
        onReject("internalError" as NSString, error.localizedDescription as NSString)
      }
    }
  }
}

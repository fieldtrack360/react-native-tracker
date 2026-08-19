import Foundation
import TrackerCore
import TrackerGeo

// Wire vocabulary — the ONLY place iOS enums stringify and fields are renamed.
// Module files stay thin sequencing over the facade; every enum-to-string and every
// field rename lives here.
//
// Return conventions:
//  - Codegen-typed shapes (TrackerState, ProviderState, DeviceSensors, TrackFix, TrackSession)
//    return `[String: Any]`, bridged to NSDictionary by the module and resolved directly.
//  - JSON-string shapes (TrackPoint, RawFix, RawPoint, FixDecision, and the whole Track tree —
//    unbounded collections) also build `[String: Any]`; the module serializes them
//    with JSONSerialization. `trackJSON` is provided as the drop-in serializer for buildTrack.
//
// Track tree — DECODE-vs-MAP decision: we map the native `Track` OBJECT field-by-field, we do
// NOT decode a JSON string. `Tracker.shared.buildTrack(...)` returns `TrackerGeo.Track` (a Swift
// struct), not a string — there is no native JSON string to decode. Even if there were, the two
// platforms' Codable/@Serializable JSON diverge hard (zero-overlap TrackJSONPoint keys, renamed
// TrackStats fields, iOS-only travelStartMs, kotlinx SCREAMING_SNAKE enums), so reading the typed
// accessors and re-keying onto the one wire shape is the only faithful path and avoids a
// serialize→parse→re-key round trip.
enum TrackerMappers {

  // MARK: - Enum vocabulary

  /// permission tier — a VALUE rename, not casing. iOS `whenInUse` → wire `foreground`.
  static func permissionTier(_ tier: AuthorizationTier) -> String {
    switch tier {
    case .none: return "none"
    case .whenInUse: return "foreground"
    case .always: return "always"
    }
  }

  /// accuracy — a VALUE rename, not casing. iOS `reduced`/`full` → wire `approximate`/`precise`.
  static func accuracyAuthorization(_ accuracy: LocationAccuracy) -> String {
    switch accuracy {
    case .reduced: return "approximate"
    case .full: return "precise"
    }
  }

  // Every other enum is String-backed on iOS and its `rawValue` is already the wire vocabulary
  // (lower camel: MotionState.stopPending, ActivityType.inVehicle, MovementStatus.steady,
  // MotionQuality.degraded, SegmentType.travel), so those are `.rawValue` at each call site —
  // Android is the side that normalizes SCREAMING_SNAKE.

  // MARK: - TrackerState

  /// TrackerState → wire dictionary. iOS MotionState.rawValue is already the wire vocabulary,
  /// so motion is an identity map here. `sessionID` (iOS) → `sessionId` (wire) is the rename;
  /// `providerState` is the union (getState ships the full wire shape).
  @MainActor
  static func stateDict(_ state: TrackerState) -> [String: Any] {
    var dict: [String: Any] = [
      "isReady": state.isReady,
      "isTracking": state.isTracking,
      "motionState": state.motionState.rawValue,
      "providerState": providerStateDict(state.providerState),
    ]
    if let sessionID = state.currentSessionID {
      dict["currentSessionId"] = sessionID
    }
    return dict
  }

  // MARK: - ProviderState (union)

  /// ProviderState → wire. Shared flat: `permissionTier` (from iOS `authorization`, a tier
  /// value), `accuracyAuthorization` (value rename), `powerSave` (from iOS `lowPowerMode`).
  /// The iOS-only half is namespaced; the Android half is absent on this platform.
  static func providerStateDict(_ p: ProviderState) -> [String: Any] {
    return [
      "permissionTier": permissionTier(p.authorization),
      "accuracyAuthorization": accuracyAuthorization(p.accuracyAuthorization),
      "powerSave": p.lowPowerMode,
      "ios": [
        "locationServicesEnabled": p.locationServicesEnabled,
        "significantLocationChangeAvailable": p.significantLocationChangeAvailable,
        "regionMonitoringAvailable": p.regionMonitoringAvailable,
      ],
    ]
  }

  // MARK: - DeviceSensors (union)

  /// DeviceSensors → wire. `motionQuality` shared; the iOS half namespaced. The Android half is
  /// absent (not `false`) — "no pedometer" and "we cannot tell" are different facts.
  static func sensorsDict(_ s: DeviceSensors) -> [String: Any] {
    return [
      "motionQuality": s.motionQuality.rawValue,
      "ios": [
        "activityRecognition": s.activityRecognition,
        "stepCounting": s.stepCounting,
        "significantLocationChange": s.significantLocationChange,
        "regionMonitoring": s.regionMonitoring,
      ],
    ]
  }

  // MARK: - TrackFix (getCurrentLocation)

  /// TrackFix → wire. iOS field names already match the wire (`accuracyM`, `monotonicNanos`,
  /// `altitudeM`, `verticalAccuracyM`). No `android.satelliteCount` — that is Android-only.
  static func trackFixDict(_ f: TrackFix) -> [String: Any] {
    var d: [String: Any] = [
      "timeMs": f.timeMs,
      "monotonicNanos": f.monotonicNanos,
      "receivedAtMonotonicNanos": f.receivedAtMonotonicNanos,
      "latitude": f.latitude,
      "longitude": f.longitude,
      "accuracyM": f.accuracyM,
      "speedMps": f.speedMps,
      "bearingDeg": f.bearingDeg,
      "hasSpeed": f.hasSpeed,
      "hasBearing": f.hasBearing,
      "provider": f.provider,
      "isMock": f.isMock,
    ]
    if let v = f.altitudeM { d["altitudeM"] = v }
    if let v = f.verticalAccuracyM { d["verticalAccuracyM"] = v }
    if let v = f.speedAccuracyMps { d["speedAccuracyMps"] = v }
    if let v = f.bearingAccuracyDeg { d["bearingAccuracyDeg"] = v }
    return d
  }

  // MARK: - TrackPoint (getPoints — JSON string)

  /// TrackPoint → wire. `sessionID` → `sessionId`. `isMock`/`isCharging`/`isSignificantStop`
  /// are iOS-only and namespaced under `ios`. `odometerM` already matches the wire.
  static func trackPointDict(_ p: TrackPoint) -> [String: Any] {
    var d: [String: Any] = [
      "id": p.id,
      "uuid": p.uuid,
      "sessionId": p.sessionID,
      "timeMs": p.timeMs,
      "monotonicNanos": p.monotonicNanos,
      "localDate": p.localDate,
      "timezone": p.timezone,
      "latitude": p.latitude,
      "longitude": p.longitude,
      "accuracyM": p.accuracyM,
      "speedMps": p.speedMps,
      "bearingDeg": p.bearingDeg,
      "hasSpeed": p.hasSpeed,
      "hasBearing": p.hasBearing,
      "provider": p.provider,
      "movementStatus": p.movementStatus.rawValue,
      "activityStartTimeMs": p.activityStartTimeMs,
      "odometerM": p.odometerM,
      "acceptReason": p.acceptReason,
    ]
    if let v = p.altitudeM { d["altitudeM"] = v }
    if let a = p.detectedActivity { d["detectedActivity"] = a.rawValue }
    if let v = p.batteryPct { d["batteryPct"] = v }
    if let v = p.extras { d["extras"] = v }
    var ios: [String: Any] = [
      "isMock": p.isMock,
      "isSignificantStop": p.isSignificantStop,
    ]
    if let v = p.isCharging { ios["isCharging"] = v }
    d["ios"] = ios
    return d
  }

  // MARK: - TrackSession (getSessions / currentSession)

  /// TrackSession → wire. All iOS names match the wire; `isOpen` is a computed property. No
  /// `android.startedAtElapsedNanos` on iOS.
  static func sessionDict(_ s: TrackSession) -> [String: Any] {
    var d: [String: Any] = [
      "id": s.id,
      "startedAtMs": s.startedAtMs,
      "isOpen": s.isOpen,
    ]
    if let v = s.endedAtMs { d["endedAtMs"] = v }
    if let v = s.tag { d["tag"] = v }
    if let v = s.configSnapshot { d["configSnapshot"] = v }
    return d
  }

  // MARK: - RawFix (getRawFixes — JSON string)

  /// RawFix → wire. iOS carries the full fix; the wire superset keeps only the shared six flat and
  /// namespaces the iOS-rich remainder under `ios` (`sessionID` → `sessionId`).
  static func rawFixDict(_ f: RawFix) -> [String: Any] {
    var ios: [String: Any] = [
      "id": f.id,
      "sessionId": f.sessionID,
      "monotonicNanos": f.monotonicNanos,
      "receivedAtMonotonicNanos": f.receivedAtMonotonicNanos,
      "speedMps": f.speedMps,
      "hasSpeed": f.hasSpeed,
      "hasBearing": f.hasBearing,
      "isMock": f.isMock,
    ]
    if let v = f.altitudeM { ios["altitudeM"] = v }
    if let v = f.verticalAccuracyM { ios["verticalAccuracyM"] = v }
    if let v = f.speedAccuracyMps { ios["speedAccuracyMps"] = v }
    if let v = f.bearingAccuracyDeg { ios["bearingAccuracyDeg"] = v }
    return [
      "timeMs": f.timeMs,
      "latitude": f.latitude,
      "longitude": f.longitude,
      "accuracyM": f.accuracyM,
      "bearingDeg": f.bearingDeg,
      "provider": f.provider,
      "ios": ios,
    ]
  }

  // MARK: - RawPoint (getRawPoints — JSON string)

  /// RawPoint → wire. Shared nine flat (`sessionID` → `sessionId`); the iOS filter/motion detail
  /// under `ios` (`filterLatitude`/`filterLongitude` are the iOS wire names). No `android` half.
  static func rawPointDict(_ p: RawPoint) -> [String: Any] {
    return [
      "uuid": p.uuid,
      "sessionId": p.sessionID,
      "timeMs": p.timeMs,
      "latitude": p.latitude,
      "longitude": p.longitude,
      "accuracyM": p.accuracyM,
      "verdict": p.verdict,
      "reason": p.reason,
      "isAccepted": p.isAccepted,
      "ios": [
        "id": p.id,
        "monotonicNanos": p.monotonicNanos,
        "filterLatitude": p.filterLatitude,
        "filterLongitude": p.filterLongitude,
        "motionState": p.motionState.rawValue,
      ],
    ]
  }

  // MARK: - FixDecision (getDecisions — JSON string)

  /// FixDecision → wire. iOS `verdict` is the `Verdict` enum → the accept/skip/reject label;
  /// `reason` is the computed associated string. `filterLatitude`/`filterLongitude` are iOS names.
  static func fixDecisionDict(_ d: FixDecision) -> [String: Any] {
    let verdict: String
    switch d.verdict {
    case .accept: verdict = "accept"
    case .skip: verdict = "skip"
    case .reject: verdict = "reject"
    }
    return [
      "verdict": verdict,
      "reason": d.reason,
      "filterLatitude": d.filterLatitude,
      "filterLongitude": d.filterLongitude,
      "sigma": d.sigma,
      "threshold": d.threshold,
      "distanceMovedM": d.distanceMovedM,
      "effectiveSpeedMps": d.effectiveSpeedMps,
      "motionState": d.motionState.rawValue,
    ]
  }

  // MARK: - Track tree (JSON string)

  /// Drop-in serializer for buildTrack: maps the native `Track` object to the wire dict and
  /// encodes it as the wire JSON string. Throws on an encode fault (bridge fault → the module
  /// rejects the Promise).
  static func trackJSON(_ t: Track) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: trackDict(t), options: [])
    return String(decoding: data, as: UTF8.self)
  }

  /// Track → wire dict. `sessionID` → `sessionId` (optional). `precision` is carried so the
  /// JS decoder reads the real value (default 6, not 5).
  static func trackDict(_ t: Track) -> [String: Any] {
    var d: [String: Any] = [
      "version": t.version,
      "generatedAtMs": t.generatedAtMs,
      "from": t.from,
      "to": t.to,
      "timezone": t.timezone,
      "precision": t.precision,
      "stats": trackStatsDict(t.stats),
      "encodedPolyline": t.encodedPolyline,
      "points": t.points.map { trackJSONPointDict($0) },
      "segments": t.segments.map { trackSegmentDict($0) },
      "stops": t.stops.map { stopNodeDict($0) },
      "arrows": t.arrows.map { arrowAnchorDict($0) },
      "warnings": t.warnings,
    ]
    if let sid = t.sessionID { d["sessionId"] = sid }
    if let b = t.bounds { d["bounds"] = boundsDict(b) }
    return d
  }

  /// TrackStats → wire. iOS `totalDistanceMeters`/`totalDurationSec` → wire
  /// `distanceMeters`/`durationSec`. iOS does not carry the Android-only speed/count block.
  static func trackStatsDict(_ s: TrackStats) -> [String: Any] {
    return [
      "distanceMeters": s.totalDistanceMeters,
      "durationSec": s.totalDurationSec,
      "movingDurationSec": s.movingDurationSec,
      "stoppedDurationSec": s.stoppedDurationSec,
      "activityBreakdownSec": s.activityBreakdownSec.mapValues { $0 as Any },
    ]
  }

  /// TrackJSONPoint (iOS 7 keys) → wire. No `android` short-key block on iOS.
  static func trackJSONPointDict(_ p: TrackJSONPoint) -> [String: Any] {
    var d: [String: Any] = [
      "timeMs": p.timeMs,
      "latitude": p.latitude,
      "longitude": p.longitude,
      "accuracyM": p.accuracyM,
      "speedMps": p.speedMps,
      "bearingDeg": p.bearingDeg,
    ]
    if let a = p.activity { d["activity"] = a }
    return d
  }

  /// TrackSegment → wire. `type.rawValue` is already lower camel; `travelStartMs` is iOS-only
  /// and namespaced under `ios`.
  static func trackSegmentDict(_ s: TrackSegment) -> [String: Any] {
    var d: [String: Any] = [
      "from": s.from,
      "to": s.to,
      "type": s.type.rawValue,
      "startMs": s.startMs,
      "endMs": s.endMs,
      "distanceMeters": s.distanceMeters,
      "durationSec": s.durationSec,
      "avgSpeedMps": s.avgSpeedMps,
      "maxSpeedMps": s.maxSpeedMps,
      "p75SpeedMps": s.p75SpeedMps,
      "encodedPolyline": s.encodedPolyline,
      "ios": ["travelStartMs": s.travelStartMs],
    ]
    if let a = s.activity { d["activity"] = a }
    if let a = s.activityIcon { d["activityIcon"] = a }
    if let a = s.speedBand { d["speedBand"] = a }
    if let i = s.stopIndex { d["stopIndex"] = i }
    return d
  }

  /// StopNode → wire. iOS already uses `latitude`/`longitude` (Android uses `lat`/`lng`).
  static func stopNodeDict(_ s: StopNode) -> [String: Any] {
    var d: [String: Any] = [
      "index": s.index,
      "latitude": s.latitude,
      "longitude": s.longitude,
      "arrivalMs": s.arrivalMs,
      "dwellSec": s.dwellSec,
      "radiusM": s.radiusM,
      "pointCount": s.pointCount,
      "isOngoing": s.isOngoing,
    ]
    if let v = s.departureMs { d["departureMs"] = v }
    if let v = s.address { d["address"] = v }
    return d
  }

  /// ArrowAnchor → wire. iOS already uses `latitude`/`longitude` (Android uses `lat`/`lng`).
  static func arrowAnchorDict(_ a: ArrowAnchor) -> [String: Any] {
    return [
      "latitude": a.latitude,
      "longitude": a.longitude,
      "bearing": a.bearing,
      "segment": a.segment,
    ]
  }

  /// Bounds → wire. Both platforms are `north/south/east/west`.
  static func boundsDict(_ b: Bounds) -> [String: Any] {
    return [
      "north": b.north,
      "south": b.south,
      "east": b.east,
      "west": b.west,
    ]
  }

  // MARK: - Geofencing

  /// Geofence → wire. iOS carries notifyOnEntry/Exit and the optional dwellAfterMs; no
  /// `android.onEnterEvent/onExitEvent` on iOS.
  static func geofenceDict(_ g: Geofence) -> [String: Any] {
    var d: [String: Any] = [
      "id": g.id,
      "latitude": g.latitude,
      "longitude": g.longitude,
      "radiusM": g.radiusM,
      "notifyOnEntry": g.notifyOnEntry,
      "notifyOnExit": g.notifyOnExit,
    ]
    if let dwell = g.dwellAfterMs { d["dwellAfterMs"] = dwell }
    return d
  }

  /// Wire geofence → native iOS Geofence. Returns nil on a missing required field (the module
  /// rejects invalidConfig). notify flags default true; dwellAfterMs is iOS-native so it passes.
  static func geofenceFromWire(_ w: NSDictionary) -> Geofence? {
    guard let id = w["id"] as? String,
          let lat = (w["latitude"] as? NSNumber)?.doubleValue,
          let lon = (w["longitude"] as? NSNumber)?.doubleValue,
          let radius = (w["radiusM"] as? NSNumber)?.doubleValue else { return nil }
    let notifyEntry = (w["notifyOnEntry"] as? NSNumber)?.boolValue ?? true
    let notifyExit = (w["notifyOnExit"] as? NSNumber)?.boolValue ?? true
    let dwell = (w["dwellAfterMs"] as? NSNumber)?.int64Value
    return Geofence(id: id, latitude: lat, longitude: lon, radiusM: radius,
                    notifyOnEntry: notifyEntry, notifyOnExit: notifyExit, dwellAfterMs: dwell)
  }

  /// GeofenceEvent → wire GeofenceCrossing. On iOS every field is present (getEvents() is fully
  /// populated); transition.rawValue is already the wire vocabulary (enter/exit/dwell).
  static func crossingDict(_ e: GeofenceEvent) -> [String: Any] {
    return [
      "geofenceId": e.geofenceID,
      "transition": e.transition.rawValue,
      "timeMs": e.timeMs,
      "latitude": e.latitude,
      "longitude": e.longitude,
      "radiusM": e.radiusM,
    ]
  }

// ══ Phase 4 subscription layer — append these inside `enum TrackerMappers` ═════════════
// Reuses the existing element mappers (trackPointDict / fixDecisionDict / providerStateDict /
// sessionDict / crossingDict). No new imports needed (TrackerCore + TrackerGeo already imported).

  // MARK: - TrackerEvent (the 16-case union; iOS emits 14 of them)

  /// TrackerEvent → wire discriminated union { type, ...payload }. iOS has NO geofenceAdded /
  /// geofenceRemoved (Android-only); it DOES emit geofenceDwell. iOS `ErrorCode` is String-backed and
  /// its rawValue is already the wire vocabulary (case `internalError` → "internalError"), so no
  /// rename is required here — unlike Android, where `INTERNAL` is remapped in `errorCodeWire`.
  static func eventDict(_ e: TrackerEvent) -> [String: Any] {
    switch e {
    case .location(let p):
      return ["type": "location", "point": trackPointDict(p)]
    case .locationRejected(let d):
      return ["type": "locationRejected", "decision": fixDecisionDict(d)]
    case .motionChange(let state, let point):
      return ["type": "motionChange",
              "state": state.rawValue,
              "point": point.map { trackPointDict($0) } ?? NSNull()]
    case .activityChange(let activity, let confidence):
      return ["type": "activityChange", "activity": activity.rawValue, "confidence": confidence]
    case .enabledChange(let enabled):
      return ["type": "enabledChange", "enabled": enabled]
    case .providerChange(let state):
      return ["type": "providerChange", "state": providerStateDict(state)]
    case .heartbeat(let atMs):
      return ["type": "heartbeat", "atMs": atMs]
    case .powerSaveChange(let enabled):
      return ["type": "powerSaveChange", "enabled": enabled]
    case .sessionInterrupted(let session):
      return ["type": "sessionInterrupted", "session": sessionDict(session)]
    case .diagnostic(let message):
      return ["type": "diagnostic", "message": message]
    case .error(let code, let message):
      return ["type": "error", "code": code.rawValue, "message": message]
    case .geofenceEnter(let ev):
      return ["type": "geofenceEnter", "crossing": crossingDict(ev)]
    case .geofenceExit(let ev):
      return ["type": "geofenceExit", "crossing": crossingDict(ev)]
    case .geofenceDwell(let ev):
      return ["type": "geofenceDwell", "crossing": crossingDict(ev)]
    }
  }

  // MARK: - LiveTrackUpdate / PuckState (onLiveTrack)

  /// LiveTrackUpdate → wire. `sessionID` → `sessionId`. `liveHead` is the unsettled head as
  /// GeoPoints; `frozenTailPolyline` stays an encoded polyline (never decoded here).
  static func liveTrackDict(_ u: LiveTrackUpdate) -> [String: Any] {
    var d: [String: Any] = [
      "sessionId": u.sessionID,
      "sequence": u.sequence,
      "precision": u.precision,
      "frozenTailPolyline": u.frozenTailPolyline,
      "liveHead": u.liveHead.map { ["latitude": $0.latitude, "longitude": $0.longitude] },
    ]
    if let puck = u.puck { d["puck"] = puckDict(puck) }
    return d
  }

  /// PuckState → wire. `headingDeg` is optional (frozen/absent at low speed, per PuckAnimation).
  static func puckDict(_ p: PuckState) -> [String: Any] {
    var d: [String: Any] = [
      "latitude": p.latitude,
      "longitude": p.longitude,
      "speedMps": p.speedMps,
      "accuracyM": p.accuracyM,
    ]
    if let h = p.headingDeg { d["headingDeg"] = h }
    return d
  }
}

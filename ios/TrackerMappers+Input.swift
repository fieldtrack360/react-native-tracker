import Foundation
import TrackerCore
import TrackerGeo

// Input mappers — the wire → SDK direction. The output half lives in
// TrackerMappers.swift; this file holds the three shapes the host sends DOWN plus the error-code
// stringifier that every result envelope needs.
//
// Conventions:
//  - A nil dictionary means JS omitted the argument → the SDK defaults (PointQuery() /
//    TrackOptions()) are returned untouched. A present-but-partial dictionary overrides only the
//    keys it carries; an absent key is never written, so an SDK default is never clobbered by a
//    zero.
//  - `decodeConfig` throws on JSON that will not parse; a throw is a BRIDGE fault and rejects the
//    Promise with `invalidConfig`, so it never silently degrades to defaults.
//  - Unit conversions: the wire carries milliseconds, iOS stores whole Int seconds, so
//    wire→iOS rounds UP with a floor of 1 second — a sub-second value must not become "no delay".
extension TrackerMappers {

  // MARK: - Error vocabulary

  /// error code — the SDK enum is already the lower-camel wire vocabulary.
  static func errorCode(_ code: ErrorCode) -> String {
    return code.rawValue
  }

  // MARK: - PointQuery

  /// Wire `PointQuery` → SDK `PointQuery`. Only `sessionId` is renamed (wire) → `sessionID` (SDK).
  static func pointQuery(_ dict: NSDictionary?) -> PointQuery {
    var query = PointQuery()
    guard let dict else {
      return query
    }
    if let sessionID = dict["sessionId"] as? String {
      query.sessionID = sessionID
    }
    if let fromMs = dict["fromMs"] as? NSNumber {
      query.fromMs = fromMs.int64Value
    }
    if let toMs = dict["toMs"] as? NSNumber {
      query.toMs = toMs.int64Value
    }
    if let limit = dict["limit"] as? NSNumber {
      query.limit = limit.intValue
    }
    if let offset = dict["offset"] as? NSNumber {
      query.offset = offset.intValue
    }
    return query
  }

  // MARK: - TrackOptions

  /// Wire `TrackOptions` → SDK `TrackOptions`. Field-for-field; only `smoothing` is an enum, and
  /// `Smoothing` carries no raw value, so it is switched by hand.
  static func trackOptions(_ dict: NSDictionary?) -> TrackOptions {
    var options = TrackOptions()
    guard let dict else {
      return options
    }
    if let zoom = dict["zoom"] as? NSNumber {
      options.zoom = zoom.floatValue
    }
    if let includeRawPoints = dict["includeRawPoints"] as? NSNumber {
      options.includeRawPoints = includeRawPoints.boolValue
    }
    if let consolidateStops = dict["consolidateStops"] as? NSNumber {
      options.consolidateStops = consolidateStops.boolValue
    }
    if let stopRadiusM = dict["stopRadiusM"] as? NSNumber {
      options.stopRadiusM = stopRadiusM.doubleValue
    }
    if let stopMinDwellSec = dict["stopMinDwellSec"] as? NSNumber {
      options.stopMinDwellSec = stopMinDwellSec.int64Value
    }
    if let smoothing = dict["smoothing"] as? String, let value = self.smoothing(smoothing) {
      options.smoothing = value
    }
    if let splineSpacingM = dict["splineSpacingM"] as? NSNumber {
      options.splineSpacingM = splineSpacingM.doubleValue
    }
    if let bezierMinAngleDeg = dict["bezierMinAngleDeg"] as? NSNumber {
      options.bezierMinAngleDeg = bezierMinAngleDeg.doubleValue
    }
    if let bezierCutbackM = dict["bezierCutbackM"] as? NSNumber {
      options.bezierCutbackM = bezierCutbackM.doubleValue
    }
    if let snapToRoad = dict["snapToRoad"] as? NSNumber {
      options.snapToRoad = snapToRoad.boolValue
    }
    if let snapMaxOffRoadM = dict["snapMaxOffRoadM"] as? NSNumber {
      options.snapMaxOffRoadM = snapMaxOffRoadM.doubleValue
    }
    if let polylinePrecision = dict["polylinePrecision"] as? NSNumber {
      options.polylinePrecision = polylinePrecision.intValue
    }
    if let bands = dict["speedBandsKmph"] as? [NSNumber] {
      options.speedBandsKmph = bands.map { $0.floatValue }
    }
    if let arrowMinSegmentM = dict["arrowMinSegmentM"] as? NSNumber {
      options.arrowMinSegmentM = arrowMinSegmentM.doubleValue
    }
    if let simplifyEpsilonM = dict["simplifyEpsilonM"] as? NSNumber {
      options.simplifyEpsilonM = simplifyEpsilonM.doubleValue
    }
    return options
  }

  /// smoothing — wire vocabulary → SDK case. Unknown values leave the SDK default in place.
  private static func smoothing(_ value: String) -> Smoothing? {
    switch value {
    case "none": return Smoothing.none
    case "spline": return .spline
    case "bezier": return .bezier
    default: return nil
    }
  }

  // MARK: - TrackerConfig

  /// Wire config JSON string → SDK `TrackerConfig`. The wire shape is FLAT for the fields both
  /// platforms share and namespaced under `ios` / `android` for the rest; the SDK shape
  /// is five nested blocks, and three shared fields live in a different block on each platform
  /// (`persistHeartbeat` is wire-`motion` / iOS-`persistence`; `activityRecognitionIntervalMs` is
  /// wire-`motion` / iOS-`sensors`). Every rename and re-homing is applied here.
  ///
  /// Throws when the payload is not a JSON object — a bridge fault, not a domain failure.
  static func decodeConfig(_ json: String) throws -> TrackerConfig {
    guard let data = json.data(using: .utf8) else {
      throw ConfigDecodeError.notUTF8
    }
    guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw ConfigDecodeError.notAnObject
    }

    var config = TrackerConfig()
    let ios = root["ios"] as? [String: Any] ?? [:]

    // ── top level ────────────────────────────────────────────────────────────
    // Blank == absent, matching the Android mapper key-for-key: a `.env` with an empty
    // TRACKER_LICENSE must surface as licenseMissing, not as a malformed token.
    if let license = root["license"] as? String {
      let trimmed = license.trimmingCharacters(in: .whitespacesAndNewlines)
      if !trimmed.isEmpty {
        config.license = trimmed
      }
    }
    if let reset = root["reset"] as? NSNumber {
      config.reset = reset.boolValue
    }

    // ── geolocation (wire: flat) ─────────────────────────────────────────────
    if let mode = root["trackingMode"] as? String, let value = TrackingMode(rawValue: mode) {
      config.geolocation.trackingMode = value
    }
    if let accuracy = root["desiredAccuracy"] as? String, let value = DesiredAccuracy(rawValue: accuracy) {
      config.geolocation.desiredAccuracy = value
    }
    if let accuracy = root["accuracy"] as? [String: Any] {
      if let profile = accuracy["profile"] as? String, let value = AccuracyProfile(rawValue: profile) {
        config.geolocation.accuracy.profile = value
      }
      if let maxAccuracyMeters = accuracy["maxAccuracyMeters"] as? NSNumber {
        config.geolocation.accuracy.maxAccuracyMeters = maxAccuracyMeters.floatValue
      }
      if let recoveryTrustMeters = accuracy["recoveryTrustMeters"] as? NSNumber {
        config.geolocation.accuracy.recoveryTrustMeters = recoveryTrustMeters.floatValue
      }
    }
    if let intervalMs = root["intervalMs"] as? NSNumber {
      config.geolocation.intervalMs = intervalMs.int64Value
    }
    if let vehicularIntervalMs = root["vehicularIntervalMs"] as? NSNumber {
      config.geolocation.vehicularIntervalMs = vehicularIntervalMs.int64Value
    }
    if let adaptiveCadence = root["adaptiveCadence"] as? NSNumber {
      config.geolocation.adaptiveCadence = adaptiveCadence.boolValue
    }
    if let turnBurst = root["turnBurst"] as? NSNumber {
      config.geolocation.turnBurst = turnBurst.boolValue
    }
    if let turnBurstIntervalMs = root["turnBurstIntervalMs"] as? NSNumber {
      config.geolocation.turnBurstIntervalMs = turnBurstIntervalMs.int64Value
    }
    if let navigationMode = root["navigationMode"] as? NSNumber {
      config.geolocation.navigationMode = navigationMode.boolValue
    }
    if let navigationIntervalMs = root["navigationIntervalMs"] as? NSNumber {
      config.geolocation.navigationIntervalMs = navigationIntervalMs.int64Value
    }
    if let oneShotTimeoutMs = root["oneShotTimeoutMs"] as? NSNumber {
      config.geolocation.oneShotTimeoutMs = oneShotTimeoutMs.int64Value
    }
    if let deliveryStalenessMs = root["deliveryStalenessMs"] as? NSNumber {
      config.geolocation.deliveryStalenessMs = deliveryStalenessMs.int64Value
    }
    if let policy = root["mockLocationPolicy"] as? String, let value = MockPolicy(rawValue: policy) {
      config.geolocation.mockLocationPolicy = value
    }

    // ── motion (wire: flat, plus ios.stillConfidenceMin) ─────────────────────
    if let activityRecognition = root["activityRecognition"] as? NSNumber {
      config.motion.activityRecognition = activityRecognition.boolValue
    }
    if let activityConfidenceMin = root["activityConfidenceMin"] as? NSNumber {
      config.motion.activityConfidenceMin = activityConfidenceMin.intValue
    }
    if let snapshotConfidenceMin = root["snapshotConfidenceMin"] as? NSNumber {
      config.motion.snapshotConfidenceMin = snapshotConfidenceMin.intValue
    }
    if let stopTimeoutMin = root["stopTimeoutMin"] as? NSNumber {
      config.motion.stopTimeoutMin = stopTimeoutMin.intValue
    }
    if let stationaryRadiusM = root["stationaryRadiusM"] as? NSNumber {
      config.motion.stationaryRadiusM = stationaryRadiusM.doubleValue
    }
    // — ms → whole seconds, rounded UP, floored at 1 (0 stays 0: "no delay").
    if let motionTriggerDelayMs = root["motionTriggerDelayMs"] as? NSNumber {
      config.motion.motionTriggerDelaySec = self.msToSecRoundingUp(motionTriggerDelayMs.int64Value)
    }
    if let heartbeatIntervalSec = root["heartbeatIntervalSec"] as? NSNumber {
      config.motion.heartbeatIntervalSec = heartbeatIntervalSec.intValue
    }
    if let bearingChangeCaptureDeg = root["bearingChangeCaptureDeg"] as? NSNumber {
      config.motion.bearingChangeCaptureDeg = bearingChangeCaptureDeg.intValue
    }
    if let stopOnStationary = root["stopOnStationary"] as? NSNumber {
      config.motion.stopOnStationary = stopOnStationary.boolValue
    }
    if let disableStopDetection = root["disableStopDetection"] as? NSNumber {
      config.motion.disableStopDetection = disableStopDetection.boolValue
    }
    if let stillConfidenceMin = ios["stillConfidenceMin"] as? NSNumber {
      config.motion.stillConfidenceMin = stillConfidenceMin.intValue
    }

    // ── persistence (wire: flat; persistHeartbeat arrives in the wire motion block) ──
    if let maxDaysToPersist = root["maxDaysToPersist"] as? NSNumber {
      config.persistence.maxDaysToPersist = maxDaysToPersist.intValue
    }
    if let persistRawFixes = root["persistRawFixes"] as? NSNumber {
      config.persistence.persistRawFixes = persistRawFixes.boolValue
    }
    if let rawFixRingCapacity = root["rawFixRingCapacity"] as? NSNumber {
      config.persistence.rawFixRingCapacity = rawFixRingCapacity.intValue
    }
    if let persistRawPoints = root["persistRawPoints"] as? NSNumber {
      config.persistence.persistRawPoints = persistRawPoints.boolValue
    }
    if let rawPointRingCapacity = root["rawPointRingCapacity"] as? NSNumber {
      config.persistence.rawPointRingCapacity = rawPointRingCapacity.intValue
    }
    if let persistDecisions = root["persistDecisions"] as? NSNumber {
      config.persistence.persistDecisions = persistDecisions.boolValue
    }
    if let decisionRetentionDays = root["decisionRetentionDays"] as? NSNumber {
      config.persistence.decisionRetentionDays = decisionRetentionDays.intValue
    }
    if let decisionMaxRows = root["decisionMaxRows"] as? NSNumber {
      config.persistence.decisionMaxRows = decisionMaxRows.intValue
    }
    if let persistHeartbeat = root["persistHeartbeat"] as? NSNumber {
      config.persistence.persistHeartbeat = persistHeartbeat.boolValue
    }

    // ── sensors (wire: flat, plus the two iOS-only toggles) ──────────────────
    if let useStepCorroboration = root["useStepCorroboration"] as? NSNumber {
      config.sensors.useStepCorroboration = useStepCorroboration.boolValue
    }
    if let useAccelerometerVeto = root["useAccelerometerVeto"] as? NSNumber {
      config.sensors.useAccelerometerVeto = useAccelerometerVeto.boolValue
    }
    if let useBarometer = root["useBarometer"] as? NSNumber {
      config.sensors.useBarometer = useBarometer.boolValue
    }
    if let activityRecognitionIntervalMs = root["activityRecognitionIntervalMs"] as? NSNumber {
      config.sensors.activityRecognitionIntervalMs = activityRecognitionIntervalMs.int64Value
    }
    if let useSignificantLocationChange = ios["useSignificantLocationChange"] as? NSNumber {
      config.sensors.useSignificantLocationChange = useSignificantLocationChange.boolValue
    }
    if let useStationaryFence = ios["useStationaryFence"] as? NSNumber {
      config.sensors.useStationaryFence = useStationaryFence.boolValue
    }

    // ── service (wire: flat, plus ios.backgroundLocationIndicator) ───────────
    // — healthLoopMs is the wire unit; iOS stores whole seconds.
    if let healthLoopMs = root["healthLoopMs"] as? NSNumber {
      config.service.healthLoopSec = self.msToSecRoundingUp(healthLoopMs.int64Value)
    }
    if let backstopIntervalMin = root["backstopIntervalMin"] as? NSNumber {
      config.service.backstopIntervalMin = backstopIntervalMin.intValue
    }
    if let deadTrackerMovingMin = root["deadTrackerMovingMin"] as? NSNumber {
      config.service.deadTrackerMovingMin = deadTrackerMovingMin.intValue
    }
    if let deadTrackerStationaryMin = root["deadTrackerStationaryMin"] as? NSNumber {
      config.service.deadTrackerStationaryMin = deadTrackerStationaryMin.intValue
    }
    if let backgroundLocationIndicator = ios["backgroundLocationIndicator"] as? NSNumber {
      config.service.backgroundLocationIndicator = backgroundLocationIndicator.boolValue
    }

    // `android` is ignored here by design — the namespace exists so the host never branches on
    // Platform.OS; the other platform's block is dead weight on this one.
    return config
  }

  /// — ms → whole seconds, rounded up so a sub-second value never collapses to zero.
  private static func msToSecRoundingUp(_ ms: Int64) -> Int {
    if ms <= 0 {
      return 0
    }
    return Int((ms + 999) / 1000)
  }

  enum ConfigDecodeError: Error {
    case notUTF8
    case notAnObject
  }
}

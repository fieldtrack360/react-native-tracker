package com.fieldtrack360.tracker

import com.field360.tracker.AccuracyProfile
import com.field360.tracker.DesiredAccuracy
import com.field360.tracker.LocationProviderType
import com.field360.tracker.TrackerConfig
import com.field360.tracker.TrackingMode
import com.field360.tracker.integrity.IntegrityPolicy
import com.field360.tracker.domain.model.PointQuery
import com.field360.traker.geo.model.MockPolicy
import com.field360.traker.geo.plot.model.Smoothing
import com.field360.traker.geo.plot.model.TrackOptions
import com.facebook.react.bridge.ReadableMap
import org.json.JSONObject

// Input mappers — the wire → SDK direction. The output half lives in
// TrackerMappers.kt; this file holds the three shapes the host sends DOWN. It is the Android twin of
// ios/TrackerMappers+Input.swift, and the two must agree key-for-key: the whole point of the wire
// contract is that a host writes one config and both platforms read the same fields.
//
// Conventions:
//  - A null map means JS omitted the argument → the SDK defaults (PointQuery() / TrackOptions())
//    are returned untouched. A present-but-partial map overrides only the keys it carries; an
//    absent key is never written, so an SDK default is never clobbered by a zero.
//  - `decodeConfig` throws on JSON that will not parse; a throw is a BRIDGE fault and rejects the
//    Promise with `invalidConfig`, so it never silently degrades to defaults.
//  - Enum values cross in the wire vocabulary (lower camel) and are matched against the SDK's
//    SCREAMING_SNAKE constants here — the inverse of TrackerMappers.screamingSnakeToLowerCamel.
//    An unrecognised value leaves the SDK default in place rather than guessing.

// MARK: - PointQuery

/// Wire `PointQuery` → SDK `PointQuery`. Field names are identical on both sides.
fun TrackerMappers.pointQuery(map: ReadableMap?): PointQuery {
  var query = PointQuery()
  if (map == null) {
    return query
  }
  if (map.hasKey("sessionId")) {
    query = query.copy(sessionId = map.getString("sessionId"))
  }
  if (map.hasKey("fromMs")) {
    query = query.copy(fromMs = map.getDouble("fromMs").toLong())
  }
  if (map.hasKey("toMs")) {
    query = query.copy(toMs = map.getDouble("toMs").toLong())
  }
  if (map.hasKey("limit")) {
    query = query.copy(limit = map.getInt("limit"))
  }
  if (map.hasKey("offset")) {
    query = query.copy(offset = map.getInt("offset"))
  }
  return query
}

// MARK: - TrackOptions

/// Wire `TrackOptions` → SDK `TrackOptions`. Field-for-field; only `smoothing` is an enum.
fun TrackerMappers.trackOptions(map: ReadableMap?): TrackOptions {
  var options = TrackOptions()
  if (map == null) {
    return options
  }
  if (map.hasKey("zoom")) {
    options = options.copy(zoom = map.getDouble("zoom").toFloat())
  }
  if (map.hasKey("includeRawPoints")) {
    options = options.copy(includeRawPoints = map.getBoolean("includeRawPoints"))
  }
  if (map.hasKey("consolidateStops")) {
    options = options.copy(consolidateStops = map.getBoolean("consolidateStops"))
  }
  if (map.hasKey("stopRadiusM")) {
    options = options.copy(stopRadiusM = map.getDouble("stopRadiusM"))
  }
  if (map.hasKey("stopMinDwellSec")) {
    options = options.copy(stopMinDwellSec = map.getDouble("stopMinDwellSec").toLong())
  }
  if (map.hasKey("smoothing")) {
    smoothing(map.getString("smoothing"))?.let { options = options.copy(smoothing = it) }
  }
  if (map.hasKey("splineSpacingM")) {
    options = options.copy(splineSpacingM = map.getDouble("splineSpacingM"))
  }
  if (map.hasKey("bezierMinAngleDeg")) {
    options = options.copy(bezierMinAngleDeg = map.getDouble("bezierMinAngleDeg"))
  }
  if (map.hasKey("bezierCutbackM")) {
    options = options.copy(bezierCutbackM = map.getDouble("bezierCutbackM"))
  }
  if (map.hasKey("snapToRoad")) {
    options = options.copy(snapToRoad = map.getBoolean("snapToRoad"))
  }
  if (map.hasKey("snapMaxOffRoadM")) {
    options = options.copy(snapMaxOffRoadM = map.getDouble("snapMaxOffRoadM"))
  }
  if (map.hasKey("polylinePrecision")) {
    options = options.copy(polylinePrecision = map.getInt("polylinePrecision"))
  }
  if (map.hasKey("speedBandsKmph")) {
    val bands = map.getArray("speedBandsKmph")
    if (bands != null) {
      options = options.copy(
        speedBandsKmph = (0 until bands.size()).map { bands.getDouble(it).toFloat() }
      )
    }
  }
  if (map.hasKey("arrowMinSegmentM")) {
    options = options.copy(arrowMinSegmentM = map.getDouble("arrowMinSegmentM"))
  }
  if (map.hasKey("simplifyEpsilonM")) {
    options = options.copy(simplifyEpsilonM = map.getDouble("simplifyEpsilonM"))
  }
  return options
}

private fun smoothing(value: String?): Smoothing? = when (value) {
  "none" -> Smoothing.NONE
  "spline" -> Smoothing.SPLINE
  "bezier" -> Smoothing.BEZIER
  else -> null
}

// MARK: - TrackerConfig

/// Wire config JSON string → SDK `TrackerConfig`.
///
/// The wire shape is FLAT for the fields both platforms share and namespaced under `ios` / `android`
/// for the rest; the SDK shape is five nested blocks. Every rename and re-homing is
/// applied here:
///   - `rawFixRingCapacity` (wire) → `rawRingCapacity` (Android)
///   - `persistHeartbeat` and `activityRecognitionIntervalMs` live in the wire `motion` group and in
///     Android's `motion` block (on iOS they sit in `persistence` / `sensors` — same wire key, two
///     different homes, which is exactly why this mapping is not shared code)
///   - `motionTriggerDelayMs` / `healthLoopMs` need no unit conversion here: Android stores
///     milliseconds, iOS stores whole seconds and converts.
///
/// Throws when the payload is not a JSON object — a bridge fault, not a domain failure.
fun TrackerMappers.decodeConfig(json: String): TrackerConfig {
  val root = JSONObject(json)
  val ios = root.optJSONObject("ios")
  val android = root.optJSONObject("android")

  var config = TrackerConfig()

  // ── top level ────────────────────────────────────────────────────────────
  if (root.has("license")) {
    val license = root.optString("license").trim()
    if (license.isNotEmpty()) {
      config = config.copy(license = license)
    }
  }
  if (root.has("reset")) {
    config = config.copy(reset = root.optBoolean("reset"))
  }
  // android.baseUrl — Android-only (iOS TrackerConfig has no counterpart), so it is namespaced on
  // the wire even though it sits at the TOP level of the native config. Core never opens a socket;
  // this exists solely so a relative SyncConfig.url resolves against it. An empty string would fail
  // validate() ("not an absolute URL"), so a blank is treated as absent.
  android?.let { block ->
    if (block.has("baseUrl")) {
      val baseUrl = block.optString("baseUrl").trim()
      if (baseUrl.isNotEmpty()) config = config.copy(baseUrl = baseUrl)
    }
  }

  // ── geolocation ──────────────────────────────────────────────────────────
  var geolocation = config.geolocation
  if (root.has("trackingMode")) {
    trackingMode(root.optString("trackingMode"))?.let { geolocation = geolocation.copy(trackingMode = it) }
  }
  if (root.has("desiredAccuracy")) {
    desiredAccuracy(root.optString("desiredAccuracy"))?.let { geolocation = geolocation.copy(desiredAccuracy = it) }
  }
  root.optJSONObject("accuracy")?.let { accuracy ->
    var block = geolocation.accuracy
    if (accuracy.has("profile")) {
      accuracyProfile(accuracy.optString("profile"))?.let { block = block.copy(profile = it) }
    }
    if (accuracy.has("maxAccuracyMeters")) {
      block = block.copy(maxAccuracyMeters = accuracy.optDouble("maxAccuracyMeters").toFloat())
    }
    if (accuracy.has("recoveryTrustMeters")) {
      block = block.copy(recoveryTrustMeters = accuracy.optDouble("recoveryTrustMeters").toFloat())
    }
    geolocation = geolocation.copy(accuracy = block)
  }
  if (root.has("intervalMs")) {
    geolocation = geolocation.copy(intervalMs = root.optLong("intervalMs"))
  }
  if (root.has("vehicularIntervalMs")) {
    geolocation = geolocation.copy(vehicularIntervalMs = root.optLong("vehicularIntervalMs"))
  }
  if (root.has("adaptiveCadence")) {
    geolocation = geolocation.copy(adaptiveCadence = root.optBoolean("adaptiveCadence"))
  }
  if (root.has("turnBurst")) {
    geolocation = geolocation.copy(turnBurst = root.optBoolean("turnBurst"))
  }
  if (root.has("turnBurstIntervalMs")) {
    geolocation = geolocation.copy(turnBurstIntervalMs = root.optLong("turnBurstIntervalMs"))
  }
  if (root.has("navigationMode")) {
    geolocation = geolocation.copy(navigationMode = root.optBoolean("navigationMode"))
  }
  if (root.has("navigationIntervalMs")) {
    geolocation = geolocation.copy(navigationIntervalMs = root.optLong("navigationIntervalMs"))
  }
  if (root.has("oneShotTimeoutMs")) {
    geolocation = geolocation.copy(oneShotTimeoutMs = root.optLong("oneShotTimeoutMs"))
  }
  if (root.has("deliveryStalenessMs")) {
    geolocation = geolocation.copy(deliveryStalenessMs = root.optLong("deliveryStalenessMs"))
  }
  if (root.has("mockLocationPolicy")) {
    mockPolicy(root.optString("mockLocationPolicy"))?.let { geolocation = geolocation.copy(mockLocationPolicy = it) }
  }
  // Android-only geolocation fields, namespaced on the wire.
  android?.let { block ->
    if (block.has("providerType")) {
      providerType(block.optString("providerType"))?.let { geolocation = geolocation.copy(providerType = it) }
    }
    if (block.has("fastestIntervalMs")) {
      geolocation = geolocation.copy(fastestIntervalMs = block.optLong("fastestIntervalMs"))
    }
    if (block.has("maxUpdateDelayMs")) {
      geolocation = geolocation.copy(maxUpdateDelayMs = block.optLong("maxUpdateDelayMs"))
    }
    if (block.has("maxFixAgeMs")) {
      geolocation = geolocation.copy(maxFixAgeMs = block.optLong("maxFixAgeMs"))
    }
    if (block.has("navigationFastestIntervalMs")) {
      geolocation = geolocation.copy(navigationFastestIntervalMs = block.optLong("navigationFastestIntervalMs"))
    }
    if (block.has("distanceFilterM")) {
      geolocation = geolocation.copy(distanceFilterM = block.optDouble("distanceFilterM").toFloat())
    }
  }
  config = config.copy(geolocation = geolocation)

  // ── motion ───────────────────────────────────────────────────────────────
  var motion = config.motion
  if (root.has("activityRecognition")) {
    motion = motion.copy(activityRecognition = root.optBoolean("activityRecognition"))
  }
  if (root.has("activityRecognitionIntervalMs")) {
    motion = motion.copy(activityRecognitionIntervalMs = root.optLong("activityRecognitionIntervalMs"))
  }
  if (root.has("activityConfidenceMin")) {
    motion = motion.copy(activityConfidenceMin = root.optInt("activityConfidenceMin"))
  }
  if (root.has("snapshotConfidenceMin")) {
    motion = motion.copy(snapshotConfidenceMin = root.optInt("snapshotConfidenceMin"))
  }
  if (root.has("disableStopDetection")) {
    motion = motion.copy(disableStopDetection = root.optBoolean("disableStopDetection"))
  }
  if (root.has("stopOnStationary")) {
    motion = motion.copy(stopOnStationary = root.optBoolean("stopOnStationary"))
  }
  if (root.has("stopTimeoutMin")) {
    motion = motion.copy(stopTimeoutMin = root.optInt("stopTimeoutMin"))
  }
  if (root.has("stationaryRadiusM")) {
    motion = motion.copy(stationaryRadiusM = root.optDouble("stationaryRadiusM").toFloat())
  }
  if (root.has("motionTriggerDelayMs")) {
    motion = motion.copy(motionTriggerDelayMs = root.optLong("motionTriggerDelayMs"))
  }
  if (root.has("heartbeatIntervalSec")) {
    motion = motion.copy(heartbeatIntervalSec = root.optInt("heartbeatIntervalSec"))
  }
  if (root.has("persistHeartbeat")) {
    motion = motion.copy(persistHeartbeat = root.optBoolean("persistHeartbeat"))
  }
  if (root.has("bearingChangeCaptureDeg")) {
    motion = motion.copy(bearingChangeCaptureDeg = root.optInt("bearingChangeCaptureDeg"))
  }
  if (root.has("cornerAnchorCapture")) {
    motion = motion.copy(cornerAnchorCapture = root.optBoolean("cornerAnchorCapture"))
  }
  android?.let { block ->
    if (block.has("stationaryGeofenceId")) {
      motion = motion.copy(stationaryGeofenceId = block.optString("stationaryGeofenceId"))
    }
    if (block.has("stationaryGeofenceOnEnterEvent")) {
      motion = motion.copy(stationaryGeofenceOnEnterEvent = block.optString("stationaryGeofenceOnEnterEvent"))
    }
    if (block.has("stationaryGeofenceOnExitEvent")) {
      motion = motion.copy(stationaryGeofenceOnExitEvent = block.optString("stationaryGeofenceOnExitEvent"))
    }
  }
  config = config.copy(motion = motion)

  // ── persistence ──────────────────────────────────────────────────────────
  var persistence = config.persistence
  if (root.has("maxDaysToPersist")) {
    persistence = persistence.copy(maxDaysToPersist = root.optInt("maxDaysToPersist"))
  }
  if (root.has("persistRawFixes")) {
    persistence = persistence.copy(persistRawFixes = root.optBoolean("persistRawFixes"))
  }
  // The one rename in this block: wire `rawFixRingCapacity` is Android's `rawRingCapacity`.
  if (root.has("rawFixRingCapacity")) {
    persistence = persistence.copy(rawRingCapacity = root.optInt("rawFixRingCapacity"))
  }
  if (root.has("persistRawPoints")) {
    persistence = persistence.copy(persistRawPoints = root.optBoolean("persistRawPoints"))
  }
  if (root.has("rawPointRingCapacity")) {
    persistence = persistence.copy(rawPointRingCapacity = root.optInt("rawPointRingCapacity"))
  }
  if (root.has("persistDecisions")) {
    persistence = persistence.copy(persistDecisions = root.optBoolean("persistDecisions"))
  }
  if (root.has("decisionRetentionDays")) {
    persistence = persistence.copy(decisionRetentionDays = root.optInt("decisionRetentionDays"))
  }
  if (root.has("decisionMaxRows")) {
    persistence = persistence.copy(decisionMaxRows = root.optInt("decisionMaxRows"))
  }
  android?.let { block ->
    if (block.has("maxRecords")) {
      persistence = persistence.copy(maxRecords = block.optInt("maxRecords"))
    }
  }
  config = config.copy(persistence = persistence)

  // ── sensors ──────────────────────────────────────────────────────────────
  var sensors = config.sensors
  if (root.has("useStepCorroboration")) {
    sensors = sensors.copy(useStepCorroboration = root.optBoolean("useStepCorroboration"))
  }
  if (root.has("useAccelerometerVeto")) {
    sensors = sensors.copy(useAccelerometerVeto = root.optBoolean("useAccelerometerVeto"))
  }
  if (root.has("useBarometer")) {
    sensors = sensors.copy(useBarometer = root.optBoolean("useBarometer"))
  }
  // Flat since iOS gained a wake path of its own (SDK 1.0.5); it was `android.useSignificantMotion`
  // and the namespaced key is no longer read.
  if (root.has("useSignificantMotion")) {
    sensors = sensors.copy(useSignificantMotion = root.optBoolean("useSignificantMotion"))
  }
  if (root.has("useGyroTurnPrediction")) {
    sensors = sensors.copy(useGyroTurnPrediction = root.optBoolean("useGyroTurnPrediction"))
  }
  android?.let { block ->
    if (block.has("stepBatchLatencyMs")) {
      sensors = sensors.copy(stepBatchLatencyMs = block.optLong("stepBatchLatencyMs"))
    }
  }
  config = config.copy(sensors = sensors)

  // ── service ──────────────────────────────────────────────────────────────
  var service = config.service
  if (root.has("healthLoopMs")) {
    service = service.copy(healthLoopMs = root.optLong("healthLoopMs"))
  }
  if (root.has("backstopIntervalMin")) {
    service = service.copy(backstopIntervalMin = root.optInt("backstopIntervalMin"))
  }
  if (root.has("deadTrackerMovingMin")) {
    service = service.copy(deadTrackerMovingMin = root.optInt("deadTrackerMovingMin"))
  }
  if (root.has("deadTrackerStationaryMin")) {
    service = service.copy(deadTrackerStationaryMin = root.optInt("deadTrackerStationaryMin"))
  }
  android?.let { block ->
    if (block.has("foregroundService")) {
      service = service.copy(foregroundService = block.optBoolean("foregroundService"))
    }
    if (block.has("stopOnTerminate")) {
      service = service.copy(stopOnTerminate = block.optBoolean("stopOnTerminate"))
    }
    if (block.has("startOnBoot")) {
      service = service.copy(startOnBoot = block.optBoolean("startOnBoot"))
    }
    if (block.has("watchdogIntervalMs")) {
      service = service.copy(watchdogIntervalMs = block.optLong("watchdogIntervalMs"))
    }
    if (block.has("watchdogThrottleMs")) {
      service = service.copy(watchdogThrottleMs = block.optLong("watchdogThrottleMs"))
    }
    if (block.has("wakeLockMs")) {
      service = service.copy(wakeLockMs = block.optLong("wakeLockMs"))
    }
    if (block.has("notificationTitle")) {
      service = service.copy(notificationTitle = block.optString("notificationTitle"))
    }
    if (block.has("notificationText")) {
      service = service.copy(notificationText = block.optString("notificationText"))
    }
    if (block.has("notificationChannelId")) {
      service = service.copy(notificationChannelId = block.optString("notificationChannelId"))
    }
    if (block.has("notificationChannelName")) {
      service = service.copy(notificationChannelName = block.optString("notificationChannelName"))
    }
    if (block.has("notificationSmallIconResName")) {
      service = service.copy(notificationSmallIconResName = block.optString("notificationSmallIconResName"))
    }
    // Sync-status diagnostic (Android SDK 1.0.7-alpha5). Three keys, all absent by default: the
    // SDK's own defaults are off / no subtitle / "unsynced {pending} · last upload {age}", and an
    // absent key must leave each of them alone. `syncNotificationSubText` is nullable natively —
    // null means "no subtitle", so it is only written when the host actually sent the key, never
    // synthesised from an empty string.
    if (block.has("showSyncStatusInNotification")) {
      service = service.copy(showSyncStatusInNotification = block.optBoolean("showSyncStatusInNotification"))
    }
    if (block.has("syncNotificationSubText")) {
      service = service.copy(syncNotificationSubText = block.optString("syncNotificationSubText"))
    }
    if (block.has("syncNotificationText")) {
      service = service.copy(syncNotificationText = block.optString("syncNotificationText"))
    }
  }
  config = config.copy(service = service)

  // ── security (device integrity) ──────────────────────────────────────────────
  // Android-only, so it is namespaced under `android.security` rather than flat — there is no iOS
  // counterpart for the wire shape to reconcile. Every key is optional and an absent one leaves
  // the SDK default (which is `block` for hooking and mock-location, `warn` for the rest); an
  // unrecognised policy string leaves the default rather than guessing, matching every other enum
  // here. The layer is waived wholesale on a debuggable install, so none of this takes effect in
  // development.
  android?.optJSONObject("security")?.let { block ->
    var security = config.security
    if (block.has("enabled")) {
      security = security.copy(enabled = block.optBoolean("enabled"))
    }
    if (block.has("hooking")) {
      integrityPolicy(block.optString("hooking"))?.let { security = security.copy(hooking = it) }
    }
    if (block.has("mockLocation")) {
      integrityPolicy(block.optString("mockLocation"))?.let { security = security.copy(mockLocation = it) }
    }
    if (block.has("accessibility")) {
      integrityPolicy(block.optString("accessibility"))?.let { security = security.copy(accessibility = it) }
    }
    if (block.has("developerMode")) {
      integrityPolicy(block.optString("developerMode"))?.let { security = security.copy(developerMode = it) }
    }
    if (block.has("clock")) {
      integrityPolicy(block.optString("clock"))?.let { security = security.copy(clock = it) }
    }
    block.optJSONArray("accessibilityAllowlist")?.let { array ->
      val allowlist = buildSet {
        for (i in 0 until array.length()) {
          array.optString(i).takeIf { it.isNotEmpty() }?.let { add(it) }
        }
      }
      security = security.copy(accessibilityAllowlist = allowlist)
    }
    if (block.has("maxClockSkewMs")) {
      security = security.copy(maxClockSkewMs = block.optLong("maxClockSkewMs"))
    }
    if (block.has("recheckIntervalMs")) {
      security = security.copy(recheckIntervalMs = block.optLong("recheckIntervalMs"))
    }
    config = config.copy(security = security)
  }

  // `ios` is read for nothing here by design — the namespace exists so the host never branches on
  // Platform.OS; the other platform's block is dead weight on this one.
  @Suppress("UNUSED_EXPRESSION")
  ios

  return config
}

// MARK: - Enum vocabulary

private fun trackingMode(value: String?): TrackingMode? = when (value) {
  "continuous" -> TrackingMode.CONTINUOUS
  "adaptive" -> TrackingMode.ADAPTIVE
  "motionOnly" -> TrackingMode.MOTION_ONLY
  else -> null
}

private fun desiredAccuracy(value: String?): DesiredAccuracy? = when (value) {
  "high" -> DesiredAccuracy.HIGH
  "balanced" -> DesiredAccuracy.BALANCED
  "low" -> DesiredAccuracy.LOW
  else -> null
}

private fun accuracyProfile(value: String?): AccuracyProfile? = when (value) {
  "strict" -> AccuracyProfile.STRICT
  "balanced" -> AccuracyProfile.BALANCED
  "relaxed" -> AccuracyProfile.RELAXED
  "custom" -> AccuracyProfile.CUSTOM
  else -> null
}

private fun mockPolicy(value: String?): MockPolicy? = when (value) {
  "flag" -> MockPolicy.FLAG
  "reject" -> MockPolicy.REJECT
  "allow" -> MockPolicy.ALLOW
  else -> null
}

private fun integrityPolicy(value: String?): IntegrityPolicy? = when (value) {
  "allow" -> IntegrityPolicy.ALLOW
  "warn" -> IntegrityPolicy.WARN
  "block" -> IntegrityPolicy.BLOCK
  else -> null
}

private fun providerType(value: String?): LocationProviderType? = when (value) {
  "fused" -> LocationProviderType.FUSED
  "gpsOnly" -> LocationProviderType.GPS_ONLY
  "networkOnly" -> LocationProviderType.NETWORK_ONLY
  "passive" -> LocationProviderType.PASSIVE
  else -> null
}

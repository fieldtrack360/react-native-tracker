package com.fieldtrack360.tracker

import com.field360.tracker.RawFix
import com.field360.tracker.RawPoint
import com.field360.tracker.domain.model.ErrorCode
import com.field360.tracker.domain.model.LicenseInfo
import com.field360.tracker.domain.model.LocationAccuracy
import com.field360.tracker.domain.model.PermissionTier
import com.field360.tracker.domain.model.ProviderState
import com.field360.tracker.domain.model.TrackerEvent
import com.field360.tracker.domain.model.TrackerGeofence
import com.field360.tracker.domain.model.TrackerGeofenceEvent
import com.field360.tracker.domain.model.TrackerState
import com.field360.tracker.domain.model.TrackSession
import com.field360.traker.geo.model.Bounds
import com.field360.traker.geo.model.FixDecision
import com.field360.traker.geo.model.TrackFix
import com.field360.traker.geo.model.TrackPoint
import com.field360.traker.geo.model.Verdict
import com.field360.traker.geo.plot.model.ArrowAnchor
import com.field360.traker.geo.plot.model.LiveTrackUpdate
import com.field360.traker.geo.plot.model.PuckState
import com.field360.traker.geo.plot.model.StopNode
import com.field360.traker.geo.plot.model.Track
import com.field360.traker.geo.plot.model.TrackJsonPoint
import com.field360.traker.geo.plot.model.TrackSegment
import com.field360.traker.geo.plot.model.TrackStats
// UNVERIFIED-SDK-NAMING: BatteryInfo's subpackage is a guess. The guide documents the type's
// fields but no import line anywhere, and BatteryInfo sits in the same "Battery and sensors"
// section as DeviceSensors — hence `.motion`. If it does not resolve, try `.domain.model`.
import com.field360.tracker.domain.model.BatteryInfo
import com.field360.tracker.integrity.IntegrityReport
import com.field360.tracker.motion.DeviceSensors
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject

// Wire vocabulary — the ONLY place Android enums stringify and fields rename (carve-out).
// Casing is settled here, before a value crosses the bridge, so JS
// never sees two vocabularies.
//
// Return conventions:
//  - Codegen-typed shapes (TrackerState, ProviderState, DeviceSensors, TrackFix, TrackSession)
//    return `WritableMap`, resolved directly by the module. RN has no putLong, so Long fields cross
//    as Double — safe for the epoch-ms / boot-nanos magnitudes here (< 2^53).
//  - JSON-string shapes (TrackPoint, RawFix, RawPoint, FixDecision, and the whole Track tree —
//    unbounded collections) return `org.json.JSONObject`; the module builds a JSONArray
//    and serializes. `trackJson` is the drop-in serializer for buildTrack. org.json keeps Long
//    precision natively.
//
// Track tree — DECODE-vs-MAP decision: we map the native `Track` OBJECT field-by-field, we do NOT
// decode a JSON string. `Tracker.buildTrack(...)` returns `geo.plot.model.Track`, not a String —
// there is no native JSON string to decode. Even if there were, the two platforms' @Serializable /
// Codable JSON diverge hard (zero-overlap TrackJsonPoint short keys i/t/lat/lng/acc/spd/brg/act/
// src/mock, renamed TrackStats fields, kotlinx SCREAMING_SNAKE enums with no @SerialName), so
// reading the typed accessors and re-keying onto the one wire shape is the only faithful path.
object TrackerMappers {

  // ---- Enum vocabulary ----

  // SCREAMING_SNAKE → lowerCamel. STOPPED → stopped, STOP_PENDING → stopPending, IN_VEHICLE →
  // inVehicle. Used for every enum whose Android form is SCREAMING_SNAKE and whose wire form is
  // lower camel (MotionState, ActivityType, MovementStatus, MotionQuality, SegmentType).
  fun screamingSnakeToLowerCamel(value: String): String {
    val parts = value.lowercase().split('_')
    return parts.first() + parts.drop(1).joinToString("") { part ->
      part.replaceFirstChar { if (it.isLowerCase()) it.titlecase() else it.toString() }
    }
  }

  // permission tier — a VALUE rename, not casing. Android FOREGROUND_ONLY → wire foreground.
  fun permissionTier(tier: PermissionTier): String = when (tier) {
    PermissionTier.NONE -> "none"
    PermissionTier.FOREGROUND_ONLY -> "foreground"
    PermissionTier.FULL -> "always"
  }

  // accuracy — a VALUE rename, not casing. Android APPROXIMATE/PRECISE → wire approximate/precise.
  fun accuracyAuthorization(accuracy: LocationAccuracy): String = when (accuracy) {
    LocationAccuracy.APPROXIMATE -> "approximate"
    LocationAccuracy.PRECISE -> "precise"
  }

  // ErrorCode → wire. Mostly SCREAMING_SNAKE → lowerCamel, but the member is `INTERNAL`, not
  // `INTERNAL_ERROR`, so it is a RENAME to the wire's `internalError` (not casing).
  fun errorCode(code: ErrorCode): String =
    if (code == ErrorCode.INTERNAL) "internalError" else screamingSnakeToLowerCamel(code.name)

  // ---- TrackerState ----

  // TrackerState → wire map. motionState: Android MotionState.name is SCREAMING_SNAKE
  // (STOP_PENDING) normalized to lower camel; currentSessionId is already the wire name, null
  // when no session is open — omitted rather than sent as null, matching iOS. providerState is the
  // union (getState ships the full wire shape).
  fun stateMap(state: TrackerState): WritableMap = Arguments.createMap().apply {
    putBoolean("isReady", state.isReady)
    putBoolean("isTracking", state.isTracking)
    putString("motionState", screamingSnakeToLowerCamel(state.motionState.name))
    putMap("providerState", providerStateMap(state.providerState))
    state.currentSessionId?.let { putString("currentSessionId", it) }
  }

  // ---- ProviderState (union) ----

  // ProviderState → wire. Shared flat: permissionTier (from Android `permission`, a tier
  // value), accuracyAuthorization (value rename), powerSave (from `powerSaveMode`). The
  // Android-only half is namespaced; the iOS half is absent on this platform.
  fun providerStateMap(p: ProviderState): WritableMap = Arguments.createMap().apply {
    putString("permissionTier", permissionTier(p.permission))
    putString("accuracyAuthorization", accuracyAuthorization(p.accuracyAuthorization))
    putBoolean("powerSave", p.powerSaveMode)
    putMap("android", Arguments.createMap().apply {
      putBoolean("gpsEnabled", p.gpsEnabled)
      putBoolean("networkEnabled", p.networkEnabled)
      putBoolean("fusedAvailable", p.fusedAvailable)
    })
  }

  // ---- DeviceSensors (union) ----

  // DeviceSensors → wire. motionQuality shared; the Android half namespaced. The iOS half is
  // absent (not `false`) — "no pedometer" and "we cannot tell" are different facts.
  // BatteryInfo → wire. percent/isCharging are nullable in the SDK and stay nullable here:
  // null is "not known", NOT 0 % / not charging, so they are written as explicit nulls rather than
  // coalesced to a falsy default. `isLow` is the SDK's own derived property (percent <= 15) and is
  // carried across rather than recomputed, so the threshold stays owned by the SDK. powerSource is
  // the enum (NONE|AC|USB|WIRELESS|DOCK|UNKNOWN) in the wire's lower-camel vocabulary; note
  // `none` (on battery) and `unknown` (cannot tell) are different answers.
  fun batteryMap(b: BatteryInfo): WritableMap = Arguments.createMap().apply {
    val percent = b.percent
    if (percent != null) putInt("percent", percent) else putNull("percent")
    val charging = b.isCharging
    if (charging != null) putBoolean("isCharging", charging) else putNull("isCharging")
    putString("powerSource", screamingSnakeToLowerCamel(b.powerSource.name))
    putBoolean("isLow", b.isLow)
  }

  // ---- Device integrity (Android-only) ----

  // IntegrityReport → wire. Signal and policy enums are SCREAMING_SNAKE → lower camel like every
  // other enum here. `waived` is carried across verbatim and MUST NOT be collapsed into an empty
  // findings list: on a debuggable build nothing was probed, and "no findings" would read as
  // "clean" when the honest answer is "not evaluated". `flags` is the same bitmask stamped on
  // every stored point and uploaded by the sync module.
  fun integrityReportMap(r: IntegrityReport): WritableMap = Arguments.createMap().apply {
    putDouble("evaluatedAtMs", r.evaluatedAtMs.toDouble())
    putBoolean("waived", r.waived)
    putBoolean("blocked", r.blocked)
    putInt("flags", r.flags)
    putArray("findings", Arguments.createArray().apply {
      r.findings.forEach { finding ->
        pushMap(Arguments.createMap().apply {
          putString("signal", screamingSnakeToLowerCamel(finding.signal.name))
          putString("policy", screamingSnakeToLowerCamel(finding.policy.name))
          putString("detail", finding.detail)
          putInt("confidence", finding.confidence)
        })
      }
    })
    putArray("blockingSignals", Arguments.createArray().apply {
      r.blockingSignals.forEach { pushString(screamingSnakeToLowerCamel(it.name)) }
    })
  }

  // IntegrityReport → JSON. androidIntegrity()/androidCheckIntegrity() cross as JSON strings
  // (findings is unbounded), so the report is built twice in two shapes rather than converting a
  // WritableMap — the event path needs the map, the promise path needs the string.
  fun integrityReportJson(r: IntegrityReport): JSONObject = JSONObject().apply {
    put("evaluatedAtMs", r.evaluatedAtMs)
    put("waived", r.waived)
    put("blocked", r.blocked)
    put("flags", r.flags)
    put("findings", JSONArray().apply {
      r.findings.forEach { finding ->
        put(JSONObject().apply {
          put("signal", screamingSnakeToLowerCamel(finding.signal.name))
          put("policy", screamingSnakeToLowerCamel(finding.policy.name))
          put("detail", finding.detail)
          put("confidence", finding.confidence)
        })
      }
    })
    put("blockingSignals", JSONArray().apply {
      r.blockingSignals.forEach { put(screamingSnakeToLowerCamel(it.name)) }
    })
  }

  // ---- Online licence check (Android v1.0.1-alpha-08+) ----

  // LicenseInfo → wire. `status` is the closed LicenseStatus enum normalized to lower camel
  // (UNKNOWN_KEY → unknownKey). `checkedAt` is the server's own ISO-8601 string, passed through
  // verbatim — reparsing it here would substitute the device clock for the server's, which is the
  // one clock this value exists to be independent of. `reason` is null when the server sent none.
  fun licenseInfoMap(i: LicenseInfo): WritableMap = Arguments.createMap().apply {
    putString("status", screamingSnakeToLowerCamel(i.status.name))
    putBoolean("valid", i.valid)
    putString("packageName", i.packageName)
    putString("checkedAt", i.checkedAt)
    putDouble("ttlSeconds", i.ttlSeconds.toDouble())
    val reason = i.reason
    if (reason != null) putString("reason", reason) else putNull("reason")
    putBoolean("fromCache", i.fromCache)
  }

  fun licenseInfoJson(i: LicenseInfo): JSONObject = JSONObject().apply {
    put("status", screamingSnakeToLowerCamel(i.status.name))
    put("valid", i.valid)
    put("packageName", i.packageName)
    put("checkedAt", i.checkedAt)
    put("ttlSeconds", i.ttlSeconds)
    put("reason", i.reason ?: JSONObject.NULL)
    put("fromCache", i.fromCache)
  }

  fun sensorsMap(s: DeviceSensors): WritableMap = Arguments.createMap().apply {
    putString("motionQuality", screamingSnakeToLowerCamel(s.motionQuality.name))
    putMap("android", Arguments.createMap().apply {
      putBoolean("accelerometer", s.accelerometer)
      putBoolean("gyroscope", s.gyroscope)
      putBoolean("magnetometer", s.magnetometer)
      putBoolean("significantMotion", s.significantMotion)
      putBoolean("stepDetector", s.stepDetector)
      putBoolean("stepCounter", s.stepCounter)
      putBoolean("barometer", s.barometer)
      putBoolean("rotationVector", s.rotationVector)
    })
  }

  // ---- TrackFix (getCurrentLocation) ----

  // TrackFix → wire (typed). renames: elapsedRealtimeNanos → monotonicNanos,
  // receivedAtElapsedNanos → receivedAtMonotonicNanos, accuracy → accuracyM, altitude → altitudeM,
  // verticalAccuracy → verticalAccuracyM. satelliteCount is Android-only → `android.satelliteCount`.
  fun trackFixMap(f: TrackFix): WritableMap = Arguments.createMap().apply {
    putDouble("timeMs", f.timeMs.toDouble())
    putDouble("monotonicNanos", f.elapsedRealtimeNanos.toDouble())
    putDouble("receivedAtMonotonicNanos", f.receivedAtElapsedNanos.toDouble())
    putDouble("latitude", f.latitude)
    putDouble("longitude", f.longitude)
    putDouble("accuracyM", f.accuracy.toDouble())
    putDouble("speedMps", f.speedMps.toDouble())
    putDouble("bearingDeg", f.bearingDeg.toDouble())
    putBoolean("hasSpeed", f.hasSpeed)
    putBoolean("hasBearing", f.hasBearing)
    putString("provider", f.provider)
    putBoolean("isMock", f.isMock)
    f.altitude?.let { putDouble("altitudeM", it) }
    f.verticalAccuracy?.let { putDouble("verticalAccuracyM", it.toDouble()) }
    f.speedAccuracyMps?.let { putDouble("speedAccuracyMps", it.toDouble()) }
    f.bearingAccuracyDeg?.let { putDouble("bearingAccuracyDeg", it.toDouble()) }
    f.satelliteCount?.let {
      putMap("android", Arguments.createMap().apply { putInt("satelliteCount", it) })
    }
  }

  // ---- TrackSession (getSessions / currentSession) ----

  // TrackSession → wire (typed). sessionId already the wire name; startedAtElapsedNanos is
  // Android-only → `android.startedAtElapsedNanos`. isOpen is computed.
  fun sessionMap(s: TrackSession): WritableMap = Arguments.createMap().apply {
    putString("id", s.id)
    putDouble("startedAtMs", s.startedAtMs.toDouble())
    putBoolean("isOpen", s.isOpen)
    s.endedAtMs?.let { putDouble("endedAtMs", it.toDouble()) }
    s.tag?.let { putString("tag", it) }
    s.configSnapshot?.let { putString("configSnapshot", it) }
    putMap("android", Arguments.createMap().apply {
      putDouble("startedAtElapsedNanos", s.startedAtElapsedNanos.toDouble())
    })
  }

  // ---- TrackPoint (getPoints — JSON string) ----

  // TrackPoint → wire. renames: elapsedRealtimeNanos → monotonicNanos, accuracy → accuracyM,
  // altitude → altitudeM, odometerMeters → odometerM. movementStatus/detectedActivity normalized.
  // `isMock` and `isCharging` are SHARED wire fields (the guide documents both on the Android
  // TrackPoint, and iOS carries both too), so they are emitted flat. They used to be dropped here
  // because the wire type filed them under `ios?` — that was a misclassification and cost every
  // Android host two columns of every stored point.
  // `integrityFlags` sits under `android` and is carried across: it is the bitmask the sync module
  // uploads as `integrity_flags`, so dropping it would leave the host unable to explain a row its
  // own backend can see.
  fun trackPointJson(p: TrackPoint): JSONObject = JSONObject().apply {
    put("id", p.id)
    put("uuid", p.uuid)
    put("sessionId", p.sessionId)
    put("timeMs", p.timeMs)
    put("monotonicNanos", p.elapsedRealtimeNanos)
    put("localDate", p.localDate)
    put("timezone", p.timezone)
    put("latitude", p.latitude)
    put("longitude", p.longitude)
    put("accuracyM", p.accuracy.toDouble())
    p.altitude?.let { put("altitudeM", it) }
    put("speedMps", p.speedMps.toDouble())
    put("bearingDeg", p.bearingDeg.toDouble())
    put("hasSpeed", p.hasSpeed)
    put("hasBearing", p.hasBearing)
    put("provider", p.provider)
    put("movementStatus", screamingSnakeToLowerCamel(p.movementStatus.name))
    p.detectedActivity?.let { put("detectedActivity", screamingSnakeToLowerCamel(it.name)) }
    put("activityStartTimeMs", p.activityStartTimeMs)
    put("odometerM", p.odometerMeters)
    p.batteryPct?.let { put("batteryPct", it) }
    p.isCharging?.let { put("isCharging", it) }
    put("isMock", p.isMock)
    p.extras?.let { put("extras", it) }
    put("acceptReason", p.acceptReason)
    put("android", JSONObject().apply { put("integrityFlags", p.integrityFlags) })
  }

  // ---- RawFix (getRawFixes — JSON string) ----

  // RawFix → wire. Android carries the shared six (accuracy → accuracyM) plus `integrityFlags`;
  // no `ios` block. integrityFlags is the bitmask as it stood when the fix was RECEIVED — distinct
  // from TrackPoint's, which is stamped on acceptance. A fix the pipeline rejects never becomes a
  // TrackPoint, so this is the only record of its integrity state.
  fun rawFixJson(f: RawFix): JSONObject = JSONObject().apply {
    put("timeMs", f.timeMs)
    put("latitude", f.latitude)
    put("longitude", f.longitude)
    put("accuracyM", f.accuracy.toDouble())
    put("bearingDeg", f.bearingDeg.toDouble())
    put("provider", f.provider)
    put("android", JSONObject().apply { put("integrityFlags", f.integrityFlags) })
  }

  // ---- RawPoint (getRawPoints — JSON string) ----

  // RawPoint → wire. Shared nine flat (accuracy → accuracyM); the Android battery/motion detail
  // under `android` (altitude → altitudeM, movementStatus normalized). No `ios` block. isAccepted
  // is computed.
  fun rawPointJson(p: RawPoint): JSONObject = JSONObject().apply {
    put("uuid", p.uuid)
    put("sessionId", p.sessionId)
    put("timeMs", p.timeMs)
    put("latitude", p.latitude)
    put("longitude", p.longitude)
    put("accuracyM", p.accuracy.toDouble())
    put("verdict", p.verdict)
    put("reason", p.reason)
    put("isAccepted", p.isAccepted)
    put("android", JSONObject().apply {
      p.altitude?.let { put("altitudeM", it) }
      p.batteryPct?.let { put("batteryPct", it) }
      p.isCharging?.let { put("isCharging", it) }
      p.extras?.let { put("extras", it) }
      put("movementStatus", screamingSnakeToLowerCamel(p.movementStatus.name))
    })
  }

  // ---- FixDecision (getDecisions — JSON string) ----

  // FixDecision → wire. Android `verdict` is the sealed Verdict → the accept/skip/reject label;
  // `reason` is the computed reason. renames: filterLat → filterLatitude, filterLng →
  // filterLongitude. motionState normalized.
  fun fixDecisionJson(d: FixDecision): JSONObject = JSONObject().apply {
    val verdict = when (d.verdict) {
      is Verdict.Accept -> "accept"
      is Verdict.Reject -> "reject"
      is Verdict.Skip -> "skip"
      else -> "skip"
    }
    put("verdict", verdict)
    put("reason", d.reason)
    put("filterLatitude", d.filterLat)
    put("filterLongitude", d.filterLng)
    put("sigma", d.sigma.toDouble())
    put("threshold", d.threshold.toDouble())
    put("distanceMovedM", d.distanceMovedM)
    put("effectiveSpeedMps", d.effectiveSpeedMps.toDouble())
    put("motionState", screamingSnakeToLowerCamel(d.motionState.name))
  }

  // ---- Track tree (JSON string) ----

  // Drop-in serializer for buildTrack: maps the native Track object to the wire shape and encodes
  // the wire JSON string. A put() fault (e.g. NaN) throws → the module rejects the Promise.
  fun trackJson(t: Track): String = trackObject(t).toString()

  // Track → wire. sessionId already the wire name (optional). precision carried so the JS
  // decoder reads the real value (default 6, not 5).
  private fun trackObject(t: Track): JSONObject = JSONObject().apply {
    put("version", t.version)
    t.sessionId?.let { put("sessionId", it) }
    put("generatedAtMs", t.generatedAtMs)
    put("from", t.from)
    put("to", t.to)
    put("timezone", t.timezone)
    put("precision", t.precision)
    t.bounds?.let { put("bounds", boundsObject(it)) }
    put("stats", trackStatsObject(t.stats))
    put("encodedPolyline", t.encodedPolyline)
    put("points", JSONArray(t.points.map { trackJsonPointObject(it) }))
    put("segments", JSONArray(t.segments.map { trackSegmentObject(it) }))
    put("stops", JSONArray(t.stops.map { stopNodeObject(it) }))
    put("arrows", JSONArray(t.arrows.map { arrowAnchorObject(it) }))
    put("warnings", JSONArray(t.warnings))
  }

  // TrackStats → wire. renames: movingSec → movingDurationSec, stoppedSec →
  // stoppedDurationSec. The speed/count block is Android-only → `android`.
  private fun trackStatsObject(s: TrackStats): JSONObject = JSONObject().apply {
    put("distanceMeters", s.distanceMeters)
    put("durationSec", s.durationSec)
    put("movingDurationSec", s.movingSec)
    put("stoppedDurationSec", s.stoppedSec)
    put("activityBreakdownSec", JSONObject().apply {
      s.activityBreakdownSec.forEach { (k, v) -> put(k, v) }
    })
    put("android", JSONObject().apply {
      put("maxSpeedMps", s.maxSpeedMps.toDouble())
      put("avgMovingSpeedMps", s.avgMovingSpeedMps.toDouble())
      put("pointCount", s.pointCount)
      put("stopCount", s.stopCount)
    })
  }

  // TrackJsonPoint (Android 10 short keys) → wire.: t → timeMs, lat → latitude, lng →
  // longitude, acc → accuracyM, spd → speedMps, brg → bearingDeg, act → activity; i/src/mock are
  // Android-only → `android`. `act` is emitted only when non-empty (parity with iOS `activity?`).
  private fun trackJsonPointObject(p: TrackJsonPoint): JSONObject = JSONObject().apply {
    put("timeMs", p.t)
    put("latitude", p.lat)
    put("longitude", p.lng)
    put("accuracyM", p.acc.toDouble())
    put("speedMps", p.spd.toDouble())
    put("bearingDeg", p.brg.toDouble())
    if (!p.act.isNullOrEmpty()) put("activity", p.act)
    put("android", JSONObject().apply {
      put("index", p.i)
      put("source", p.src)
      put("isMock", p.mock)
    })
  }

  // TrackSegment → wire. type.name SCREAMING_SNAKE → lower camel. No `travelStartMs` on Android,
  // so no `ios` block.
  private fun trackSegmentObject(s: TrackSegment): JSONObject = JSONObject().apply {
    put("from", s.from)
    put("to", s.to)
    put("type", screamingSnakeToLowerCamel(s.type.name))
    put("startMs", s.startMs)
    put("endMs", s.endMs)
    put("distanceMeters", s.distanceMeters)
    put("durationSec", s.durationSec)
    put("avgSpeedMps", s.avgSpeedMps.toDouble())
    put("maxSpeedMps", s.maxSpeedMps.toDouble())
    put("p75SpeedMps", s.p75SpeedMps.toDouble())
    s.activity?.let { put("activity", it) }
    s.activityIcon?.let { put("activityIcon", it) }
    s.speedBand?.let { put("speedBand", it) }
    put("encodedPolyline", s.encodedPolyline)
    s.stopIndex?.let { put("stopIndex", it) }
  }

  // StopNode → wire.: lat → latitude, lng → longitude.
  private fun stopNodeObject(s: StopNode): JSONObject = JSONObject().apply {
    put("index", s.index)
    put("latitude", s.lat)
    put("longitude", s.lng)
    put("arrivalMs", s.arrivalMs)
    s.departureMs?.let { put("departureMs", it) }
    put("dwellSec", s.dwellSec)
    put("radiusM", s.radiusM)
    put("pointCount", s.pointCount)
    s.address?.let { put("address", it) }
    put("isOngoing", s.isOngoing)
  }

  // ArrowAnchor → wire.: lat → latitude, lng → longitude.
  private fun arrowAnchorObject(a: ArrowAnchor): JSONObject = JSONObject().apply {
    put("latitude", a.lat)
    put("longitude", a.lng)
    put("bearing", a.bearing)
    put("segment", a.segment)
  }

  // Bounds → wire. Both platforms are north/south/east/west.
  private fun boundsObject(b: Bounds): JSONObject = JSONObject().apply {
    put("north", b.north)
    put("south", b.south)
    put("east", b.east)
    put("west", b.west)
  }

  // ---- Geofencing ----

  // TrackerGeofence → wire. Android has no notify booleans/dwell, so those wire fields are
  // omitted (they default true on read); the event labels are Android-only → `android`.
  fun geofenceMap(g: TrackerGeofence): WritableMap = Arguments.createMap().apply {
    putString("id", g.id)
    putDouble("latitude", g.latitude)
    putDouble("longitude", g.longitude)
    putDouble("radiusM", g.radiusM.toDouble())
    putMap("android", Arguments.createMap().apply {
      putString("onEnterEvent", g.onEnterEvent)
      putString("onExitEvent", g.onExitEvent)
    })
  }

  // Wire geofence → native TrackerGeofence (build only; the helper performs the c/d refusal
  // checks BEFORE calling this). Android REQUIRES non-null event labels while the wire treats them
  // as optional, so absent labels are derived from the id (guide pattern: "<id>_enter"/"<id>_exit").
  fun geofenceBuild(w: ReadableMap): TrackerGeofence {
    val id = w.getString("id") ?: ""
    val android = if (w.hasKey("android") && !w.isNull("android")) w.getMap("android") else null
    val onEnter = android?.getString("onEnterEvent") ?: "${id}_enter"
    val onExit = android?.getString("onExitEvent") ?: "${id}_exit"
    return TrackerGeofence(
      id,
      w.getDouble("latitude"),
      w.getDouble("longitude"),
      w.getDouble("radiusM").toFloat(),
      onEnter,
      onExit,
    )
  }

  // TrackerGeofenceEvent → wire GeofenceCrossing. The stored event embeds the fence, so
  // lat/lon/radius come from the fence geometry (the fence centre); timestampMs is the crossing
  // time. transition is ENTER/EXIT (no dwell on Android).
  fun crossingMap(e: TrackerGeofenceEvent): WritableMap = Arguments.createMap().apply {
    putString("geofenceId", e.geofence.id)
    putString("transition", screamingSnakeToLowerCamel(e.transition.name))
    putDouble("timeMs", e.timestampMs.toDouble())
    putDouble("latitude", e.geofence.latitude)
    putDouble("longitude", e.geofence.longitude)
    putDouble("radiusM", e.geofence.radiusM.toDouble())
  }

// ══ Phase 4 subscription layer — append these inside `object TrackerMappers` ═══════════
// Additional imports required at the top of TrackerMappers.kt:
//   import com.field360.tracker.domain.model.TrackerEvent
//   import com.field360.traker.geo.plot.model.LiveTrackUpdate
//   import com.field360.traker.geo.plot.model.PuckState
//   import com.facebook.react.bridge.WritableArray
// (TrackerGeofence, WritableMap, JSONObject, JSONArray, Arguments are already imported.)

  // ---- TrackerEvent (the 16-case union; Android emits 15 of them) ----

  // TrackerEvent → wire discriminated union { type, ...payload }. Android has NO geofenceDwell;
  // geofenceAdded/geofenceRemoved reach BOTH platforms now (iOS gained them in the 1.0.0 rebuild). GeofenceEntered/Exited carry the FENCE (not a crossing),
  // so a crossing is synthesised from the fence centre with NO timeMs. point/decision reuse
  // the existing JSONObject mappers, converted to WritableMap. `error` uses errorCode (INTERNAL →
  // internalError). The sealed interface is exhaustive; the else is a defensive fallback only.
  fun eventMap(e: TrackerEvent): WritableMap = Arguments.createMap().apply {
    when (e) {
      is TrackerEvent.Location -> {
        putString("type", "location")
        putMap("point", jsonToWritableMap(trackPointJson(e.point)))
      }
      is TrackerEvent.LocationRejected -> {
        putString("type", "locationRejected")
        putMap("decision", jsonToWritableMap(fixDecisionJson(e.decision)))
      }
      is TrackerEvent.MotionChange -> {
        putString("type", "motionChange")
        putString("state", screamingSnakeToLowerCamel(e.state.name))
        val p = e.point
        if (p != null) putMap("point", jsonToWritableMap(trackPointJson(p))) else putNull("point")
      }
      is TrackerEvent.ActivityChange -> {
        putString("type", "activityChange")
        putString("activity", screamingSnakeToLowerCamel(e.activity.name))
        putInt("confidence", e.confidence)
      }
      is TrackerEvent.EnabledChange -> {
        putString("type", "enabledChange")
        putBoolean("enabled", e.enabled)
      }
      is TrackerEvent.ProviderChange -> {
        putString("type", "providerChange")
        putMap("state", providerStateMap(e.state))
      }
      is TrackerEvent.Heartbeat -> {
        putString("type", "heartbeat")
        putDouble("atMs", e.atMs.toDouble())
      }
      is TrackerEvent.PowerSaveChange -> {
        putString("type", "powerSaveChange")
        putBoolean("enabled", e.enabled)
      }
      is TrackerEvent.SessionInterrupted -> {
        putString("type", "sessionInterrupted")
        putMap("session", sessionMap(e.session))
      }
      is TrackerEvent.Diagnostic -> {
        putString("type", "diagnostic")
        putString("message", e.message)
      }
      is TrackerEvent.Error -> {
        putString("type", "error")
        putString("code", errorCode(e.code))
        putString("message", e.message)
      }
      is TrackerEvent.GeofenceEntered -> {
        putString("type", "geofenceEnter")
        putMap("crossing", crossingFromFence(e.geofence, "enter"))
      }
      is TrackerEvent.GeofenceExited -> {
        putString("type", "geofenceExit")
        putMap("crossing", crossingFromFence(e.geofence, "exit"))
      }
      is TrackerEvent.GeofenceAdded -> {
        putString("type", "geofenceAdded")
        // The WHOLE fence, not just the id — `radiusM` is what the platform actually accepted.
        putMap("geofence", geofenceMap(e.geofence))
      }
      is TrackerEvent.GeofenceRemoved -> {
        putString("type", "geofenceRemoved")
        putString("geofenceId", e.geofenceId)
      }
      is TrackerEvent.BatteryChange -> {
        putString("type", "batteryChange")
        putMap("battery", batteryMap(e.battery))
      }
      // Android-only; no iOS twin. Emitted on a CHANGE to the flag set, not per evaluation.
      is TrackerEvent.IntegrityChange -> {
        putString("type", "integrityChange")
        putMap("report", integrityReportMap(e.report))
      }
      // Android-only (v1.0.1-alpha-08+). The iOS-only `licenseDeactivated` is a different signal:
      // this one fires on every verified check including ACTIVE.
      is TrackerEvent.LicenseChecked -> {
        putString("type", "licenseChecked")
        putMap("info", licenseInfoMap(e.info))
      }
      else -> {
        putString("type", "diagnostic")
        putString("message", "unhandled TrackerEvent: ${e.javaClass.simpleName}")
      }
    }
  }

  // Android live geofence enter/exit carry the FENCE, not a crossing. Synthesise GeofenceCrossing:
  // geofenceId <- fence.id; latitude/longitude/radiusM <- the fence centre; timeMs is ABSENT (no live
  // crossing timestamp). `transition` comes from the event type (enter/exit) — the fence itself has
  // none. (Contrast crossingMap(TrackerGeofenceEvent), used by the STORED getEvents() which HAS a
  // timestampMs.)
  fun crossingFromFence(g: TrackerGeofence, transition: String): WritableMap = Arguments.createMap().apply {
    putString("geofenceId", g.id)
    putString("transition", transition)
    putDouble("latitude", g.latitude)
    putDouble("longitude", g.longitude)
    putDouble("radiusM", g.radiusM.toDouble())
  }

  // ---- LiveTrackUpdate / PuckState (onLiveTrack) ----

  // LiveTrackUpdate → wire (typed). sessionId already the wire name. liveHead is the unsettled
  // head as GeoPoints; frozenTailPolyline stays an encoded polyline.
  fun liveTrackMap(u: LiveTrackUpdate): WritableMap = Arguments.createMap().apply {
    putString("sessionId", u.sessionId)
    putDouble("sequence", u.sequence.toDouble())
    putInt("precision", u.precision)
    putString("frozenTailPolyline", u.frozenTailPolyline)
    putArray("liveHead", Arguments.createArray().apply {
      u.liveHead.forEach { gp ->
        pushMap(Arguments.createMap().apply {
          putDouble("latitude", gp.latitude)
          putDouble("longitude", gp.longitude)
        })
      }
    })
    u.puck?.let { putMap("puck", puckMap(it)) }
  }

  // PuckState → wire. headingDeg (java.lang.Double, nullable) is optional — frozen/absent at low
  // speed.
  fun puckMap(p: PuckState): WritableMap = Arguments.createMap().apply {
    putDouble("latitude", p.latitude)
    putDouble("longitude", p.longitude)
    putDouble("speedMps", p.speedMps.toDouble())
    p.headingDeg?.let { putDouble("headingDeg", it) }
    putDouble("accuracyM", p.accuracyM.toDouble())
  }

  // ---- org.json -> React bridge conversion (event payloads reuse the JSONObject element mappers) ----

  private fun jsonToWritableMap(o: JSONObject): WritableMap = Arguments.createMap().apply {
    val keys = o.keys()
    while (keys.hasNext()) {
      val k = keys.next()
      when (val v = o.get(k)) {
        is JSONObject -> putMap(k, jsonToWritableMap(v))
        is JSONArray -> putArray(k, jsonToWritableArray(v))
        is Boolean -> putBoolean(k, v)
        is Int -> putInt(k, v)
        is Long -> putDouble(k, v.toDouble())
        is Double -> putDouble(k, v)
        is Number -> putDouble(k, v.toDouble())
        is String -> putString(k, v)
        JSONObject.NULL -> putNull(k)
        else -> putString(k, v.toString())
      }
    }
  }

  private fun jsonToWritableArray(a: JSONArray): WritableArray = Arguments.createArray().apply {
    for (i in 0 until a.length()) {
      when (val v = a.get(i)) {
        is JSONObject -> pushMap(jsonToWritableMap(v))
        is JSONArray -> pushArray(jsonToWritableArray(v))
        is Boolean -> pushBoolean(v)
        is Int -> pushInt(v)
        is Long -> pushDouble(v.toDouble())
        is Double -> pushDouble(v)
        is Number -> pushDouble(v.toDouble())
        is String -> pushString(v)
        JSONObject.NULL -> pushNull()
        else -> pushString(v.toString())
      }
    }
  }
}

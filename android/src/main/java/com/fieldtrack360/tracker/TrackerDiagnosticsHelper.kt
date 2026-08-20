package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.field360.traker.geo.model.TrackFix
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.json.JSONArray

// Diagnostics — the Android half. Thin transport over the facade; all wire vocabulary lives in
// TrackerMappers ( rule 2). Suspend reads run on the module-owned scope; a native throw
// becomes a Promise rejection. The thin overrides in TrackerModule pass the facade
// (`Tracker.getInstance(reactApplicationContext)`) and the module-owned `scope` — accessed there
// from inside the module (subclass), which avoids any protected-visibility hop from this object.
//
// offerFix and getSensors are SYNCHRONOUS on the facade (not suspend), so they resolve inline
// without touching the scope.
object Diagnostics {

  // getRawFixes(sessionId) — suspend read; [RawFix] serialized to the wire JSON string.
  fun getRawFixes(facade: Tracker, scope: CoroutineScope, sessionId: String, promise: Promise) {
    scope.launch {
      try {
        val arr = JSONArray()
        facade.getRawFixes(sessionId).forEach { arr.put(TrackerMappers.rawFixJson(it)) }
        promise.resolve(arr.toString())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getRawFixes failed", t)
      }
    }
  }

  // getRawPoints(sessionId) — suspend read; [RawPoint] serialized to the wire JSON string.
  fun getRawPoints(facade: Tracker, scope: CoroutineScope, sessionId: String, promise: Promise) {
    scope.launch {
      try {
        val arr = JSONArray()
        facade.getRawPoints(sessionId).forEach { arr.put(TrackerMappers.rawPointJson(it)) }
        promise.resolve(arr.toString())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getRawPoints failed", t)
      }
    }
  }

  // getDecisions(sessionId?, limit?, offset?) — suspend read; [FixDecision] → wire JSON string.
  // Wire defaults limit=200/offset=0 applied when JS omits them (matches the surface defaults).
  // sessionId is nullable (surface has getDecisions$default + iOS `sessionID: String? = nil`).
  fun getDecisions(
    facade: Tracker,
    scope: CoroutineScope,
    sessionId: String?,
    limit: Double?,
    offset: Double?,
    promise: Promise,
  ) {
    scope.launch {
      try {
        val arr = JSONArray()
        facade.getDecisions(sessionId, limit?.toInt() ?: 200, offset?.toInt() ?: 0)
          .forEach { arr.put(TrackerMappers.fixDecisionJson(it)) }
        promise.resolve(arr.toString())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getDecisions failed", t)
      }
    }
  }

  // getBatteryInfo() — synchronous on the facade; BatteryInfo → wire map. Needs no
  // session, no permission and no ready(), so it is safe to call at any point in the lifecycle.
  fun getBatteryInfo(facade: Tracker, promise: Promise) {
    try {
      promise.resolve(TrackerMappers.batteryMap(facade.batteryInfo()))
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "getBatteryInfo failed", t)
    }
  }

  // getSensors() — synchronous on the facade; DeviceSensors (union) → wire map.
  fun getSensors(facade: Tracker, promise: Promise) {
    try {
      promise.resolve(TrackerMappers.sensorsMap(facade.getSensors()))
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "getSensors failed", t)
    }
  }

  // offerFix(fix) — synchronous on the facade (void); decode the wire TrackFix and hand it to
  // the facade, which validates it (offerFix does NOT bypass validation). A malformed argument is a
  // bridge fault → reject; `invalidConfig` is the established bad-argument reject code.
  fun offerFix(facade: Tracker, fix: ReadableMap, promise: Promise) {
    try {
      facade.offerFix(trackFixFromWire(fix))
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("invalidConfig", t.message ?: "offerFix: malformed fix", t)
    }
  }

  // ios.exportFixture — iOS-only; not a public Android member. Bad argument for this platform.
  fun iosExportFixture(promise: Promise) {
    promise.reject(
      "unsupportedOnPlatform",
      "iosExportFixture is iOS-only; Tracker Android does not expose exportFixture",
    )
  }

  // ios.changePace — iOS-only; changePace is explicitly not a public Android method.
  fun iosChangePace(promise: Promise) {
    promise.reject(
      "unsupportedOnPlatform",
      "iosChangePace is iOS-only; changePace is not a public Android method",
    )
  }

  // Wire TrackFix (src/types) → native `geo.model.TrackFix`. reverse renames are diagnostics-
  // local here: accuracyM→accuracy, altitudeM→altitude, verticalAccuracyM→verticalAccuracy,
  // monotonicNanos→elapsedRealtimeNanos, receivedAtMonotonicNanos→receivedAtElapsedNanos,
  // android.satelliteCount→satelliteCount. Positional to the surface ctor (17 args, in getter
  // order). A missing required key throws → offerFix() catches and rejects `invalidConfig`.
  private fun trackFixFromWire(m: ReadableMap): TrackFix {
    val android = if (m.hasKey("android") && !m.isNull("android")) m.getMap("android") else null
    return TrackFix(
      m.getDouble("timeMs").toLong(),
      if (m.hasKey("monotonicNanos")) m.getDouble("monotonicNanos").toLong() else 0L,
      if (m.hasKey("receivedAtMonotonicNanos")) m.getDouble("receivedAtMonotonicNanos").toLong() else 0L,
      m.getDouble("latitude"),
      m.getDouble("longitude"),
      m.getDouble("accuracyM").toFloat(),
      if (m.hasKey("altitudeM") && !m.isNull("altitudeM")) m.getDouble("altitudeM") else null,
      if (m.hasKey("verticalAccuracyM") && !m.isNull("verticalAccuracyM")) m.getDouble("verticalAccuracyM").toFloat() else null,
      if (m.hasKey("speedMps")) m.getDouble("speedMps").toFloat() else 0f,
      if (m.hasKey("bearingDeg")) m.getDouble("bearingDeg").toFloat() else 0f,
      m.hasKey("hasSpeed") && m.getBoolean("hasSpeed"),
      m.hasKey("hasBearing") && m.getBoolean("hasBearing"),
      if (m.hasKey("provider") && !m.isNull("provider")) m.getString("provider")!! else TrackFix.UNKNOWN_PROVIDER,
      m.hasKey("isMock") && m.getBoolean("isMock"),
      if (android != null && android.hasKey("satelliteCount") && !android.isNull("satelliteCount")) android.getInt("satelliteCount") else null,
      if (m.hasKey("speedAccuracyMps") && !m.isNull("speedAccuracyMps")) m.getDouble("speedAccuracyMps").toFloat() else null,
      if (m.hasKey("bearingAccuracyDeg") && !m.isNull("bearingAccuracyDeg")) m.getDouble("bearingAccuracyDeg").toFloat() else null,
    )
  }
}
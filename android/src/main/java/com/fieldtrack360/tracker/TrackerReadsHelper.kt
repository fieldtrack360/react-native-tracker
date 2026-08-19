package com.fieldtrack360.tracker

import com.field360.tracker.domain.model.PointQuery
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.launch
import org.json.JSONArray

// reads. Thin suspend sequencing over the module facade (Tracker.getInstance(ctx)), launched
// on the module-owned CoroutineScope. Android reads are bare `suspend` returning unwrapped values
// (no TrackerResult), so a throw REJECTS the Promise. All wire vocabulary/renames live in
// TrackerMappers; the list→JSON-string serialization for the unbounded getPoints happens here.
//
// REQUIRES the shared module scaffold on TrackerModule to expose:
//   internal val scope: CoroutineScope        // module-owned, cancelled in invalidate()
//   internal val tracker: Tracker get() = Tracker.getInstance(reactApplicationContext)
// (reactApplicationContext is `protected` on ReactContextBaseJavaModule, so the facade/scope must
// be surfaced by the module for this same-package helper to reach them.)
object TrackerReadsHelper {

  // Build a native PointQuery WITHOUT normalizing: override only the fields the caller
  // supplied so the SDK's own defaults apply (limit default 500, offset 0 — read off PointQuery()
  // rather than hardcoded). Inbound arg decode; `sessionId` is already the Android name.
  private fun pointQuery(args: ReadableMap?): PointQuery {
    val base = PointQuery()
    if (args == null) return base
    return base.copy(
      sessionId = if (args.hasKey("sessionId") && !args.isNull("sessionId")) args.getString("sessionId") else base.sessionId,
      fromMs = if (args.hasKey("fromMs") && !args.isNull("fromMs")) args.getDouble("fromMs").toLong() else base.fromMs,
      toMs = if (args.hasKey("toMs") && !args.isNull("toMs")) args.getDouble("toMs").toLong() else base.toMs,
      limit = if (args.hasKey("limit") && !args.isNull("limit")) args.getDouble("limit").toInt() else base.limit,
      offset = if (args.hasKey("offset") && !args.isNull("offset")) args.getDouble("offset").toInt() else base.offset,
    )
  }

  // getPoints(query?) → JSON string (unbounded). Per-point map via
  // TrackerMappers.trackPointJson; the list is serialized to the wire JSON string here.
  fun getPoints(module: TrackerModule, query: ReadableMap?, promise: Promise) {
    val q = pointQuery(query)
    module.scope.launch {
      try {
        val points = module.tracker.getPoints(q)
        val arr = JSONArray()
        points.forEach { arr.put(TrackerMappers.trackPointJson(it)) }
        promise.resolve(arr.toString())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getPoints failed", t)
      }
    }
  }

  // getCount(query?) → number.
  fun getCount(module: TrackerModule, query: ReadableMap?, promise: Promise) {
    val q = pointQuery(query)
    module.scope.launch {
      try {
        val count = module.tracker.getCount(q)
        promise.resolve(count.toDouble())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getCount failed", t)
      }
    }
  }

  // getOdometerMeters() → number (meters).
  fun getOdometerMeters(module: TrackerModule, promise: Promise) {
    module.scope.launch {
      try {
        promise.resolve(module.tracker.getOdometerMeters())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getOdometerMeters failed", t)
      }
    }
  }

  // getSessions(fromMs?, toMs?) → TrackSession[] (typed). Nil filters pass through as the
  // facade's own `null` defaults (no normalization). Per-session map via TrackerMappers.sessionMap.
  fun getSessions(module: TrackerModule, fromMs: Double?, toMs: Double?, promise: Promise) {
    module.scope.launch {
      try {
        val sessions = module.tracker.getSessions(fromMs?.toLong(), toMs?.toLong())
        val arr = Arguments.createArray()
        sessions.forEach { arr.pushMap(TrackerMappers.sessionMap(it)) }
        promise.resolve(arr)
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getSessions failed", t)
      }
    }
  }

  // currentSession() → TrackSession | null.
  fun currentSession(module: TrackerModule, promise: Promise) {
    module.scope.launch {
      try {
        val session = module.tracker.currentSession()
        promise.resolve(session?.let { TrackerMappers.sessionMap(it) })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "currentSession failed", t)
      }
    }
  }
}
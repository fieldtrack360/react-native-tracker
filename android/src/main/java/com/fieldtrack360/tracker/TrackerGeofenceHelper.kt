package com.fieldtrack360.tracker

import com.field360.tracker.domain.model.TrackerResult
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.launch

// Geofencing — Android half. add/remove/removeAll are suspend (run on module.scope);
// list/get/getEvents/deleteEvents are synchronous facade reads (also run on the scope to keep DB
// work off the caller thread). Return types are the Android TrackerResult shape; the c/d
// refusals are enforced HERE before the native fence is built (Android has no notify booleans/dwell).
object GeofenceModule {

  private fun okResult(value: Any?): WritableMap = Arguments.createMap().apply {
    putBoolean("ok", true)
    when (value) {
      is WritableMap -> putMap("value", value)
      is Boolean -> putBoolean("value", value)
      is Int -> putDouble("value", value.toDouble())
      else -> {}
    }
  }

  private fun errResult(code: String, message: String): WritableMap = Arguments.createMap().apply {
    putBoolean("ok", false)
    putString("code", code)
    putString("message", message)
  }

  // c/d: an explicit notifyOnEntry/Exit=false or a dwellAfterMs has no Android representation
  // → refuse with invalidConfig naming the field (common path — both flags default true — stays
  // common).
  fun add(module: TrackerModule, fence: ReadableMap, promise: Promise) {
    if (fence.hasKey("notifyOnEntry") && !fence.isNull("notifyOnEntry") && !fence.getBoolean("notifyOnEntry")) {
      return promise.resolve(errResult("invalidConfig", "notifyOnEntry=false has no Android representation"))
    }
    if (fence.hasKey("notifyOnExit") && !fence.isNull("notifyOnExit") && !fence.getBoolean("notifyOnExit")) {
      return promise.resolve(errResult("invalidConfig", "notifyOnExit=false has no Android representation"))
    }
    if (fence.hasKey("dwellAfterMs") && !fence.isNull("dwellAfterMs")) {
      return promise.resolve(errResult("invalidConfig", "dwellAfterMs is iOS-only"))
    }
    module.scope.launch {
      try {
        val built = TrackerMappers.geofenceBuild(fence)
        when (val r = module.tracker.addGeofence(built)) {
          is TrackerResult.Ok -> promise.resolve(okResult(TrackerMappers.geofenceMap(r.value)))
          is TrackerResult.Error -> promise.resolve(errResult(TrackerMappers.errorCode(r.code), r.message))
        }
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceAdd failed", t)
      }
    }
  }

  fun list(module: TrackerModule, promise: Promise) {
    module.scope.launch {
      try {
        val arr = Arguments.createArray()
        module.tracker.getGeofences().forEach { arr.pushMap(TrackerMappers.geofenceMap(it)) }
        promise.resolve(arr)
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceList failed", t)
      }
    }
  }

  fun get(module: TrackerModule, id: String, promise: Promise) {
    module.scope.launch {
      try {
        val g = module.tracker.getGeofence(id)
        promise.resolve(g?.let { TrackerMappers.geofenceMap(it) })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceGet failed", t)
      }
    }
  }

  fun remove(module: TrackerModule, id: String, promise: Promise) {
    module.scope.launch {
      try {
        when (val r = module.tracker.removeGeofence(id)) {
          is TrackerResult.Ok -> promise.resolve(okResult(r.value))
          is TrackerResult.Error -> promise.resolve(errResult(TrackerMappers.errorCode(r.code), r.message))
        }
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceRemove failed", t)
      }
    }
  }

  fun removeAll(module: TrackerModule, promise: Promise) {
    module.scope.launch {
      try {
        when (val r = module.tracker.removeAllGeofences()) {
          is TrackerResult.Ok -> promise.resolve(okResult(r.value))
          is TrackerResult.Error -> promise.resolve(errResult(TrackerMappers.errorCode(r.code), r.message))
        }
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceRemoveAll failed", t)
      }
    }
  }

  // getEvents is the source of truth. fromMs/toMs are honoured on both platforms (iOS gained
  // them in SDK 1.0.5).
  fun getEvents(module: TrackerModule, opts: ReadableMap?, promise: Promise) {
    module.scope.launch {
      try {
        val id = if (opts?.hasKey("geofenceId") == true && !opts.isNull("geofenceId")) opts.getString("geofenceId") else null
        val fromMs = if (opts?.hasKey("fromMs") == true && !opts.isNull("fromMs")) opts.getDouble("fromMs").toLong() else null
        val toMs = if (opts?.hasKey("toMs") == true && !opts.isNull("toMs")) opts.getDouble("toMs").toLong() else null
        val limit = if (opts?.hasKey("limit") == true && !opts.isNull("limit")) opts.getDouble("limit").toInt() else 200
        val offset = if (opts?.hasKey("offset") == true && !opts.isNull("offset")) opts.getDouble("offset").toInt() else 0
        val events = module.tracker.getGeofenceEvents(id, fromMs, toMs, limit, offset)
        val arr = Arguments.createArray()
        events.forEach { arr.pushMap(TrackerMappers.crossingMap(it)) }
        promise.resolve(arr)
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceGetEvents failed", t)
      }
    }
  }

  // deleteEvents(opts?) — { geofenceId?, fromMs?, toMs? }, the same window getEvents takes. The
  // public API's (geofenceId?, window?) pair is folded into one object in JS.
  fun deleteEvents(module: TrackerModule, opts: ReadableMap?, promise: Promise) {
    module.scope.launch {
      try {
        val id = if (opts?.hasKey("geofenceId") == true && !opts.isNull("geofenceId")) opts.getString("geofenceId") else null
        val fromMs = if (opts?.hasKey("fromMs") == true && !opts.isNull("fromMs")) opts.getDouble("fromMs").toLong() else null
        val toMs = if (opts?.hasKey("toMs") == true && !opts.isNull("toMs")) opts.getDouble("toMs").toLong() else null
        val count = module.tracker.deleteGeofenceEvents(id, fromMs, toMs)
        promise.resolve(count.toDouble())
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "geofenceDeleteEvents failed", t)
      }
    }
  }
}

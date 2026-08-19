package com.fieldtrack360.tracker

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.launch

// Plotting — buildTrack / exportPolylineJson / exportGeoJson. Per-subsystem helper the thin
// TrackerModule overrides delegate to (rule 2). Each runs the suspend facade call on the
// module-owned CoroutineScope (`module.scope`) against the facade (`module.tracker`) and maps via
// TrackerMappers. These are reads: a native throw rejects the Promise.
//
// Mapping: buildTrack maps the native `Track` OBJECT to the one wire JSON string via the foundation
// mapper TrackerMappers.trackJson (there is no native JSON string to decode; the two SDKs'
// @Serializable / Codable JSON diverge hard — see TrackerMappers). export* return the SDK's JSON
// string directly (pass-through, no mapper). Android facade names are exportPolylineJson /
// exportGeoJson (lower json), matching the JS/bridge names.
//
// Depends on two public members the assembled TrackerModule exposes: `val scope: CoroutineScope`
// (module-owned) and `val tracker: Tracker` (= Tracker.getInstance(reactApplicationContext); the
// context is protected, so the facade is reached through the module). Also depends on foundation
// input mappers TrackerMappers.pointQuery(ReadableMap?): PointQuery and
// TrackerMappers.trackOptions(ReadableMap?): TrackOptions, both returning the SDK defaults
// (PointQuery() / TrackOptions()) when the map is null (JS omitted the arg).
object PlottingModule {

  fun buildTrack(module: TrackerModule, query: ReadableMap?, options: ReadableMap?, promise: Promise) {
    val q = TrackerMappers.pointQuery(query)
    val o = TrackerMappers.trackOptions(options)
    module.scope.launch {
      try {
        val track = module.tracker.buildTrack(q, o)
        promise.resolve(TrackerMappers.trackJson(track))
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "buildTrack failed", t)
      }
    }
  }

  fun exportPolylineJson(module: TrackerModule, query: ReadableMap?, options: ReadableMap?, promise: Promise) {
    val q = TrackerMappers.pointQuery(query)
    val o = TrackerMappers.trackOptions(options)
    module.scope.launch {
      try {
        promise.resolve(module.tracker.exportPolylineJson(q, o))
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "exportPolylineJson failed", t)
      }
    }
  }

  fun exportGeoJson(module: TrackerModule, query: ReadableMap?, options: ReadableMap?, promise: Promise) {
    val q = TrackerMappers.pointQuery(query)
    val o = TrackerMappers.trackOptions(options)
    module.scope.launch {
      try {
        promise.resolve(module.tracker.exportGeoJson(q, o))
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "exportGeoJson failed", t)
      }
    }
  }
}
package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.field360.traker.geo.port.RoadSnapProvider
import com.field360.traker.snap.OsrmSnapProvider
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap

// Road snapping — per-subsystem helper behind the thin TrackerModule overrides. Both facade
// calls (Tracker.setRoadSnapProvider — Tracker.txt:59) are synchronous, non-suspend voids, so
// there is NO coroutine and no use of the module's CoroutineScope here: the helper runs inline
// and resolves/rejects immediately.
//
// The facade is reached through the module's ReactApplicationContext. getReactApplicationContext()
// is Java-`protected` on ReactContextBaseJavaModule, which grants same-package access, and this
// helper is in the codegen package com.fieldtrack360.tracker — so `module.appContext`
// resolves.
//
// Mappers: this subsystem calls NO TrackerMappers functions — inputs are plain strings, return is
// void, nothing to normalize.
object SnapHelper {

  // setOsrmSnapProvider. Android OsrmSnapProvider takes the baseUrl as a plain String (no URL
  // parse, so no invalidConfig-on-unparseable branch — that is an iOS-only concern). A missing
  // baseUrl is a bad argument and rejects `invalidConfig`. `profile` absent/null => omit it
  // so the SDK default (DEFAULT_PROFILE) applies. Every constructor param after baseUrl is
  // defaulted (companion DEFAULT_* consts + the synthesized DefaultConstructorMarker ctor,
  // OsrmSnapProvider.txt:21-22), so positional OsrmSnapProvider(baseUrl[, profile]) compiles.
  fun setOsrmSnapProvider(module: TrackerModule, config: ReadableMap, promise: Promise) {
    try {
      val baseUrl = config.getString("baseUrl")
        ?: return promise.reject("invalidConfig", "setOsrmSnapProvider: baseUrl is required")
      val profile = config.getString("profile")
      val provider =
        if (profile != null) OsrmSnapProvider(baseUrl, profile)
        else OsrmSnapProvider(baseUrl)
      Tracker.getInstance(module.appContext).setRoadSnapProvider(provider)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "setOsrmSnapProvider failed", t)
    }
  }

  // clearRoadSnapProvider. Android has a first-class disable: RoadSnapProvider.Disabled
  // (RoadSnapPort.txt:12-13, the INSTANCE object). Installing it makes buildTrack keep raw
  // geometry. Cannot fail on the happy path => resolves void.
  fun clearRoadSnapProvider(module: TrackerModule, promise: Promise) {
    try {
      Tracker.getInstance(module.appContext)
        .setRoadSnapProvider(RoadSnapProvider.Disabled)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "clearRoadSnapProvider failed", t)
    }
  }
}
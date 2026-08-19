package com.fieldtrack360.tracker

import com.field360.traker.geo.model.GeoPoint
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableArray

// live surface — setActiveRoute / isOffRoute. `onLiveTrack` is Phase 4, not here.
//
// GROUND-TRUTH divergence: both facade methods are SYNCHRONOUS on the Android surface
//   `public final void setActiveRoute(java.util.List<...GeoPoint>);`   (Tracker.txt:53)
//   `public final boolean isOffRoute();`                              (Tracker.txt:54)
// Neither is `suspend` (no Continuation parameter), so — unlike the suspend reads — there is
// NO coroutine hop and `module.scope` is not used: we call directly and resolve. A bridge fault
// (bad args, pre-init NPE) rejects. The bridge method itself stays Promise-returning.
//
// Relies on TrackerModule exposing the facade accessor `internal val tracker: Tracker`
// (`= Tracker.getInstance(reactApplicationContext)`); `reactApplicationContext` is protected and
// unreachable from this object directly. No TrackerMappers output mapper is used (void/boolean
// returns). GeoPoint arg decode is inline — the foundation mappers are native→wire (output) only.
object LiveModule {

  // setActiveRoute(points): projects the live puck only; never mutates stored evidence or
  // historical tracks. An empty array clears the route (passed through — native behaviour).
  // GeoPoint(double, double) is (latitude, longitude) per GeoPoint.txt getLatitude/getLongitude.
  fun setActiveRoute(module: TrackerModule, points: ReadableArray, promise: Promise) {
    try {
      val route = ArrayList<GeoPoint>(points.size())
      for (i in 0 until points.size()) {
        val m = points.getMap(i) ?: continue
        route.add(GeoPoint(m.getDouble("latitude"), m.getDouble("longitude")))
      }
      module.tracker.setActiveRoute(route)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "setActiveRoute failed", t)
    }
  }

  // isOffRoute(): whether the current live puck has diverged from the active route.
  fun isOffRoute(module: TrackerModule, promise: Promise) {
    try {
      promise.resolve(module.tracker.isOffRoute())
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "isOffRoute failed", t)
    }
  }
}
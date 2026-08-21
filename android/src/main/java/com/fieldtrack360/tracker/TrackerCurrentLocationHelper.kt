package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.field360.tracker.domain.model.TrackerResult
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import kotlinx.coroutines.launch

// currentLocation subsystem — thin sequencing over the suspend facade. The TrackerModule
// override delegates here; all wire vocabulary/renames live in TrackerMappers (rule 2).
object CurrentLocationBridge {

  // getCurrentLocation(): Promise<TrackerResult<TrackFix>>.
  // Surface (Tracker.txt:49):
  //   `public final java.lang.Object getCurrentLocation(
  //      kotlin.coroutines.Continuation<? super TrackerResult<TrackFix>>)`
  // i.e. a `suspend` fun with NO parameter. The fix is reported and never fed to the ingestor.
  // Domain failures (TrackerResult.Error) resolve ok:false; a genuine throw is a bridge fault → reject.
  fun getCurrentLocation(module: TrackerModule, promise: Promise) {
    // suspend read on the module-owned CoroutineScope (/ threading).
    module.scope.launch {
      try {
        when (val result =
          Tracker.getInstance(module.appContext).getCurrentLocation()) {
          is TrackerResult.Ok -> promise.resolve(
            Arguments.createMap().apply {
              putBoolean("ok", true)
              putMap("value", TrackerMappers.trackFixMap(result.value))
            }
          )
          is TrackerResult.Error -> promise.resolve(
            Arguments.createMap().apply {
              putBoolean("ok", false)
              // ErrorCode -> wire string via the foundation enum/rename helper (special-cases
              // INTERNAL -> internalError; SCREAMING_SNAKE -> lowerCamel otherwise).
              putString("code", TrackerMappers.errorCode(result.code))
              putString("message", result.message)
            }
          )
        }
      } catch (t: Throwable) {
        // Bridge fault (not a domain failure) → reject.
        promise.reject("internalError", t.message ?: "getCurrentLocation failed", t)
      }
    }
  }
}
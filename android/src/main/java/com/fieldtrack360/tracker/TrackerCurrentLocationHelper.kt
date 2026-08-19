package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.field360.tracker.domain.model.TrackerResult
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.launch

// currentLocation subsystem — thin sequencing over the suspend facade. The TrackerModule
// override delegates here; all wire vocabulary/renames live in TrackerMappers (rule 2).
object CurrentLocationBridge {

  // getCurrentLocation(options?): Promise<TrackerResult<TrackFix>>.
  // Surface (Tracker.txt:49):
  //   `public final java.lang.Object getCurrentLocation(
  //      kotlin.coroutines.Continuation<? super TrackerResult<TrackFix>>)`
  // i.e. a `suspend` fun with NO parameter — Android has no feedIngestor. Per:
  //   - feedIngestor absent/false  -> identical to iOS (the common path).
  //   - feedIngestor == true       -> a bad ARGUMENT for this platform: REJECT with bridge code
  //     `unsupportedOnPlatform`, naming platform + param (NOT a domain ok:false). Silently
  //     ignoring it would leave a host believing its fix was ingested when Android never does so.
  // Domain failures (TrackerResult.Error) resolve ok:false; a genuine throw is a bridge fault → reject.
  fun getCurrentLocation(module: TrackerModule, options: ReadableMap?, promise: Promise) {
    val feedIngestor =
      options != null &&
        options.hasKey("feedIngestor") &&
        !options.isNull("feedIngestor") &&
        options.getBoolean("feedIngestor")

    if (feedIngestor) {
      promise.reject(
        "unsupportedOnPlatform",
        "getCurrentLocation(feedIngestor: true) is unsupported on Android: the Android SDK's " +
          "getCurrentLocation() never feeds the ingestor (the fix is not persisted and emits no " +
          "location event). Call without feedIngestor, or use iOS for pipeline ingestion."
      )
      return
    }

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
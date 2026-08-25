package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.field360.tracker.TrackerConfig
import com.field360.tracker.domain.model.TrackerResult
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.launch
import org.json.JSONObject

// lifecycle — ready / start / stop. Thin sequencing over Tracker.getInstance(ctx); the facade
// calls are `suspend` and run on the module-owned CoroutineScope `module.scope`. Result
// policy: a DOMAIN failure RESOLVES { ok:false, code, message }; the Promise REJECTS
// only for a bridge fault — undecodable/invalid config JSON here. All wire vocabulary
// (enum casing, field renames, the ErrorCode rename) lives in TrackerMappers.
//
// Dependencies (foundation / config subsystem):
//   - module.scope: CoroutineScope            (module-owned)
//   - TrackerMappers.decodeConfig(String): TrackerConfig  — may throw on bad/invalid JSON
//   - TrackerMappers.stateMap(TrackerState): WritableMap
//   - TrackerMappers.sessionMap(TrackSession): WritableMap
//   - TrackerMappers.errorCode(ErrorCode): String         — (INTERNAL → internalError etc.)
object LifecycleModule {

  // ready(config?). configJson is the config JSON string (null → SDK defaults). A
  // decode throw (undecodable JSON or config refusal) is a bridge fault → reject invalidConfig.
  fun ready(module: TrackerModule, configJson: String?, promise: Promise) {
    module.scope.launch {
      val config: TrackerConfig = try {
        if (configJson != null) TrackerMappers.decodeConfig(configJson) else TrackerConfig()
      } catch (t: Throwable) {
        promise.reject("invalidConfig", t.message ?: "invalid config JSON", t)
        return@launch
      }
      // Headless is ours, not the SDK's: `enableHeadless` is not a TrackerConfig field, so it is
      // read straight off the wire JSON. It is paired with the SDK's own stopOnTerminate because
      // the two are one decision — see TrackerHeadlessPrefs.isEnabled.
      TrackerHeadlessPrefs.store(
        module.appContext,
        enableHeadless = configJson?.let { enableHeadless(it) } ?: false,
        stopOnTerminate = config.service.stopOnTerminate,
      )
      TrackerHeadlessDispatcher.install(module.appContext)
      try {
        val result = Tracker.getInstance(module.appContext).ready(config)
        promise.resolve(resultMap(result) { TrackerMappers.stateMap(it) })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "ready failed", t)
      }
    }
  }

  // start(tag?). Domain failure resolves ok:false; an unexpected throw rejects (bridge fault).
  fun start(module: TrackerModule, tag: String?, promise: Promise) {
    module.scope.launch {
      try {
        val result = Tracker.getInstance(module.appContext).start(tag)
        promise.resolve(resultMap(result) { TrackerMappers.sessionMap(it) })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "start failed", t)
      }
    }
  }

  // stop(). Android's TrackerResult<TrackSession> always carries the closed session on Ok
  // (iOS may be null); on the wire `value` is TrackSession | null.
  fun stop(module: TrackerModule, promise: Promise) {
    module.scope.launch {
      try {
        val result = Tracker.getInstance(module.appContext).stop()
        // stop() is the one lifecycle call whose success value is NULLABLE on the wire
        // (TrackSession | null) — resultMap is <T : Any> and cannot carry it, so the
        // envelope is built here with an explicit null rather than by loosening resultMap for
        // every caller.
        promise.resolve(
          Arguments.createMap().apply {
            when (result) {
              is TrackerResult.Ok -> {
                putBoolean("ok", true)
                val session = result.value
                if (session == null) putNull("value") else putMap("value", TrackerMappers.sessionMap(session))
              }
              is TrackerResult.Error -> {
                putBoolean("ok", false)
                putString("code", TrackerMappers.errorCode(result.code))
                putString("message", result.message)
              }
            }
          }
        )
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "stop failed", t)
      }
    }
  }

  // `android.enableHeadless` off the raw wire config. Malformed JSON never reaches here —
  // decodeConfig has already parsed the same string — so a throw would be a contradiction, not a
  // case to handle; an absent key is simply false.
  private fun enableHeadless(configJson: String): Boolean =
    JSONObject(configJson).optJSONObject("android")?.optBoolean("enableHeadless") ?: false

  // TrackerResult<T> → wire envelope. Ok → { ok:true, value }; Error → { ok:false, code, message }.
  // All three lifecycle values are non-null (T : Any), so Ok always carries a mapped value.
  private inline fun <T : Any> resultMap(
    result: TrackerResult<T>,
    valueMap: (T) -> WritableMap,
  ): WritableMap = Arguments.createMap().apply {
    when (result) {
      is TrackerResult.Ok -> {
        putBoolean("ok", true)
        putMap("value", valueMap(result.value))
      }
      is TrackerResult.Error -> {
        putBoolean("ok", false)
        putString("code", TrackerMappers.errorCode(result.code))
        putString("message", result.message)
      }
    }
  }
}
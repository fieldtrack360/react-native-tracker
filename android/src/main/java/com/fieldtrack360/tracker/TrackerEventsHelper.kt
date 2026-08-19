// android/src/main/java/com/fieldtrack360/tracker/TrackerEventsHelper.kt
package com.fieldtrack360.tracker

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.launch
import org.json.JSONArray
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

// Phase 4 subscription layer — Android half. ONE Job per active JS subscriber on the module's
// CoroutineScope, cancelled on unsubscribe. subscribe(stream, arg?) launches the Job and resolves its
// subscription id; unsubscribe(id) cancels it. Each collected value is emitted as a single device
// event "TrackerEmit" with body { id, payload } via RCTDeviceEventEmitter; JS (src/events.ts) routes
// by id. Buffering is preserved, never widened:
//   - events:        tracker.events IS the native SharedFlow (depth 64 / DROP_OLDEST, replay 0); a
//                    plain collect inherits it, no extra buffer.
//   - liveTrack:     .conflate() = capacity 1, newest-wins — a frame is a replacement.
//   - state / providerState: StateFlow already conflates to the latest value.
// All wire vocabulary lives in TrackerMappers.
//
// Streams (Tracker.txt): events = getEvents():SharedFlow; liveTrack():Flow;
// observePoints(String):Flow<List<TrackPoint>>; providerState():StateFlow;
// state = getState():StateFlow.
object TrackerEventsHelper {

  private val nextId = AtomicInteger(1)
  private val jobs = ConcurrentHashMap<Int, Job>()

  fun subscribe(module: TrackerModule, stream: String, arg: String?, promise: Promise) {
    val id = nextId.getAndIncrement()
    val job: Job = when (stream) {
      "events" -> module.scope.launch {
        module.tracker.events.collect { emit(module, id, TrackerMappers.eventMap(it)) }
      }
      "liveTrack" -> module.scope.launch {
        module.tracker.liveTrack().conflate().collect { emit(module, id, TrackerMappers.liveTrackMap(it)) }
      }
      "observePoints" -> {
        val sessionId = arg ?: ""
        module.scope.launch {
          module.tracker.observePoints(sessionId).collect { points ->
            val arr = JSONArray()
            points.forEach { arr.put(TrackerMappers.trackPointJson(it)) }
            emit(module, id, arr.toString())
          }
        }
      }
      // batteryState() — StateFlow, so collect replays the current reading on attach and then
      // emits one value per transition. Android-only; iOS rejects this stream name.
      "battery" -> module.scope.launch {
        module.tracker.batteryState().collect { emit(module, id, TrackerMappers.batteryMap(it)) }
      }
      "providerState" -> module.scope.launch {
        module.tracker.providerState().collect { emit(module, id, TrackerMappers.providerStateMap(it)) }
      }
      "state" -> module.scope.launch {
        module.tracker.state.collect { emit(module, id, TrackerMappers.stateMap(it)) }
      }
      else -> {
        promise.reject("invalidConfig", "unknown stream: $stream")
        return
      }
    }
    jobs[id] = job
    promise.resolve(id)
  }

  fun unsubscribe(module: TrackerModule, id: Int, promise: Promise) {
    jobs.remove(id)?.cancel()
    promise.resolve(null)
  }

  // ONE device event carries { id, payload }. payload is a WritableMap for the typed streams and a
  // JSON string for the unbounded point list. Guard on an active React instance — a collect
  // that outlives teardown must not touch a dead instance.
  private fun emit(module: TrackerModule, id: Int, payload: Any?) {
    val ctx = module.appContext
    if (!ctx.hasActiveReactInstance()) return
    val body: WritableMap = Arguments.createMap().apply {
      putInt("id", id)
      when (payload) {
        is WritableMap -> putMap("payload", payload)
        is String -> putString("payload", payload)
        else -> putNull("payload")
      }
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("TrackerEmit", body)
  }
}
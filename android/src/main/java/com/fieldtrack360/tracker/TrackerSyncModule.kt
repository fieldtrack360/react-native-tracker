package com.fieldtrack360.tracker

import com.field360.traker.sync.TrackerSync
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

// Second TurboModule — the SEPARATE "TrackerSync" module over TrackerSync.getInstance(ctx).
// Distinct from TrackerModule. Overrides are THIN and delegate wire vocabulary to SyncMappers; no
// behaviour here. Surface it drives:
//   getInstance(Context)                                   (:15)
//   configure(SyncConfig, SyncTransport?)                  (:20) — transport optional via configure$default (:14)
//   requestSync()                                          (:22) — synchronous void
//   pendingCount(Continuation<Integer>)                    (:21) — suspend -> Int
//   syncNow(Continuation<SyncQueue$Result>)                (:23) — suspend -> SyncQueue.Result
//   events: SharedFlow<SyncEvent>                                 — the sync event stream
class TrackerSyncModule(reactContext: ReactApplicationContext) :
  NativeTrackerSyncSpec(reactContext) {

  // Module-owned scope for the suspend facade calls and the event-stream collects, cancelled in
  // invalidate().
  private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val sync: TrackerSync get() = TrackerSync.getInstance(reactApplicationContext)

  // One collect Job per active JS subscriber to onSyncEvent, keyed by the id handed back to JS.
  private val nextSubscriptionId = AtomicInteger(1)
  private val jobs = ConcurrentHashMap<Int, Job>()

  // configure(configJson). The SyncConfig crosses as a JSON string; the Android mapper reads
  // shared + android.requiresUnmeteredNetwork only (the iOS gate/fields are ignored — the two network
  // gates are NOT unified). Android url is a plain String, so there is no unparseable-url path (that
  // is iOS-only); undecodable JSON is one bridge fault → reject invalidConfig (mirrors ready()).
  // configure is synchronous on the facade (not suspend), so it resolves inline. There is NO Android
  // equivalent of iOS's pendingUploads / setSyncTrigger wiring.
  //
  // The facade also runs SyncConfig.validate() and THROWS IllegalArgumentException on a cleartext
  // url, an unsupported verb (only POST/PUT/PATCH reach Retrofit) or an out-of-range batchSize.
  // Those are the host's own bad argument, so they reject invalidConfig too rather than
  // internalError — same class of fault as undecodable JSON, and the message names what is wrong.
  override fun configure(configJson: String, promise: Promise) {
    val config = try {
      SyncMappers.syncConfigFromWire(configJson)
    } catch (t: Throwable) {
      promise.reject("invalidConfig", t.message ?: "invalid sync config JSON", t)
      return
    }
    try {
      sync.configure(config)
      promise.resolve(null)
    } catch (t: IllegalArgumentException) {
      promise.reject("invalidConfig", t.message ?: "invalid sync config", t)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "configure failed", t)
    }
  }

  // requestSync() — synchronous void; forwards only. Callable after accepted points even when
  // autoSync is true (Android does not auto-enqueue the worker on accepted-point events).
  override fun requestSync(promise: Promise) {
    try {
      sync.requestSync()
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "requestSync failed", t)
    }
  }

  // syncNow() — suspend read on the module scope → uploaded / empty / retry / authExpired, plus
  // the Android-only forbidden (403). See SyncMappers.syncResultMap.
  override fun syncNow(promise: Promise) {
    scope.launch {
      try {
        promise.resolve(SyncMappers.syncResultMap(sync.syncNow()))
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "syncNow failed", t)
      }
    }
  }

  // pendingCount() -> TrackerResult<number>. The native call returns a BARE Int; the Android
  // mapper WRAPS it in { ok:true, value } (iOS has a native TrackerResult; Android does not here).
  override fun pendingCount(promise: Promise) {
    scope.launch {
      try {
        val count = sync.pendingCount()
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", true)
          putInt("value", count)
        })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "pendingCount failed", t)
      }
    }
  }

  // ── Session logs (Android SDK 1.0.10) ────────────────────────────────────────
  // The SECOND channel on this facade — its own endpoint, its own database file, its own worker.
  // ANDROID-ONLY: the iOS SDK has no counterpart, so the iOS module answers every one of these
  // with `unsupportedOnPlatform`. Surface it drives:
  //   configureLogs(LogSyncConfig, SyncTransport?)  requestLogSync()      disableLogSync()
  //   log(level, tag, message, code?, data?)        logLifecycle(phase, tag)
  //   getLogs(sessionId?, limit, offset)            pendingLogCount()     syncLogsNow()
  //   logEvents: SharedFlow<SyncEvent>              logEndpoint / isLogSyncConfigured
  //
  // Nothing here can reach Tracker.stop(), the point queue, or a row of track_point — the buffer
  // is a different database, which is the whole reason the channel is safe to point at a separate
  // endpoint with separate credentials.

  // androidConfigureLogs(configJson). The LogSyncConfig crosses as a JSON string. An ABSENT url is
  // meaningful and is the intended default — configureLogs() then resolves the endpoint from the
  // points SyncConfig in force plus `v1/logs/batch` and inherits its device_id and headers — so
  // the mapper never substitutes one. `configureLogs` is synchronous on the facade and THROWS
  // IllegalArgumentException on anything LogSyncConfig.validate() reports, which is the host's own
  // bad argument: reject invalidConfig, exactly as configure() does.
  override fun androidConfigureLogs(configJson: String, promise: Promise) {
    val config = try {
      SyncMappers.logSyncConfigFromWire(configJson)
    } catch (t: Throwable) {
      promise.reject("invalidConfig", t.message ?: "invalid log sync config JSON", t)
      return
    }
    try {
      sync.configureLogs(config)
      promise.resolve(null)
    } catch (t: IllegalArgumentException) {
      promise.reject("invalidConfig", t.message ?: "invalid log sync config", t)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "configureLogs failed", t)
    }
  }

  // androidDisableLogSync() — stops shipping and cancels the worker. The buffer is NOT wiped, so a
  // later androidConfigureLogs() resumes with what is still in it. That is also the recovery path
  // from a terminal `rejected` result.
  override fun androidDisableLogSync(promise: Promise) {
    try {
      sync.disableLogSync()
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "disableLogSync failed", t)
    }
  }

  // androidLog(entry) — one host entry, recorded as type MESSAGE. `level` is the wire vocabulary;
  // an unrecognised one is the host's own bad argument and rejects rather than being silently
  // downgraded to INFO, because a level that does not mean what the caller wrote is a filtering
  // decision made behind their back. `code`/`data` are optional and stay null when absent.
  override fun androidLog(
    level: String,
    tag: String,
    message: String,
    code: String?,
    data: String?,
    promise: Promise,
  ) {
    val parsed = SyncMappers.logLevel(level)
    if (parsed == null) {
      promise.reject("invalidConfig", "log level must be one of debug/info/warn/error, got '$level'")
      return
    }
    try {
      sync.log(level = parsed, tag = tag, message = message, code = code, data = data)
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "log failed", t)
    }
  }

  // androidLogLifecycle(phase, tag). `tag` defaults to the SDK's own "Host" when JS omits it.
  override fun androidLogLifecycle(phase: String, tag: String?, promise: Promise) {
    try {
      sync.logLifecycle(phase, tag ?: "Host")
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "logLifecycle failed", t)
    }
  }

  // androidGetLogs(sessionId?, limit?, offset?) — suspend read on the module scope. The SDK's own
  // defaults (limit 200 / offset 0) are restated here because getLogs is @JvmOverloads rather than
  // a builder: there is no way to say "leave this one alone" through a positional call.
  override fun androidGetLogs(
    sessionId: String?,
    limit: Double?,
    offset: Double?,
    promise: Promise,
  ) {
    val resolvedLimit = limit?.toInt() ?: DEFAULT_LOG_LIMIT
    val resolvedOffset = offset?.toInt() ?: 0
    scope.launch {
      try {
        val records = sync.getLogs(sessionId, resolvedLimit, resolvedOffset)
        promise.resolve(Arguments.createArray().apply {
          records.forEach { pushMap(SyncMappers.logRecordMap(it)) }
        })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "getLogs failed", t)
      }
    }
  }

  // androidPendingLogCount() -> TrackerResult<number>, wrapped exactly as pendingCount() is. A
  // DIFFERENT queue in a DIFFERENT database from pendingCount() — the two numbers are unrelated.
  override fun androidPendingLogCount(promise: Promise) {
    scope.launch {
      try {
        val count = sync.pendingLogCount()
        promise.resolve(Arguments.createMap().apply {
          putBoolean("ok", true)
          putInt("value", count)
        })
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "pendingLogCount failed", t)
      }
    }
  }

  // androidSyncLogsNow() — drain now → shipped / empty / retry / rejected. See
  // SyncMappers.logSyncResultMap for why these are not the points channel's four.
  override fun androidSyncLogsNow(promise: Promise) {
    scope.launch {
      try {
        promise.resolve(SyncMappers.logSyncResultMap(sync.syncLogsNow()))
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "syncLogsNow failed", t)
      }
    }
  }

  // androidRequestLogSync() — enqueue the log worker. The facade RETURNS EARLY rather than throwing
  // when the channel was never configured or has been terminally rejected, so this resolves in both
  // cases; `androidLogStatus()` is how a host asks whether it is on.
  override fun androidRequestLogSync(promise: Promise) {
    try {
      sync.requestLogSync()
      promise.resolve(null)
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "requestLogSync failed", t)
    }
  }

  // androidLogStatus() -> { configured, endpoint? }. Both are read from the same source natively
  // (`isLogSyncConfigured` IS `logEndpoint != null`), returned together so a caller never needs a
  // second round trip to tell "off" from "on, to here".
  override fun androidLogStatus(promise: Promise) {
    try {
      val endpoint = sync.logEndpoint
      promise.resolve(Arguments.createMap().apply {
        putBoolean("configured", sync.isLogSyncConfigured)
        if (endpoint == null) putNull("endpoint") else putString("endpoint", endpoint)
      })
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "logStatus failed", t)
    }
  }

  // ── onSyncEvent subscription layer ───────────────────────────────────────────
  // The same shape as TrackerEventsHelper, kept local because this module has exactly one stream and
  // a distinct device event name: ONE Job per active JS subscriber on the module scope,
  // subscribeSyncEvents() resolving its id, unsubscribe(id) cancelling that one, invalidate()
  // cancelling the scope and with it any still-open collect.
  //
  // Buffering is inherited, never widened. `TrackerSync.events` is a SharedFlow the SDK builds with
  // replay = 1 / DROP_OLDEST, so a plain collect hands a late subscriber the last exchange of an
  // earlier drain — deliberate on the SDK's side (an upload screen opened after a background drain
  // shows what happened rather than a blank panel), and src/sync.ts is written to expect it.
  //
  // addListener/removeListeners stay NativeEventEmitter bookkeeping no-ops: the RCTDeviceEventEmitter
  // path needs no supportedEvents, and the real lifetime is the Job.
  override fun addListener(eventName: String) { /* no-op */ }

  override fun removeListeners(count: Double) { /* no-op */ }

  override fun subscribeSyncEvents(promise: Promise) {
    val id = nextSubscriptionId.getAndIncrement()
    jobs[id] = scope.launch {
      // A null map is a native event with no place in the JS vocabulary — see syncEventMap.
      sync.events.collect { event -> SyncMappers.syncEventMap(event)?.let { emit(id, it) } }
    }
    promise.resolve(id)
  }

  // androidSubscribeLogEvents() — the LOG channel's own SharedFlow, a different stream from
  // `sync.events` above carrying this channel's HTTP exchanges. Shares the id space and the
  // "TrackerSyncEmit" device event with the points stream, so `unsubscribe(id)` ends either kind
  // and invalidate() takes both down with the scope.
  override fun androidSubscribeLogEvents(promise: Promise) {
    val id = nextSubscriptionId.getAndIncrement()
    jobs[id] = scope.launch {
      sync.logEvents.collect { event -> SyncMappers.syncEventMap(event)?.let { emit(id, it) } }
    }
    promise.resolve(id)
  }

  override fun unsubscribe(id: Double, promise: Promise) {
    jobs.remove(id.toInt())?.cancel()
    promise.resolve(null)
  }

  // ONE device event "TrackerSyncEmit" carries { id, payload } — distinct from the main module's
  // "TrackerEmit" so the two routers cannot see each other's envelopes. Guard on an active React
  // instance: a collect that outlives teardown must not touch a dead one.
  private fun emit(id: Int, payload: WritableMap) {
    val ctx = reactApplicationContext
    if (!ctx.hasActiveReactInstance()) return
    val body: WritableMap = Arguments.createMap().apply {
      putInt("id", id)
      putMap("payload", payload)
    }
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
      .emit("TrackerSyncEmit", body)
  }

  override fun invalidate() {
    super.invalidate()
    jobs.clear()
    scope.cancel()
  }

  companion object {
    const val NAME = NativeTrackerSyncSpec.NAME

    // The SDK's own getLogs default, restated because @JvmOverloads leaves no way to skip one
    // positional argument while supplying a later one.
    private const val DEFAULT_LOG_LIMIT = 200
  }
}
package com.fieldtrack360.tracker

import com.field360.traker.sync.TrackerSync
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

// Second TurboModule — the SEPARATE "TrackerSync" module over TrackerSync.getInstance(ctx).
// Distinct from TrackerModule. Overrides are THIN and delegate wire vocabulary to SyncMappers; no
// behaviour here. Surface it drives:
//   getInstance(Context)                                   (:15)
//   configure(SyncConfig, SyncTransport?)                  (:20) — transport optional via configure$default (:14)
//   requestSync()                                          (:22) — synchronous void
//   pendingCount(Continuation<Integer>)                    (:21) — suspend -> Int
//   syncNow(Continuation<SyncQueue$Result>)                (:23) — suspend -> SyncQueue.Result
class TrackerSyncModule(reactContext: ReactApplicationContext) :
  NativeTrackerSyncSpec(reactContext) {

  // Module-owned scope for the suspend facade calls, cancelled in invalidate().
  private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val sync: TrackerSync get() = TrackerSync.getInstance(reactApplicationContext)

  // configure(configJson). The SyncConfig crosses as a JSON string; the Android mapper reads
  // shared + android.requiresUnmeteredNetwork only (the iOS gate/fields are ignored — the two network
  // gates are NOT unified). Android url is a plain String, so there is no unparseable-url path (that
  // is iOS-only); undecodable JSON is the only bridge fault → reject invalidConfig (mirrors ready()).
  // configure is synchronous on the facade (not suspend), so it resolves inline. There is NO Android
  // equivalent of iOS's pendingUploads / setSyncTrigger wiring.
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

  // syncNow() — suspend read on the module scope → the four-case result.
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

  // ── ios.onSyncEvent — iOS ONLY ───────────────────────────────────────────────
  // Codegen (D1) requires the subscribe/unsubscribe methods on BOTH platforms, but Android has NO
  // sync event stream: subscribeSyncEvents REJECTS unsupportedOnPlatform. addListener/removeListeners
  // stay no-ops (NativeEventEmitter bookkeeping); nothing is ever emitted on "TrackerSyncEmit" here.
  override fun addListener(eventName: String) { /* no-op */ }

  override fun removeListeners(count: Double) { /* no-op */ }

  override fun subscribeSyncEvents(promise: Promise) {
    promise.reject(
      "unsupportedOnPlatform",
      "ios.onSyncEvent is iOS-only: Tracker Android has no sync event stream. Use syncNow() / " +
        "pendingCount() for sync status on Android.",
    )
  }

  override fun unsubscribe(id: Double, promise: Promise) {
    // No Android subscription can exist (subscribeSyncEvents always rejects) — a safe no-op.
    promise.resolve(null)
  }

  override fun invalidate() {
    super.invalidate()
    scope.cancel()
  }

  companion object {
    const val NAME = NativeTrackerSyncSpec.NAME
  }
}
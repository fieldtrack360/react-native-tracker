package com.fieldtrack360.tracker

import android.content.Intent
import com.field360.tracker.Tracker
import com.field360.tracker.permission.PermissionManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import java.util.concurrent.atomic.AtomicInteger

// permissions subsystem — Android half. Per-subsystem helper the module overrides delegate to
// (rule 2). PermissionManager (PermissionManager.txt) methods are SYNCHRONOUS on the facade
// (no Continuation), so reads resolve inline with no coroutine hop — only the request shims
// are async, driven by a PermissionListener against the current Activity.
//
// Enum→wire goes through TrackerMappers (permissionTier / accuracyAuthorization). The
// BackgroundRequest union → { kind } map is kept local to permissions (assembly may lift it into
// TrackerMappers verbatim).: iOS-only methods REJECT here with `unsupportedOnPlatform`.
//
// shims feed the SDK's OWN permission arrays and preserve the ladder EXACTLY:
// notification (API33+) → fine+coarse in one request → background only after fine (enforced by
// the SDK's backgroundRequest() returning NeedsForegroundFirst) → activity recognition last.
// No rationale UI, no retry, no reordering.
object TrackerPermissions {

  private val nextRequestCode = AtomicInteger(0xA100)

  private fun pmOf(module: TrackerModule): PermissionManager =
    Tracker.getInstance(module.appContext).permissions()

  private fun kindMap(kind: String): WritableMap =
    Arguments.createMap().apply { putString("kind", kind) }

  // ---- Reads ----

  fun getPermissionTier(module: TrackerModule, promise: Promise) =
    promise.resolve(TrackerMappers.permissionTier(pmOf(module).tier()))

  fun getAccuracy(module: TrackerModule, promise: Promise) =
    promise.resolve(TrackerMappers.accuracyAuthorization(pmOf(module).accuracy()))

  fun shouldStopAsking(module: TrackerModule, attempts: Double, promise: Promise) =
    promise.resolve(pmOf(module).shouldStopAsking(attempts.toInt()))

  fun getBackgroundRequest(module: TrackerModule, promise: Promise) =
    promise.resolve(kindMap(backgroundRequestKind(pmOf(module).backgroundRequest())))

  fun hasActivityRecognition(module: TrackerModule, promise: Promise) =
    promise.resolve(pmOf(module).hasActivityRecognition())

  fun hasNotificationPermission(module: TrackerModule, promise: Promise) =
    promise.resolve(pmOf(module).hasNotificationPermission())

  // ---- Requests / shims ----

  // Fine + coarse in ONE request (the SDK's foregroundPermissions()); resolve the settled tier.
  fun requestForeground(module: TrackerModule, promise: Promise) {
    val pm = pmOf(module)
    prompt(module, pm.foregroundPermissions(), promise) {
      promise.resolve(TrackerMappers.permissionTier(pm.tier()))
    }
  }

  // Background only after fine: the SDK's backgroundRequest() returns NeedsForegroundFirst when
  // fine is not yet granted, so we only prompt on the Prompt case. Re-query after grant to report
  // the settled kind. URL/Intent never cross to JS.
  fun requestBackground(module: TrackerModule, promise: Promise) {
    val pm = pmOf(module)
    when (val req = pm.backgroundRequest()) {
      is PermissionManager.BackgroundRequest.Prompt ->
        prompt(module, req.permissions, promise) {
          promise.resolve(kindMap(backgroundRequestKind(pm.backgroundRequest())))
        }
      else -> promise.resolve(kindMap(backgroundRequestKind(req)))
    }
  }

  // Activity recognition last (the SDK's activityRecognitionPermissions()); resolve granted state.
  fun requestActivityRecognition(module: TrackerModule, promise: Promise) {
    val pm = pmOf(module)
    prompt(module, pm.activityRecognitionPermissions(), promise) {
      promise.resolve(pm.hasActivityRecognition())
    }
  }

  // Notification (API33+; notificationPermissions() is empty below 33 → no prompt, resolve state).
  fun requestNotification(module: TrackerModule, promise: Promise) {
    val pm = pmOf(module)
    prompt(module, pm.notificationPermissions(), promise) {
      promise.resolve(pm.hasNotificationPermission())
    }
  }

  fun openAppSettings(module: TrackerModule, promise: Promise) {
    val intent = pmOf(module).appSettingsIntent()
    UiThreadUtil.runOnUiThread {
      try {
        val activity = module.appContext.currentActivity
        if (activity != null) {
          activity.startActivity(intent)
        } else {
          module.appContext.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        promise.resolve(true)
      } catch (t: Throwable) {
        promise.reject("internalError", t.message ?: "openAppSettings failed", t)
      }
    }
  }

  // ---- iOS-only → reject on Android ----

  fun iosOnly(method: String, promise: Promise) {
    promise.reject("unsupportedOnPlatform", "$method is iOS-only; not available on Android")
  }

  // ---- Internals ----

  // Requesting needs an Activity; JS has none, so we drive the SDK's own arrays through a
  // PermissionListener on the current Activity. Empty array = nothing to ask (e.g. notifications
  // below API 33) → resolve current state without a prompt.
  private fun prompt(
    module: TrackerModule,
    permissions: Array<String>,
    promise: Promise,
    onResult: () -> Unit
  ) {
    if (permissions.isEmpty()) {
      onResult()
      return
    }
    val activity = module.appContext.currentActivity
    if (activity !is PermissionAwareActivity) {
      promise.reject("noActivity", "requestPermissions requires a foreground Activity (Android)")
      return
    }
    val code = nextRequestCode.getAndIncrement()
    val listener = PermissionListener { requestCode, _, _ ->
      if (requestCode != code) return@PermissionListener false
      onResult()
      true
    }
    UiThreadUtil.runOnUiThread { activity.requestPermissions(permissions, code, listener) }
  }

  // Android BackgroundRequest (PermissionManager.txt lines 24-76) → wire kind. The String[] on
  // Prompt and the Intent on NeedsSettings stay native; NeedsForegroundFirst is the wire's
  // `needsForegroundFirst`.
  private fun backgroundRequestKind(req: PermissionManager.BackgroundRequest): String = when (req) {
    is PermissionManager.BackgroundRequest.AlreadyGranted -> "alreadyGranted"
    is PermissionManager.BackgroundRequest.NotApplicable -> "notApplicable"
    is PermissionManager.BackgroundRequest.NeedsForegroundFirst -> "needsForegroundFirst"
    is PermissionManager.BackgroundRequest.Prompt -> "prompt"
    is PermissionManager.BackgroundRequest.NeedsSettings -> "needsSettings"
  }
}
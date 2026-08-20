package com.fieldtrack360.tracker

import com.field360.tracker.Tracker
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel

// TurboModule impl over Tracker.getInstance(ctx). Overrides are THIN and delegate to per-subsystem
// helper objects; all wire vocabulary (enum casing, field renames) lives in TrackerMappers.
// No behaviour here.
//
// Shared module members the helpers use (Kotlin does not grant same-package access to the Java
// `protected` reactApplicationContext, so it is surfaced via `appContext`):
//  - scope: module-owned CoroutineScope for suspend facade calls, cancelled in invalidate().
//  - tracker: the facade instance.
//  - appContext: the ReactApplicationContext, for helpers that need currentActivity / startActivity.
class TrackerModule(reactContext: ReactApplicationContext) :
  NativeTrackerSpec(reactContext) {

  internal val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  internal val tracker: Tracker get() = Tracker.getInstance(reactApplicationContext)
  internal val appContext: ReactApplicationContext get() = reactApplicationContext

  // ── Lifecycle ───────────────────────────────────────────────────────────────
  // getState() — the reachability probe of / gate. A state read does not throw, so it
  // resolves; a bridge fault rejects.
  override fun getState(promise: Promise) {
    try {
      promise.resolve(TrackerMappers.stateMap(tracker.state.value))
    } catch (t: Throwable) {
      promise.reject("internalError", t.message ?: "getState failed", t)
    }
  }

  override fun ready(configJson: String?, promise: Promise) =
    LifecycleModule.ready(this, configJson, promise)

  override fun start(tag: String?, promise: Promise) =
    LifecycleModule.start(this, tag, promise)

  override fun stop(promise: Promise) =
    LifecycleModule.stop(this, promise)

  // ── Reads ───────────────────────────────────────────────────────────────────
  override fun getPoints(query: ReadableMap?, promise: Promise) =
    TrackerReadsHelper.getPoints(this, query, promise)

  override fun getCount(query: ReadableMap?, promise: Promise) =
    TrackerReadsHelper.getCount(this, query, promise)

  override fun getOdometerMeters(promise: Promise) =
    TrackerReadsHelper.getOdometerMeters(this, promise)

  override fun getSessions(fromMs: Double?, toMs: Double?, promise: Promise) =
    TrackerReadsHelper.getSessions(this, fromMs, toMs, promise)

  override fun currentSession(promise: Promise) =
    TrackerReadsHelper.currentSession(this, promise)

  // ── Current location ──────────────────────────────────────────────────────────
  override fun getCurrentLocation(options: ReadableMap?, promise: Promise) =
    CurrentLocationBridge.getCurrentLocation(this, options, promise)

  // ── Plotting ──────────────────────────────────────────────────────────────────
  override fun buildTrack(query: ReadableMap?, options: ReadableMap?, promise: Promise) =
    PlottingModule.buildTrack(this, query, options, promise)

  override fun exportPolylineJson(query: ReadableMap?, options: ReadableMap?, promise: Promise) =
    PlottingModule.exportPolylineJson(this, query, options, promise)

  override fun exportGeoJson(query: ReadableMap?, options: ReadableMap?, promise: Promise) =
    PlottingModule.exportGeoJson(this, query, options, promise)

  // ── Road snapping ─────────────────────────────────────────────────────────────
  override fun setOsrmSnapProvider(config: ReadableMap, promise: Promise) =
    SnapHelper.setOsrmSnapProvider(this, config, promise)

  override fun clearRoadSnapProvider(promise: Promise) =
    SnapHelper.clearRoadSnapProvider(this, promise)

  // ── Live surface ──────────────────────────────────────────────────────────────
  override fun setActiveRoute(points: ReadableArray, promise: Promise) =
    LiveModule.setActiveRoute(this, points, promise)

  override fun isOffRoute(promise: Promise) =
    LiveModule.isOffRoute(this, promise)

  // ── Diagnostics ───────────────────────────────────────────────────────────────
  override fun getRawFixes(sessionId: String, promise: Promise) =
    Diagnostics.getRawFixes(tracker, scope, sessionId, promise)

  override fun getRawPoints(sessionId: String, promise: Promise) =
    Diagnostics.getRawPoints(tracker, scope, sessionId, promise)

  override fun getDecisions(sessionId: String?, limit: Double?, offset: Double?, promise: Promise) =
    Diagnostics.getDecisions(tracker, scope, sessionId, limit, offset, promise)

  override fun offerFix(fix: ReadableMap, promise: Promise) =
    Diagnostics.offerFix(tracker, fix, promise)

  override fun getSensors(promise: Promise) =
    Diagnostics.getSensors(tracker, promise)

  override fun getBatteryInfo(promise: Promise) =
    Diagnostics.getBatteryInfo(tracker, promise)

  override fun iosExportFixture(sessionId: String, name: String, promise: Promise) =
    Diagnostics.iosExportFixture(promise)

  override fun iosChangePace(isMoving: Boolean, promise: Promise) =
    Diagnostics.iosChangePace(promise)

  // ── Permissions ───────────────────────────────────────────────────────────────
  override fun getPermissionTier(promise: Promise) =
    TrackerPermissions.getPermissionTier(this, promise)

  override fun getAccuracy(promise: Promise) =
    TrackerPermissions.getAccuracy(this, promise)

  override fun shouldStopAsking(attempts: Double, promise: Promise) =
    TrackerPermissions.shouldStopAsking(this, attempts, promise)

  override fun requestForeground(promise: Promise) =
    TrackerPermissions.requestForeground(this, promise)

  override fun requestBackground(promise: Promise) =
    TrackerPermissions.requestBackground(this, promise)

  override fun openAppSettings(promise: Promise) =
    TrackerPermissions.openAppSettings(this, promise)

  override fun getBackgroundRequest(promise: Promise) =
    TrackerPermissions.getBackgroundRequest(this, promise)

  override fun iosRequestMotion(promise: Promise) =
    TrackerPermissions.iosOnly("iosRequestMotion", promise)

  override fun iosGetMotionAuthorization(promise: Promise) =
    TrackerPermissions.iosOnly("iosGetMotionAuthorization", promise)

  override fun iosRequestTemporaryFullAccuracy(purposeKey: String, promise: Promise) =
    TrackerPermissions.iosOnly("iosRequestTemporaryFullAccuracy", promise)

  // ── Device integrity + online licence (Android-only) ────────────────────────
  override fun androidIntegrity(promise: Promise) =
    Security.integrity(tracker, promise)

  override fun androidCheckIntegrity(promise: Promise) =
    Security.checkIntegrity(tracker, scope, promise)

  override fun androidLicenseInfo(promise: Promise) =
    Security.licenseInfo(tracker, scope, promise)

  override fun androidCheckLicense(promise: Promise) =
    Security.checkLicense(tracker, scope, promise)

  override fun androidHasActivityRecognition(promise: Promise) =
    TrackerPermissions.hasActivityRecognition(this, promise)

  override fun androidRequestActivityRecognition(promise: Promise) =
    TrackerPermissions.requestActivityRecognition(this, promise)

  override fun androidHasNotificationPermission(promise: Promise) =
    TrackerPermissions.hasNotificationPermission(this, promise)

  override fun androidRequestNotification(promise: Promise) =
    TrackerPermissions.requestNotification(this, promise)

  // ── Geofencing ──────────────────────────────────────────────────────────────
  override fun geofenceAdd(fence: ReadableMap, promise: Promise) =
    GeofenceModule.add(this, fence, promise)

  override fun geofenceList(promise: Promise) =
    GeofenceModule.list(this, promise)

  override fun geofenceGet(id: String, promise: Promise) =
    GeofenceModule.get(this, id, promise)

  override fun geofenceRemove(id: String, promise: Promise) =
    GeofenceModule.remove(this, id, promise)

  override fun geofenceRemoveAll(promise: Promise) =
    GeofenceModule.removeAll(this, promise)

  override fun geofenceGetEvents(opts: ReadableMap?, promise: Promise) =
    GeofenceModule.getEvents(this, opts, promise)

  override fun geofenceDeleteEvents(geofenceId: String?, promise: Promise) =
    GeofenceModule.deleteEvents(this, geofenceId, promise)

  // ── Subscriptions ─────────────────────────────────────────────────────────────
  // addListener/removeListeners are NativeEventEmitter bookkeeping no-ops (the RCTDeviceEventEmitter
  // path needs no supportedEvents). The real lifetime is the Job started by subscribe and cancelled
  // by unsubscribe; invalidate() cancels scope, tearing down any still-open collect Jobs.
  override fun addListener(eventName: String) { /* no-op */ }

  override fun removeListeners(count: Double) { /* no-op */ }

  override fun subscribe(stream: String, arg: String?, promise: Promise) =
    TrackerEventsHelper.subscribe(this, stream, arg, promise)

  override fun unsubscribe(id: Double, promise: Promise) =
    TrackerEventsHelper.unsubscribe(this, id.toInt(), promise)

  override fun invalidate() {
    super.invalidate()
    scope.cancel()
  }

  companion object {
    const val NAME = NativeTrackerSpec.NAME
  }
}

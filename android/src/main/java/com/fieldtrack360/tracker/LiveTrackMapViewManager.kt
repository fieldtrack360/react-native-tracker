package com.fieldtrack360.tracker

import android.view.MotionEvent
import android.widget.FrameLayout
import com.field360.traker.geo.model.GeoPoint
import com.field360.traker.geo.plot.model.LiveTrackUpdate
import com.field360.traker.geo.plot.model.PuckState
import com.field360.traker.maps.LiveTrackRenderer
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.viewmanagers.LiveTrackMapViewManagerDelegate
import com.facebook.react.viewmanagers.LiveTrackMapViewManagerInterface
import com.google.android.gms.maps.CameraUpdateFactory
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.MapsInitializer
import com.google.android.gms.maps.model.LatLng
import org.json.JSONObject

// — Fabric host for <LiveTrackMapView>. Implements the codegen
// LiveTrackMapViewManagerInterface/Delegate. Owns a MapView, hands its GoogleMap to the SDK's
// LiveTrackRenderer (GoogleMap + Options, NOT a MapView), and drives render/clear.
//
// The native LiveTrackUpdate HAS a public constructor on Android, so — unlike iOS — the view
// rebuilds it from the wire `update` prop and calls LiveTrackRenderer.render(update). The renderer
// drops stale sequences, grows the frozen tail, redraws the head and animates the puck; none of
// that is reimplemented.
//
// followMode maps to LiveTrackRenderer.CameraFollowMode. Android has no follow-state callback, so
// onFollowingChange is never dispatched here (it is registered for the codegen contract only; the
// event exists to surface iOS's isFollowing Binding — see the JS spec).
//
// Register in TrackerPackage.createViewManagers alongside TrackerMapViewManager (buildNotes).
class LiveTrackMapViewManager :
  SimpleViewManager<TrackerLiveMapView>(),
  LiveTrackMapViewManagerInterface<TrackerLiveMapView> {

  private val delegate =
    LiveTrackMapViewManagerDelegate<TrackerLiveMapView, LiveTrackMapViewManager>(this)

  override fun getDelegate(): ViewManagerDelegate<TrackerLiveMapView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): TrackerLiveMapView =
    TrackerLiveMapView(context)

  @ReactProp(name = "update")
  override fun setUpdate(view: TrackerLiveMapView, value: String?) {
    view.setUpdateJson(value)
  }

  @ReactProp(name = "options")
  override fun setOptions(view: TrackerLiveMapView, value: String?) {
    view.setOptionsJson(value)
  }

  @ReactProp(name = "followMode")
  override fun setFollowMode(view: TrackerLiveMapView, value: String?) {
    view.setFollowMode(value)
  }

  @ReactProp(name = "initialCentre")
  override fun setInitialCentre(view: TrackerLiveMapView, value: ReadableMap?) {
    view.setInitialCentre(value)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      // Registered for the codegen contract; Android never dispatches it (no follow-state callback).
      "topFollowingChange" to mutableMapOf("registrationName" to "onFollowingChange")
    )

  override fun onDropViewInstance(view: TrackerLiveMapView) {
    super.onDropViewInstance(view)
    view.destroy()
  }

  companion object {
    const val NAME = "LiveTrackMapView"
  }
}

// The hosted view: a FrameLayout wrapping a MapView, owning the MapView lifecycle and the
// LiveTrackRenderer. LiveTrackRenderer is main-thread only; all calls here are on the UI thread
// (Fabric prop setters + getMapAsync callback).
class TrackerLiveMapView(context: ThemedReactContext) : FrameLayout(context) {

  private val mapView = MapView(context)
  private var googleMap: GoogleMap? = null
  private var renderer: LiveTrackRenderer? = null

  private var updateJson: String? = null
  private var optionsJson: String? = null
  private var followMode: LiveTrackRenderer.CameraFollowMode =
    LiveTrackRenderer.CameraFollowMode.NONE
  private var initialCentre: LatLng? = null
  private var hasCentred = false

  init {
    MapsInitializer.initialize(context.applicationContext)
    addView(
      mapView,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
    )
    mapView.onCreate(null)
    mapView.onStart()
    mapView.onResume()
    mapView.getMapAsync { map ->
      googleMap = map
      renderer = LiveTrackRenderer(map, LiveReconstruct.options(optionsJson, followMode))
      applyInitialCentre()
      renderPending()
    }
  }

  // Same as the track map: claim the gesture on ACTION_DOWN so an enclosing scroll container
  // cannot intercept the vertical drag and cancel the map's own pan.
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      parent?.requestDisallowInterceptTouchEvent(true)
    }
    return super.onInterceptTouchEvent(ev)
  }

  fun setUpdateJson(value: String?) {
    updateJson = value
    renderPending()
  }

  fun setOptionsJson(value: String?) {
    optionsJson = value
    val map = googleMap ?: return
    renderer?.clear()
    renderer = LiveTrackRenderer(map, LiveReconstruct.options(optionsJson, followMode))
    hasCentred = false
    applyInitialCentre()
    renderPending()
  }

  fun setFollowMode(value: String?) {
    followMode = LiveReconstruct.cameraFollowMode(value)
    // cameraFollow is a mutable property that may be changed at runtime (dev guide).
    renderer?.cameraFollow = followMode
  }

  fun setInitialCentre(value: ReadableMap?) {
    initialCentre = if (value != null && value.hasKey("latitude") && value.hasKey("longitude")) {
      LatLng(value.getDouble("latitude"), value.getDouble("longitude"))
    } else {
      null
    }
    applyInitialCentre()
  }

  private fun applyInitialCentre() {
    val map = googleMap ?: return
    val centre = initialCentre ?: return
    if (hasCentred || updateJson != null) return
    map.moveCamera(CameraUpdateFactory.newLatLng(centre))
    hasCentred = true
  }

  private fun renderPending() {
    val r = renderer ?: return
    val json = updateJson ?: return
    val update = LiveReconstruct.update(json) ?: return
    r.render(update)
  }

  // Fabric teardown — clear() the renderer and tear down the MapView (disposal).
  fun destroy() {
    renderer?.clear()
    renderer = null
    googleMap = null
    mapView.onPause()
    mapView.onStop()
    mapView.onDestroy()
  }
}

// Wire LiveTrackUpdate JSON -> native com.field360.traker.geo.plot.model.LiveTrackUpdate. All
// native constructors (LiveTrackUpdate, GeoPoint, PuckState) are public, so the rebuild is faithful
// and total (see reconstructionNotes).
private object LiveReconstruct {

  // LiveTrackUpdate(sessionId, sequence, precision, frozenTailPolyline, liveHead, puck).
  fun update(json: String): LiveTrackUpdate? = try {
    val o = JSONObject(json)
    val headArr = o.getJSONArray("liveHead")
    val head = ArrayList<GeoPoint>(headArr.length())
    for (i in 0 until headArr.length()) {
      val p = headArr.getJSONObject(i)
      head.add(GeoPoint(p.getDouble("latitude"), p.getDouble("longitude")))
    }
    val puck = o.optJSONObject("puck")?.let { puck(it) }
    LiveTrackUpdate(
      o.getString("sessionId"),
      o.getLong("sequence"),
      o.getInt("precision"),
      o.getString("frozenTailPolyline"),
      head,
      puck,
    )
  } catch (t: Throwable) {
    null
  }

  // PuckState(latitude, longitude, speedMps, headingDeg, accuracyM). headingDeg is nullable (frozen
  // at low speed).
  private fun puck(o: JSONObject): PuckState = PuckState(
    o.getDouble("latitude"),
    o.getDouble("longitude"),
    o.getDouble("speedMps").toFloat(),
    if (o.has("headingDeg")) o.getDouble("headingDeg") else null,
    o.getDouble("accuracyM").toFloat(),
  )

  fun cameraFollowMode(wire: String?): LiveTrackRenderer.CameraFollowMode = when (wire) {
    "follow" -> LiveTrackRenderer.CameraFollowMode.FOLLOW
    "followBearing" -> LiveTrackRenderer.CameraFollowMode.FOLLOW_BEARING
    else -> LiveTrackRenderer.CameraFollowMode.NONE
  }

  // Documented scalar/bool styling only; colours are a reconciliation item. Android-only follow
  // framing: followZoom/followTilt (NOT followDistanceMeters/followPitchDegrees — do not unify).
  // Uses the SDK default Options() as the base and sets cameraFollow from the followMode prop.
  fun options(
    json: String?,
    followMode: LiveTrackRenderer.CameraFollowMode,
  ): LiveTrackRenderer.Options {
    val d = LiveTrackRenderer.Options()
    if (json == null) return d.copy(cameraFollow = followMode)
    val o = JSONObject(json)
    return d.copy(
      tailWidth = o.optDouble("tailWidth", d.tailWidth.toDouble()).toFloat(),
      headWidth = o.optDouble("headWidth", d.headWidth.toDouble()).toFloat(),
      puckSizePx = o.optInt("puckSizePx", d.puckSizePx),
      showAccuracyHalo = o.optBoolean("showAccuracyHalo", d.showAccuracyHalo),
      animationDurationMs = o.optLong("animationDurationMs", d.animationDurationMs),
      lookaheadMs = o.optLong("lookaheadMs", d.lookaheadMs),
      followZoom = o.optDouble("followZoom", d.followZoom.toDouble()).toFloat(),
      followTilt = o.optDouble("followTilt", d.followTilt.toDouble()).toFloat(),
      cameraFollow = followMode,
    )
  }
}

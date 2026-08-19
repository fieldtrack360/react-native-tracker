package com.fieldtrack360.tracker

import android.view.MotionEvent
import android.widget.FrameLayout
import com.field360.traker.geo.model.Bounds
import com.field360.traker.geo.plot.model.ArrowAnchor
import com.field360.traker.geo.plot.model.SegmentType
import com.field360.traker.geo.plot.model.StopNode
import com.field360.traker.geo.plot.model.Track
import com.field360.traker.geo.plot.model.TrackJsonPoint
import com.field360.traker.geo.plot.model.TrackSegment
import com.field360.traker.geo.plot.model.TrackStats
import com.field360.traker.maps.TrackRenderer
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.TrackMapViewManagerDelegate
import com.facebook.react.viewmanagers.TrackMapViewManagerInterface
import com.google.android.gms.maps.GoogleMap
import com.google.android.gms.maps.MapView
import com.google.android.gms.maps.MapsInitializer
import org.json.JSONArray
import org.json.JSONObject

// — Fabric host for <TrackMapView>. A SimpleViewManager implementing the codegen
// TrackMapViewManagerInterface/Delegate (generated into com.facebook.react.viewmanagers from
// src/TrackMapViewNativeComponent.ts). It owns a Google Maps MapView, hands its GoogleMap to the
// SDK's TrackRenderer (which takes a GoogleMap, NOT a MapView), and drives
// render/needsArrowRefresh/clear.
//
// TrackRenderer is MAIN-THREAD only and not thread-safe. All renderer calls here happen on
// the UI thread: Fabric prop setters run on the UI thread, and getMapAsync + OnCameraIdleListener
// callbacks fire on the main thread.
//
// REGISTER in TrackerPackage: override createViewManagers to return
//   listOf(TrackerMapViewManager(), LiveTrackMapViewManager())   (buildNotes).
// Android also needs a Google Maps API key in the host manifest (com.google.android.geo.API_KEY).
class TrackerMapViewManager :
  SimpleViewManager<TrackerTrackMapView>(),
  TrackMapViewManagerInterface<TrackerTrackMapView> {

  private val delegate = TrackMapViewManagerDelegate<TrackerTrackMapView, TrackerMapViewManager>(this)

  override fun getDelegate(): ViewManagerDelegate<TrackerTrackMapView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): TrackerTrackMapView =
    TrackerTrackMapView(context)

  @ReactProp(name = "track")
  override fun setTrack(view: TrackerTrackMapView, value: String?) {
    view.setTrackJson(value)
  }

  @ReactProp(name = "options")
  override fun setOptions(view: TrackerTrackMapView, value: String?) {
    view.setOptionsJson(value)
  }

  override fun getExportedCustomDirectEventTypeConstants(): MutableMap<String, Any> =
    mutableMapOf(
      OnArrowZoomEvent.EVENT_NAME to mutableMapOf("registrationName" to "onArrowZoom")
    )

  override fun onDropViewInstance(view: TrackerTrackMapView) {
    super.onDropViewInstance(view)
    view.destroy()
  }

  companion object {
    const val NAME = "TrackMapView"
  }
}

// The Fabric direct event onArrowZoom { zoom }. Dispatched when the renderer reports it
// needs arrows rebuilt at the new camera zoom; JS reacts by rebuilding the track at that zoom.
class OnArrowZoomEvent(surfaceId: Int, viewId: Int, private val zoom: Double) :
  Event<OnArrowZoomEvent>(surfaceId, viewId) {
  override fun getEventName(): String = EVENT_NAME
  override fun getEventData(): WritableMap =
    Arguments.createMap().apply { putDouble("zoom", zoom) }

  companion object {
    const val EVENT_NAME = "topArrowZoom"
  }
}

// The hosted view: a FrameLayout wrapping a MapView. Owns the MapView lifecycle (there is no host
// Activity lifecycle to piggyback on inside a Fabric view), the TrackRenderer, and the latest wire
// track. First render fits the camera; subsequent renders (arrow rebuilds) do not (dev guide).
class TrackerTrackMapView(context: ThemedReactContext) : FrameLayout(context) {

  private val mapView = MapView(context)
  private var googleMap: GoogleMap? = null
  private var renderer: TrackRenderer? = null

  private var trackJson: String? = null
  private var optionsJson: String? = null
  private var hasRenderedOnce = false

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
      renderer = TrackRenderer(map, TrackReconstruct.rendererOptions(optionsJson))
      // Poll needsArrowRefresh() on camera idle; emit onArrowZoom with the new zoom.
      map.setOnCameraIdleListener {
        if (renderer?.needsArrowRefresh() == true) {
          emitArrowZoom(map.cameraPosition.zoom.toDouble())
        }
      }
      renderPending()
    }
  }

  // The map owns every gesture inside its own bounds. Without this an enclosing scroll container
  // (the sample puts the map in a ScrollView) intercepts the vertical drag after the touch slop and
  // the MapView receives ACTION_CANCEL, so the map pans sideways but never up or down.
  override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
    if (ev.actionMasked == MotionEvent.ACTION_DOWN) {
      parent?.requestDisallowInterceptTouchEvent(true)
    }
    return super.onInterceptTouchEvent(ev)
  }

  fun setTrackJson(value: String?) {
    trackJson = value
    renderPending()
  }

  fun setOptionsJson(value: String?) {
    optionsJson = value
    // Options only take effect at renderer construction (TrackRenderer.RendererOptions is passed to
    // the constructor). If the map is already up, rebuild the renderer so new styling applies.
    val map = googleMap ?: return
    renderer?.clear()
    renderer = TrackRenderer(map, TrackReconstruct.rendererOptions(optionsJson))
    hasRenderedOnce = false
    renderPending()
  }

  private fun renderPending() {
    val r = renderer ?: return
    val json = trackJson ?: return
    val track = TrackReconstruct.track(json) ?: return
    val fitCamera = !hasRenderedOnce
    r.render(track, fitCamera)
    hasRenderedOnce = true
  }

  private fun emitArrowZoom(zoom: Double) {
    val reactContext = context as ReactContext
    val dispatcher =
      UIManagerHelper.getEventDispatcherForReactTag(reactContext, id) ?: return
    dispatcher.dispatchEvent(
      OnArrowZoomEvent(UIManagerHelper.getSurfaceId(reactContext), id, zoom)
    )
  }

  // Fabric teardown — clear() the renderer and tear down the MapView (disposal, both platforms).
  fun destroy() {
    renderer?.clear()
    renderer = null
    googleMap = null
    mapView.onPause()
    mapView.onStop()
    mapView.onDestroy()
  }
}

// Wire Track JSON -> native com.field360.traker.geo.plot.model.Track (see reconstructionNotes).
//
// Every native constructor arg is present in the wire that THIS platform's TrackerMappers.trackJson
// produced (a track is always built and rendered on the same device), so the rebuild is faithful
// and TOTAL — including the Android-only stats speed/count block carried under `android`. We only
// ever invert our own mapper's output, never iOS's zero-overlap shape.
private object TrackReconstruct {

  fun track(json: String): Track? = try {
    val o = JSONObject(json)
    Track(
      o.getInt("version"),
      if (o.has("sessionId")) o.getString("sessionId") else null,
      o.getLong("generatedAtMs"),
      o.getLong("from"),
      o.getLong("to"),
      o.getString("timezone"),
      o.getInt("precision"),
      o.optJSONObject("bounds")?.let { bounds(it) },
      stats(o.getJSONObject("stats")),
      o.getString("encodedPolyline"),
      list(o.getJSONArray("points")) { point(it) },
      list(o.getJSONArray("segments")) { segment(it) },
      list(o.getJSONArray("stops")) { stop(it) },
      list(o.getJSONArray("arrows")) { arrow(it) },
      stringList(o.getJSONArray("warnings")),
    )
  } catch (t: Throwable) {
    null // undecodable track -> render nothing; never recompute geometry
  }

  // TrackStats(distanceMeters, durationSec, movingSec, stoppedSec, maxSpeedMps, avgMovingSpeedMps,
  //            pointCount, stopCount, activityBreakdownSec) — the android.* block carries the last 4.
  private fun stats(o: JSONObject): TrackStats {
    val a = o.optJSONObject("android")
    return TrackStats(
      o.getDouble("distanceMeters"),
      o.getLong("durationSec"),
      o.getLong("movingDurationSec"),
      o.getLong("stoppedDurationSec"),
      (a?.optDouble("maxSpeedMps", 0.0) ?: 0.0).toFloat(),
      (a?.optDouble("avgMovingSpeedMps", 0.0) ?: 0.0).toFloat(),
      a?.optInt("pointCount", 0) ?: 0,
      a?.optInt("stopCount", 0) ?: 0,
      longMap(o.getJSONObject("activityBreakdownSec")),
    )
  }

  // TrackJsonPoint(i, t, lat, lng, acc, spd, brg, act, src, mock) — android.{index,source,isMock}.
  private fun point(o: JSONObject): TrackJsonPoint {
    val a = o.optJSONObject("android")
    return TrackJsonPoint(
      a?.optInt("index", 0) ?: 0,
      o.getLong("timeMs"),
      o.getDouble("latitude"),
      o.getDouble("longitude"),
      o.getDouble("accuracyM").toFloat(),
      o.getDouble("speedMps").toFloat(),
      o.getDouble("bearingDeg").toFloat(),
      o.optString("activity", ""),
      a?.optString("source", "") ?: "",
      a?.optBoolean("isMock", false) ?: false,
    )
  }

  // TrackSegment(from, to, type, startMs, endMs, distanceMeters, durationSec, avgSpeedMps,
  //              maxSpeedMps, p75SpeedMps, activity, activityIcon, speedBand, encodedPolyline, stopIndex)
  private fun segment(o: JSONObject): TrackSegment = TrackSegment(
    o.getInt("from"),
    o.getInt("to"),
    segmentType(o.getString("type")),
    o.getLong("startMs"),
    o.getLong("endMs"),
    o.getDouble("distanceMeters"),
    o.getLong("durationSec"),
    o.getDouble("avgSpeedMps").toFloat(),
    o.getDouble("maxSpeedMps").toFloat(),
    o.getDouble("p75SpeedMps").toFloat(),
    if (o.has("activity")) o.getString("activity") else null,
    if (o.has("activityIcon")) o.getString("activityIcon") else null,
    if (o.has("speedBand")) o.getString("speedBand") else null,
    o.getString("encodedPolyline"),
    if (o.has("stopIndex")) o.getInt("stopIndex") else null,
  )

  // StopNode(index, lat, lng, arrivalMs, departureMs, dwellSec, radiusM, pointCount, address, isOngoing)
  private fun stop(o: JSONObject): StopNode = StopNode(
    o.getInt("index"),
    o.getDouble("latitude"),
    o.getDouble("longitude"),
    o.getLong("arrivalMs"),
    if (o.has("departureMs")) o.getLong("departureMs") else null,
    o.getLong("dwellSec"),
    o.getDouble("radiusM"),
    o.getInt("pointCount"),
    if (o.has("address")) o.getString("address") else null,
    o.getBoolean("isOngoing"),
  )

  // ArrowAnchor(lat, lng, bearing, segment).
  private fun arrow(o: JSONObject): ArrowAnchor = ArrowAnchor(
    o.getDouble("latitude"),
    o.getDouble("longitude"),
    o.getDouble("bearing"),
    o.getInt("segment"),
  )

  // Bounds(north, south, east, west).
  private fun bounds(o: JSONObject): Bounds = Bounds(
    o.getDouble("north"),
    o.getDouble("south"),
    o.getDouble("east"),
    o.getDouble("west"),
  )

  // Wire "travel"/"stop" (lowerCamel) -> SegmentType.TRAVEL/STOP.
  private fun segmentType(wire: String): SegmentType =
    SegmentType.valueOf(camelToScreamingSnake(wire))

  private fun camelToScreamingSnake(s: String): String =
    s.replace(Regex("([a-z])([A-Z])"), "$1_$2").uppercase()

  // Documented scalar/bool styling only; colours are a reconciliation item (Color.parseColor on the
  // arrowColor/basePathColor wire fields). Uses the SDK default RendererOptions() as the base.
  fun rendererOptions(json: String?): TrackRenderer.RendererOptions {
    val d = TrackRenderer.RendererOptions()
    if (json == null) return d
    val o = JSONObject(json)
    return d.copy(
      showArrows = o.optBoolean("showArrows", d.showArrows),
      showStopMarkers = o.optBoolean("showStopMarkers", d.showStopMarkers),
      arrowSizePx = o.optInt("arrowSizePx", d.arrowSizePx),
      cameraPaddingPx = o.optInt("cameraPaddingPx", d.cameraPaddingPx),
      cameraPaddingFallbackPx = o.optInt("cameraPaddingFallbackPx", d.cameraPaddingFallbackPx),
      basePathWidth = o.optDouble("basePathWidth", d.basePathWidth.toDouble()).toFloat(),
      speedOverlayWidth = o.optDouble("speedOverlayWidth", d.speedOverlayWidth.toDouble()).toFloat(),
      speedOverlayAlpha = o.optInt("speedOverlayAlpha", d.speedOverlayAlpha),
    )
  }

  private inline fun <T> list(a: JSONArray, map: (JSONObject) -> T): List<T> =
    ArrayList<T>(a.length()).apply {
      for (i in 0 until a.length()) add(map(a.getJSONObject(i)))
    }

  private fun stringList(a: JSONArray): List<String> =
    ArrayList<String>(a.length()).apply {
      for (i in 0 until a.length()) add(a.getString(i))
    }

  private fun longMap(o: JSONObject): Map<String, Long> {
    val m = LinkedHashMap<String, Long>()
    val keys = o.keys()
    while (keys.hasNext()) {
      val k = keys.next()
      m[k] = o.getLong(k)
    }
    return m
  }
}

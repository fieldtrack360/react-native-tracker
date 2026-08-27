import UIKit
import SwiftUI
import TrackerCore
import TrackerGeo
import MapKit
import TrackerMaps

// — iOS map hosts. These @objc UIView subclasses own the SwiftUI hosting; the ObjC++
// Fabric component views (TrackMapViewComponentView.mm / LiveTrackMapViewComponentView.mm) forward
// the decoded props to them and marshal the native callbacks back to the Fabric EventEmitter.
//
// Why SwiftUI must live here: TrackerMaps.TrackMapView is `struct: View` and
// TrackerMaps.LiveTrackMapView is a `UIViewRepresentable`, both requiring TrackerGeo types that
// only Swift can name. The ObjC++ layer cannot construct them, so it delegates to these classes
// through the generated "Tracker-Swift.h" (module name = pod name).

// ── Wire → native reconstruction (see reconstructionNotes) ────────────────────

enum TrackerMapReconstruct {

  /// Wire colour -> SwiftUI Color. Accepts "#RGB", "#RGBA", "#RRGGBB", "#RRGGBBAA" (with or
  /// without the leading "#"). Anything else returns nil so the caller keeps the SDK default —
  /// a typo in a style prop must never blank out the path.
  static func color(_ raw: Any?) -> Color? {
    guard let s = (raw as? String)?.trimmingCharacters(in: .whitespaces) else { return nil }
    var hex = s.hasPrefix("#") ? String(s.dropFirst()) : s
    // Expand the shorthand forms: RGB(A) -> RRGGBB(AA).
    if hex.count == 3 || hex.count == 4 {
      hex = hex.map { "\($0)\($0)" }.joined()
    }
    guard hex.count == 6 || hex.count == 8,
          let value = UInt64(hex, radix: 16) else { return nil }
    let hasAlpha = hex.count == 8
    let r = Double((value >> (hasAlpha ? 24 : 16)) & 0xFF) / 255
    let g = Double((value >> (hasAlpha ? 16 : 8)) & 0xFF) / 255
    let b = Double((value >> (hasAlpha ? 8 : 0)) & 0xFF) / 255
    let a = hasAlpha ? Double(value & 0xFF) / 255 : 1
    return Color(.sRGB, red: r, green: g, blue: b, opacity: a)
  }

  /// Rebuild a TrackerGeo.Track from the wire Track JSON (src/types/track.ts).
  ///
  /// TrackerGeo.Track is `Codable` with a `public init(from:)` but NO public memberwise init, so
  /// JSONDecoder is the only way to build one. The wire JSON was produced by THIS platform's
  /// TrackerMappers.trackDict, which renames a handful of keys off the native Codable form; we
  /// invert exactly those renames and decode. Faithful and total for the whole Track tree — every
  /// native field is present in the wire (a track is always built and rendered on the same device,
  /// so we only ever invert our own mapper's output, never Android's zero-overlap shape).
  ///
  /// Inversions (wire -> native Codable keys):
  ///   sessionId            -> sessionID
  ///   stats.distanceMeters -> stats.totalDistanceMeters
  ///   stats.durationSec    -> stats.totalDurationSec
  ///   stats.android        -> dropped (iOS never had it)
  ///   segment.ios.travelStartMs -> segment.travelStartMs   (lift, drop the `ios` wrapper)
  ///   points[].android     -> dropped (iOS never had it)
  /// stops/arrows/bounds already use the native key names on iOS.
  static func track(fromWireJSON json: String) -> Track? {
    guard let data = json.data(using: .utf8),
          var root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return nil
    }

    if let sid = root.removeValue(forKey: "sessionId") { root["sessionID"] = sid }

    if var stats = root["stats"] as? [String: Any] {
      if let d = stats.removeValue(forKey: "distanceMeters") { stats["totalDistanceMeters"] = d }
      if let d = stats.removeValue(forKey: "durationSec") { stats["totalDurationSec"] = d }
      stats.removeValue(forKey: "android")
      root["stats"] = stats
    }

    if let points = root["points"] as? [[String: Any]] {
      root["points"] = points.map { p -> [String: Any] in
        var p = p; p.removeValue(forKey: "android"); return p
      }
    }

    if let segments = root["segments"] as? [[String: Any]] {
      root["segments"] = segments.map { seg -> [String: Any] in
        var s = seg
        if let ios = s.removeValue(forKey: "ios") as? [String: Any],
           let tsm = ios["travelStartMs"] {
          s["travelStartMs"] = tsm
        }
        return s
      }
    }

    guard let normalized = try? JSONSerialization.data(withJSONObject: root),
          let track = try? JSONDecoder().decode(Track.self, from: normalized) else {
      return nil
    }
    return track
  }

  /// Map the wire followMode string to the iOS CameraFollowMode.
  static func cameraFollowMode(_ raw: String?) -> CameraFollowMode {
    switch raw {
    case "follow": return .follow
    case "followBearing": return .followBearing
    default: return .none
    }
  }

  /// Apply the documented overrides from the divergent `options` JSON onto a fresh RenderOptions.
  /// Scalars/bools come through as numbers; every colour is a hex string ("#RRGGBB[AA]") and an
  /// unparseable one keeps the SDK default rather than blanking the layer it styles.
  static func renderOptions(fromWireJSON json: String?) -> RenderOptions {
    var o = RenderOptions()
    guard let json, let data = json.data(using: .utf8),
          let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return o
    }
    if let v = m["showArrows"] as? Bool { o.showArrows = v }
    // Path colours. basePathColor is the casing drawn UNDER the speed bands, so a dark base with a
    // narrower, brighter speedOverlayWidth reads as an outlined route instead of a flat slab.
    if let c = color(m["basePathColor"]) { o.basePathColor = c }
    if let c = color(m["gapColor"]) { o.gapColor = c }
    if let c = color(m["speedBandGreen"]) { o.speedBandGreen = c }
    if let c = color(m["speedBandYellow"]) { o.speedBandYellow = c }
    if let c = color(m["speedBandRed"]) { o.speedBandRed = c }
    if let v = m["showStopPins"] as? Bool { o.showStopPins = v }
    if let v = (m["arrowSize"] as? NSNumber)?.doubleValue { o.arrowSize = CGFloat(v) }
    if let v = (m["stopPinSize"] as? NSNumber)?.doubleValue { o.stopPinSize = CGFloat(v) }
    if let v = (m["basePathWidth"] as? NSNumber)?.doubleValue { o.basePathWidth = CGFloat(v) }
    if let v = (m["speedOverlayWidth"] as? NSNumber)?.doubleValue { o.speedOverlayWidth = CGFloat(v) }
    if let v = (m["speedOverlayOpacity"] as? NSNumber)?.doubleValue { o.speedOverlayOpacity = v }
    if let v = (m["cameraPadding"] as? NSNumber)?.doubleValue { o.cameraPadding = CGFloat(v) }
    if let v = (m["twoPointCameraPadding"] as? NSNumber)?.doubleValue { o.twoPointCameraPadding = CGFloat(v) }
    if let v = (m["ongoingPulseSeconds"] as? NSNumber)?.doubleValue { o.ongoingPulseSeconds = v }
    // Gap styling (SegmentType.gap — the unobserved span the renderer draws dashed and grey).
    // gapColor is parsed with the other colours above.
    if let v = (m["gapLineWidth"] as? NSNumber)?.doubleValue { o.gapLineWidth = CGFloat(v) }
    if let v = m["gapDashLengths"] as? [NSNumber], !v.isEmpty {
      o.gapDashLengths = v.map { CGFloat($0.doubleValue) }
    }
    return o
  }

  /// Live renderer styling from the divergent `options` JSON. followMode comes from the dedicated
  /// prop (applied by the caller), not from here. iOS-only follow framing:
  /// followDistanceMeters / followPitchDegrees (NOT followZoom/followTilt — do not unify).
  static func liveOptions(fromWireJSON json: String?) -> LiveOptions {
    var o = LiveOptions()
    guard let json, let data = json.data(using: .utf8),
          let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return o
    }
    if let c = color(m["tailColor"]) { o.tailColor = c }
    if let c = color(m["headColor"]) { o.headColor = c }
    if let c = color(m["puckColor"]) { o.puckColor = c }
    if let c = color(m["haloColor"]) { o.haloColor = c }
    if let v = (m["tailWidth"] as? NSNumber)?.doubleValue { o.tailWidth = CGFloat(v) }
    if let v = (m["headWidth"] as? NSNumber)?.doubleValue { o.headWidth = CGFloat(v) }
    if let v = (m["puckSize"] as? NSNumber)?.doubleValue { o.puckSize = CGFloat(v) }
    if let v = (m["haloFillOpacity"] as? NSNumber)?.doubleValue { o.haloFillOpacity = v }
    if let v = (m["haloStrokeOpacity"] as? NSNumber)?.doubleValue { o.haloStrokeOpacity = v }
    if let v = (m["lookaheadMs"] as? NSNumber)?.int64Value { o.lookaheadMs = v }
    if let v = (m["animationDurationMs"] as? NSNumber)?.int64Value { o.animationDurationMs = v }
    if let v = (m["followDistanceMeters"] as? NSNumber)?.doubleValue { o.followDistanceMeters = v }
    if let v = (m["followPitchDegrees"] as? NSNumber)?.doubleValue { o.followPitchDegrees = CGFloat(v) }
    return o
  }
}


// ── TEMPORARY diagnostic — Apple attribution ("Maps / Legal") sits ~100pt above the map bottom.
// Dumps the geometry chain from the RN host down to the MKMapView so the offset can be attributed
// to a real inset instead of guessed at. Remove once the cause is fixed.
@MainActor
enum TrackerMapDiagnostics {

  static func dump(_ tag: String, host: UIView, hostingView: UIView?) {
    let insets = { (v: UIView) in
      "safe=\(fmt(v.safeAreaInsets)) margins=\(fmt(v.layoutMargins))"
    }
    print("[TrackerMapDiag] \(tag) host bounds=\(fmt(host.bounds)) \(insets(host))")
    if let hv = hostingView {
      print("[TrackerMapDiag] \(tag) hosting frame=\(fmt(hv.frame)) \(insets(hv))")
    }
    guard let map = firstMapView(in: hostingView ?? host) else {
      print("[TrackerMapDiag] \(tag) no MKMapView found")
      return
    }
    print("[TrackerMapDiag] \(tag) map frame=\(fmt(map.frame)) " +
          "inWindow=\(fmt(map.convert(map.bounds, to: nil))) \(insets(map))")
    // Whatever positions the logo is a subview of the map; list the shallow ones with their frames.
    for sub in map.subviews {
      print("[TrackerMapDiag] \(tag)   mapsub \(type(of: sub)) frame=\(fmt(sub.frame))")
    }
    // Walk up from the map to the host, reporting anyone contributing an inset.
    var v: UIView? = map
    while let cur = v, cur !== host {
      print("[TrackerMapDiag] \(tag)   chain \(type(of: cur)) frame=\(fmt(cur.frame)) \(insets(cur))")
      v = cur.superview
    }
  }

  private static func firstMapView(in view: UIView) -> MKMapView? {
    if let m = view as? MKMapView { return m }
    for sub in view.subviews {
      if let m = firstMapView(in: sub) { return m }
    }
    return nil
  }

  private static func fmt(_ r: CGRect) -> String {
    String(format: "(%.0f,%.0f %.0fx%.0f)", r.origin.x, r.origin.y, r.width, r.height)
  }

  private static func fmt(_ i: UIEdgeInsets) -> String {
    String(format: "(t%.0f l%.0f b%.0f r%.0f)", i.top, i.left, i.bottom, i.right)
  }
}

// ── <TrackMapView> host — SwiftUI TrackMapView in a UIHostingController ────────

@objc(TrackMapHostView)
@MainActor
public final class TrackMapHostView: UIView {

  private var hosting: UIHostingController<AnyView>?
  private var trackJSON: String?
  private var optionsJSON: String?

  /// Set by the ObjC++ component view; marshals TrackMapView.onArrowZoomChange -> onArrowZoom.
  @objc public var onArrowZoom: ((Float) -> Void)?

  @objc public func update(trackJSON: String?, optionsJSON: String?) {
    self.trackJSON = trackJSON
    self.optionsJSON = optionsJSON
    rebuild()
  }

  private func rebuild() {
    guard let json = trackJSON,
          let track = TrackerMapReconstruct.track(fromWireJSON: json) else {
      return // undecodable track -> render nothing (do not crash); never recompute geometry.
    }
    let opts = TrackerMapReconstruct.renderOptions(fromWireJSON: optionsJSON)
    let view = TrackMapView(track: track, options: opts, onArrowZoomChange: { [weak self] zoom in
      self?.onArrowZoom?(zoom)
    })
    // .ignoresSafeArea() is the half that actually moves the Apple attribution. safeAreaRegions
    // below strips the insets the CONTAINER would hand down; this strips the ones the SwiftUI
    // layout would still honour, so Map pins "Maps / Legal" to its own bounds — the map's bottom
    // left corner — instead of floating it up over the middle of the card.
    let root = AnyView(view.ignoresSafeArea())
    if let hc = hosting {
      hc.rootView = root
    } else {
      let hc = UIHostingController(rootView: root)
      // The SwiftUI Map pins the Apple attribution ("Maps / Legal") above its SAFE AREA bottom,
      // not its bounds. A hosting controller inherits safe-area insets from the ancestor chain, so
      // a map embedded in a scrolling card picks up the window's bottom inset (and the scroll
      // view's adjusted inset) and floats the attribution up into the middle of the map. The host
      // view is always laid out to an explicit RN frame — there is no safe area to respect here.
      hc.safeAreaRegions = []
      hc.view.insetsLayoutMarginsFromSafeArea = false
      hc.view.backgroundColor = .clear
      hc.view.frame = bounds
      hc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(hc.view)
      hosting = hc
      attachHostingIfPossible(hc)
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    hosting?.view.frame = bounds
    TrackerMapDiagnostics.dump("track", host: self, hostingView: hosting?.view)
  }

  /// Fabric teardown: called from the ObjC++ view's -prepareForRecycle. SwiftUI/MKMapView is torn
  /// down by dropping the hosting controller (iOS has no renderer.clear() — dismantleUIView does it).
  @objc public func teardown() {
    onArrowZoom = nil
    if let hc = hosting {
      hc.willMove(toParent: nil)
      hc.view.removeFromSuperview()
      hc.removeFromParent()
    }
    hosting = nil
    trackJSON = nil
    optionsJSON = nil
  }

  private func attachHostingIfPossible(_ hc: UIHostingController<AnyView>) {
    var responder: UIResponder? = self
    while let r = responder {
      if let vc = r as? UIViewController { vc.addChild(hc); hc.didMove(toParent: vc); return }
      responder = r.next
    }
  }
}

// ── <LiveTrackMapView> host — SwiftUI LiveTrackMapView (a UIViewRepresentable over MKMapView) ──

@objc(LiveTrackMapHostView)
@MainActor
public final class LiveTrackMapHostView: UIView {

  private var hosting: UIHostingController<AnyView>?
  private var followMode: CameraFollowMode = .none
  private var initialCentre: GeoPoint?
  private var optionsJSON: String?
  private var latest: LiveTrackUpdate?
  private var isFollowing: Bool = true
  private var feed: Task<Void, Never>?

  /// Set by the ObjC++ component view; marshals the isFollowing Binding -> onFollowingChange.
  @objc public var onFollowingChange: ((Bool) -> Void)?

  // NOTE (reconstructionNotes): the wire `update` string is NOT used to build geometry on iOS —
  // TrackerGeo.LiveTrackUpdate is not Codable and has no accessible initializer, so it cannot be
  // reconstructed from JSON. The host instead consumes the native Tracker.shared.liveTrack() stream
  // directly and hands real LiveTrackUpdate values to the SwiftUI view. `updateJSON` is accepted
  // for API symmetry (and could gate liveness) but is otherwise ignored here.
  @objc public func update(updateJSON: String?,
                           optionsJSON: String?,
                           followMode: String?,
                           initialCentreLat: NSNumber?,
                           initialCentreLng: NSNumber?) {
    self.optionsJSON = optionsJSON
    self.followMode = TrackerMapReconstruct.cameraFollowMode(followMode)
    if let lat = initialCentreLat?.doubleValue, let lng = initialCentreLng?.doubleValue {
      self.initialCentre = GeoPoint(latitude: lat, longitude: lng)
    }
    startFeedIfNeeded()
    rebuild()
  }

  private func startFeedIfNeeded() {
    guard feed == nil else { return }
    feed = Task { @MainActor [weak self] in
      guard let self else { return }
      for await frame in Tracker.shared.liveTrack() {
        if Task.isCancelled { break }
        self.latest = frame
        self.rebuild()
      }
    }
  }

  private func rebuild() {
    var opts = TrackerMapReconstruct.liveOptions(fromWireJSON: optionsJSON)
    opts.followMode = followMode

    let binding = Binding<Bool>(
      get: { [weak self] in self?.isFollowing ?? true },
      set: { [weak self] newValue in
        guard let self, self.isFollowing != newValue else { return }
        self.isFollowing = newValue
        self.onFollowingChange?(newValue)
      }
    )

    let view = LiveTrackMapView(update: latest,
                                options: opts,
                                isFollowing: binding,
                                initialCentre: initialCentre)
    // .ignoresSafeArea() is the half that actually moves the Apple attribution. safeAreaRegions
    // below strips the insets the CONTAINER would hand down; this strips the ones the SwiftUI
    // layout would still honour, so Map pins "Maps / Legal" to its own bounds — the map's bottom
    // left corner — instead of floating it up over the middle of the card.
    let root = AnyView(view.ignoresSafeArea())
    if let hc = hosting {
      hc.rootView = root
    } else {
      let hc = UIHostingController(rootView: root)
      // The SwiftUI Map pins the Apple attribution ("Maps / Legal") above its SAFE AREA bottom,
      // not its bounds. A hosting controller inherits safe-area insets from the ancestor chain, so
      // a map embedded in a scrolling card picks up the window's bottom inset (and the scroll
      // view's adjusted inset) and floats the attribution up into the middle of the map. The host
      // view is always laid out to an explicit RN frame — there is no safe area to respect here.
      hc.safeAreaRegions = []
      hc.view.insetsLayoutMarginsFromSafeArea = false
      hc.view.backgroundColor = .clear
      hc.view.frame = bounds
      hc.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      addSubview(hc.view)
      hosting = hc
      attachHostingIfPossible(hc)
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    hosting?.view.frame = bounds
    TrackerMapDiagnostics.dump("live", host: self, hostingView: hosting?.view)
  }

  @objc public func teardown() {
    feed?.cancel()
    feed = nil
    onFollowingChange = nil
    if let hc = hosting {
      hc.willMove(toParent: nil)
      hc.view.removeFromSuperview()
      hc.removeFromParent()
    }
    hosting = nil
    latest = nil
  }

  private func attachHostingIfPossible(_ hc: UIHostingController<AnyView>) {
    var responder: UIResponder? = self
    while let r = responder {
      if let vc = r as? UIViewController { vc.addChild(hc); hc.didMove(toParent: vc); return }
      responder = r.next
    }
  }
}

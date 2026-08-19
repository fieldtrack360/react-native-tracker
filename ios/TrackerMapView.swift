import UIKit
import SwiftUI
import TrackerCore
import TrackerGeo
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

  /// Apply the documented SCALAR/bool overrides from the divergent `options` JSON onto a fresh
  /// RenderOptions. Colours and the rest are left at their SDK defaults (reconciliation: parse the
  /// remaining iOS-only RenderOptions fields — speedBand colours, halo opacities — as needed).
  static func renderOptions(fromWireJSON json: String?) -> RenderOptions {
    var o = RenderOptions()
    guard let json, let data = json.data(using: .utf8),
          let m = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
      return o
    }
    if let v = m["showArrows"] as? Bool { o.showArrows = v }
    if let v = m["showStopPins"] as? Bool { o.showStopPins = v }
    if let v = (m["arrowSize"] as? NSNumber)?.doubleValue { o.arrowSize = CGFloat(v) }
    if let v = (m["stopPinSize"] as? NSNumber)?.doubleValue { o.stopPinSize = CGFloat(v) }
    if let v = (m["basePathWidth"] as? NSNumber)?.doubleValue { o.basePathWidth = CGFloat(v) }
    if let v = (m["speedOverlayWidth"] as? NSNumber)?.doubleValue { o.speedOverlayWidth = CGFloat(v) }
    if let v = (m["speedOverlayOpacity"] as? NSNumber)?.doubleValue { o.speedOverlayOpacity = v }
    if let v = (m["cameraPadding"] as? NSNumber)?.doubleValue { o.cameraPadding = CGFloat(v) }
    if let v = (m["twoPointCameraPadding"] as? NSNumber)?.doubleValue { o.twoPointCameraPadding = CGFloat(v) }
    if let v = (m["ongoingPulseSeconds"] as? NSNumber)?.doubleValue { o.ongoingPulseSeconds = v }
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

// ── <TrackMapView> host — SwiftUI TrackMapView in a UIHostingController ────────

@objc(TrackMapHostView)
@MainActor
public final class TrackMapHostView: UIView {

  private var hosting: UIHostingController<TrackMapView>?
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
    if let hc = hosting {
      hc.rootView = view
    } else {
      let hc = UIHostingController(rootView: view)
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

  private func attachHostingIfPossible(_ hc: UIHostingController<TrackMapView>) {
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

  private var hosting: UIHostingController<LiveTrackMapView>?
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
    if let hc = hosting {
      hc.rootView = view
    } else {
      let hc = UIHostingController(rootView: view)
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

  private func attachHostingIfPossible(_ hc: UIHostingController<LiveTrackMapView>) {
    var responder: UIResponder? = self
    while let r = responder {
      if let vc = r as? UIViewController { vc.addChild(hc); hc.didMove(toParent: vc); return }
      responder = r.next
    }
  }
}

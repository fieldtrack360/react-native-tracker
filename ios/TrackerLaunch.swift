import Foundation
import TrackerCore

// The launch hook. Phase A of two-phase initialisation: the host calls this natively
// from AppDelegate.application(_:didFinishLaunchingWithOptions:) BEFORE it returns, because
// Tracker.shared.ready() reaches BGTaskScheduler.register, and Apple requires every launch
// handler to be registered inside the launch window. React Native starts JS only AFTER
// didFinishLaunching returns, so ready() cannot be driven from JS alone on iOS.
//
// This mirrors the shipped iOS sample, which runs ready() in a Task launched during the
// launch sequence — that is where the SDK registers its background tasks.
@objc(TrackerLaunch)
public final class TrackerLaunch: NSObject {

  /// Loads an optional `tracker.config.json` from the app bundle and calls
  /// `Tracker.shared.ready(config)`. With no file present, SDK defaults are used.
  @objc public static func ready() {
    let config = loadBundledConfig() ?? TrackerConfig()
    Task {
      _ = await Tracker.shared.ready(config)
    }
  }

  /// Optional bundled config. `TrackerConfig` is `Codable`; a missing or unparseable file
  /// falls back to defaults rather than crashing. Phase 7 will read a `sync` block here
  /// for the sync engine's BGProcessingTask registration, which has the same launch-window
  /// constraint.
  private static func loadBundledConfig() -> TrackerConfig? {
    guard let url = Bundle.main.url(forResource: "tracker.config", withExtension: "json"),
          let data = try? Data(contentsOf: url) else {
      return nil
    }
    return try? JSONDecoder().decode(TrackerConfig.self, from: data)
  }
}

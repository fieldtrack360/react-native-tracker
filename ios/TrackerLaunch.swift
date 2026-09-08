import Foundation
import TrackerCore
import TrackerSync

// The launch hook. Phase A of two-phase initialisation: the host calls this natively
// from AppDelegate.application(_:didFinishLaunchingWithOptions:) BEFORE it returns, because
// the SDK reaches BGTaskScheduler.register, and Apple requires every launch handler to be
// registered inside the launch window. React Native starts JS only AFTER didFinishLaunching
// returns, so this cannot be driven from JS alone on iOS.
@objc(TrackerLaunch)
public final class TrackerLaunch: NSObject {

  /// Registers the background-task launch handlers, then loads an optional
  /// `tracker.config.json` from the app bundle and calls `Tracker.shared.ready(config)`.
  /// With no file present, SDK defaults are used.
  ///
  /// The registration is SEPARATE from `ready()` and must stay that way (SDK 1.0.6).
  /// `ready()` is `async` by necessity — it opens storage, resolves the persisted config and
  /// checks the licence — so every `await` in it is a point at which launch can finish first,
  /// and a `BGTaskScheduler.register` after launch raises `NSInternalInconsistencyException`.
  /// That is an ObjC exception, not a Swift error: nothing in the Swift half of the SDK could
  /// catch it and the process was lost. `registerBackgroundTasks()` resolves nothing, opens no
  /// database and returns immediately, so it is safe to call synchronously here.
  ///
  /// On 1.0.6 this is not optional: a DEBUG build's `ready()` FAILS outright when the handlers
  /// were never registered, so omitting it turns every debug run into a dead `ready()`.
  @objc public static func ready() {
    // `Tracker`'s is @MainActor-isolated; `SyncEngine`'s is not. Both are synchronous.
    // didFinishLaunching is the main thread by contract, so assuming the isolation is sound
    // here — and trapping is the right outcome if a host ever calls this from somewhere else,
    // because a registration off the launch window is the bug this whole file exists for.
    MainActor.assumeIsolated { Tracker.shared.registerBackgroundTasks() }
    // Registered unconditionally: the sync engine's retry task carries the same launch-window
    // constraint, and its own `configure()` (called when a user signs in) is always too late.
    // A host that never uses TrackerSync pays one no-op registration.
    SyncEngine.shared.registerBackgroundTasks()
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

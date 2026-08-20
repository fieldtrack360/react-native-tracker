// ios/TrackerModule+Events.swift
//
// Phase 4 subscription layer — iOS half. ONE native Task per active JS subscriber, cancelled on
// unsubscribe. subscribe(stream, arg?) starts the Task and resolves its subscription id;
// unsubscribe(id) cancels it. Each consumed value is emitted as a single device event via the host's
// callableJSModules (see TrackerModule.mm): the .mm installs the `emitter` closure at init, and each
// consumer calls it with (id, payload). Payload is [String: Any] for the typed streams and a JSON
// string for the unbounded point list. Buffering is preserved, never widened — the native
// AsyncStream conflation / event-bus depth is left untouched here.
//
// Streams (TrackerCore/TrackerGeo surfaces):
//   events():          AsyncStream<TrackerEvent>             (TrackerCore)  depth 64 / replay 0 — native bus
//   liveTrack():       AsyncStream<LiveTrackUpdate>          (TrackerCore)  capacity 1 — a frame is a replacement
//   observePoints(_:): AsyncStream<[TrackPoint]>             (TrackerCore)
//   providerState():   AsyncStream<ProviderState>            (TrackerCore)
//   batteryState():    AsyncStream<BatteryInfo>              (TrackerCore)  replays on attach
//   state:             @Observable TrackerState (@MainActor) (TrackerCore +) — Observation, not a stream
import Foundation
import Observation
import TrackerCore
import TrackerGeo

// Swift extensions cannot hold stored properties, so subscription state lives in this file-scoped
// store (one Task per id, plus a set of live ids so the state observer's first step — which can run
// before the Task is registered — sees an active subscription).
private final class EventSubscriptionStore {
  static let shared = EventSubscriptionStore()
  private let lock = NSLock()
  private var tasks: [Int: Task<Void, Never>] = [:]
  private var activeIds: Set<Int> = []
  private var nextId = 1
  // Installed by TrackerModule.mm; forwards (id, payload) to RCTDeviceEventEmitter.emit.
  var emitter: ((Int, Any) -> Void)?

  func reserve() -> Int {
    lock.lock(); defer { lock.unlock() }
    let id = nextId; nextId += 1; activeIds.insert(id); return id
  }
  func store(_ id: Int, _ task: Task<Void, Never>) {
    lock.lock(); tasks[id] = task; lock.unlock()
  }
  func isActive(_ id: Int) -> Bool {
    lock.lock(); defer { lock.unlock() }; return activeIds.contains(id)
  }
  func remove(_ id: Int) -> Task<Void, Never>? {
    lock.lock(); defer { lock.unlock() }
    activeIds.remove(id); return tasks.removeValue(forKey: id)
  }
  func cancelAll() {
    lock.lock()
    let all = tasks
    tasks.removeAll(); activeIds.removeAll()
    lock.unlock()
    all.values.forEach { $0.cancel() }
  }
}

extension TrackerImpl {

  /// Installed once by the ObjC++ host at init. `payload` is an NSDictionary (typed streams) or an
  /// NSString (the JSON point list); the host wraps it as { id, payload } and calls
  /// RCTDeviceEventEmitter.emit.
  @objc(setEmitter:)
  public static func setEmitter(_ block: @escaping (Int, Any) -> Void) {
    EventSubscriptionStore.shared.emitter = block
  }

  /// subscribe(stream, arg?): starts ONE Task and resolves the subscription id. `arg` is the
  /// sessionId for observePoints; ignored otherwise. An unknown stream rejects (bridge fault).
  @objc(subscribeStream:arg:onResolve:onReject:)
  public static func subscribe(stream: NSString, arg: NSString?,
                               onResolve: @escaping (NSNumber) -> Void,
                               onReject: @escaping (NSString, NSString) -> Void) {
    let store = EventSubscriptionStore.shared
    let id = store.reserve()
    let name = stream as String
    let sessionID = arg as String?

    let task: Task<Void, Never>
    switch name {
    case "events":        task = Task { await consumeEvents(id: id) }
    case "liveTrack":     task = Task { await consumeLiveTrack(id: id) }
    case "observePoints": task = Task { await consumeObservePoints(id: id, sessionID: sessionID ?? "") }
    case "providerState": task = Task { await consumeProviderState(id: id) }
    case "state":         task = Task { await consumeState(id: id) }
    case "battery":       task = Task { await consumeBattery(id: id) }
    default:
      _ = store.remove(id)
      onReject("invalidConfig" as NSString, "unknown stream: \(name)" as NSString)
      return
    }
    store.store(id, task)
    onResolve(NSNumber(value: id))
  }

  /// unsubscribe(id): cancels the one Task for this subscriber. Cancellation ends each consumer's
  /// `for await` (AsyncStream is cancellation-aware) and, for state, stops the Observation re-arm.
  @objc(unsubscribeId:onResolve:onReject:)
  public static func unsubscribe(id: Int,
                                 onResolve: @escaping () -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    EventSubscriptionStore.shared.remove(id)?.cancel()
    onResolve()
  }

  /// teardown — cancel every active subscriber Task on module dealloc / bridge reload so no
  /// consumer outlives the module (parity with Android's scope.cancel() in invalidate()).
  @objc(cancelAllSubscriptions)
  public static func cancelAllSubscriptions() {
    EventSubscriptionStore.shared.cancelAll()
    EventSubscriptionStore.shared.emitter = nil
  }

  // MARK: - Per-stream consumers

  private static func emit(_ id: Int, _ payload: Any) {
    EventSubscriptionStore.shared.emitter?(id, payload)
  }

  /// events — the 19-case union (iOS emits 17 of them). Depth 64 / replay 0 is the native bus; the
  /// plain `for await` adds no buffer.
  private static func consumeEvents(id: Int) async {
    for await event in Tracker.shared.events() {
      if Task.isCancelled { return }
      emit(id, TrackerMappers.eventDict(event) as NSDictionary)
    }
  }

  /// liveTrack — capacity 1; each frame is a replacement (the SDK already conflates).
  private static func consumeLiveTrack(id: Int) async {
    for await update in Tracker.shared.liveTrack() {
      if Task.isCancelled { return }
      emit(id, TrackerMappers.liveTrackDict(update) as NSDictionary)
    }
  }

  /// observePoints — the point list is unbounded so it crosses as a JSON string.
  private static func consumeObservePoints(id: Int, sessionID: String) async {
    for await points in Tracker.shared.observePoints(sessionID: sessionID) {
      if Task.isCancelled { return }
      let arr = points.map { TrackerMappers.trackPointDict($0) }
      guard let data = try? JSONSerialization.data(withJSONObject: arr, options: []) else { continue }
      emit(id, String(decoding: data, as: UTF8.self) as NSString)
    }
  }

  /// battery — batteryState() replays the current reading on attach, then one value per
  /// transition; StateFlow-like, matching Android's collect().
  private static func consumeBattery(id: Int) async {
    for await battery in Tracker.shared.batteryState() {
      if Task.isCancelled { return }
      emit(id, TrackerMappers.batteryDict(battery) as NSDictionary)
    }
  }

  /// providerState — the AsyncStream replays the current value on attach; StateFlow-like.
  private static func consumeProviderState(id: Int) async {
    for await state in Tracker.shared.providerState() {
      if Task.isCancelled { return }
      emit(id, TrackerMappers.providerStateDict(state) as NSDictionary)
    }
  }

  /// state — `TrackerState` is @Observable (@MainActor), NOT an AsyncStream. Bridge Observation →
  /// AsyncStream by re-registering `withObservationTracking` after every change (iOS 17+, matching the
  /// package floor). The current snapshot is yielded on subscribe; re-arming stops once the id is no
  /// longer active (unsubscribe), and cancelling the Task breaks the parked `for await`.
  private static func consumeState(id: Int) async {
    let stream = AsyncStream<[String: Any]> { continuation in
      @MainActor func step() {
        guard EventSubscriptionStore.shared.isActive(id) else { continuation.finish(); return }
        let dict = withObservationTracking {
          TrackerMappers.stateDict(Tracker.shared.state)
        } onChange: {
          Task { @MainActor in step() }
        }
        continuation.yield(dict)
      }
      Task { @MainActor in step() }
    }
    for await dict in stream {
      if Task.isCancelled { break }
      emit(id, dict as NSDictionary)
    }
  }
}
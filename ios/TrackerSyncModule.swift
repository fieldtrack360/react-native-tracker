import Foundation
import TrackerCore
import TrackerSync

// Swift implementation behind the ObjC++ TurboModule host (TrackerSyncModule.mm) for the SEPARATE
// "TrackerSync" module. Mirrors the main module's TrackerImpl: @objc static entry points
// taking plain ObjC block closures, so no React headers are needed here — the .mm owns the
// RCTPromise blocks and wraps them.
//
// Surface it drives:
//   SyncEngine.shared                                                            (:30)
//   configure(_ config, store: any PendingUploadStore, transport: SyncTransport? = nil)  (:32)
//   requestSync()                                                                 (:42)
//   syncNow() async -> SyncQueue.Result                                           (:44)
//   healthLoopTrigger() -> @Sendable () async -> Void                             (:45)
//   pendingCount() async -> TrackerCore.TrackerResult<Int>                        (:46)
//   events() -> AsyncStream<SyncEvent>                                            (:47)
// plus, from TrackerCore.swiftinterface:
//   Tracker.shared.pendingUploads: any PendingUploadStore { get }                 (:368)
//   Tracker.shared.setSyncTrigger(_:) async                                       (:372)
//
// Result policy: a domain failure RESOLVES the envelope; the Promise REJECTS only for a
// bridge fault — here, config JSON that will not decode or a url that will not parse (invalidConfig).

// Swift extensions cannot hold stored properties, so the ios.onSyncEvent subscription state lives in
// this file-scoped store: one native Task per JS subscriber, cancelled on unsubscribe. DISTINCT from
// the main module's store (separate module, separate device event "TrackerSyncEmit").
private final class SyncSubscriptionStore {
  static let shared = SyncSubscriptionStore()
  private let lock = NSLock()
  private var tasks: [Int: Task<Void, Never>] = [:]
  private var nextId = 1
  // Installed by TrackerSyncModule.mm; forwards (id, payload) to RCTDeviceEventEmitter.emit.
  var emitter: ((Int, Any) -> Void)?

  func reserve() -> Int {
    lock.lock(); defer { lock.unlock() }
    let id = nextId; nextId += 1; return id
  }
  func store(_ id: Int, _ task: Task<Void, Never>) {
    lock.lock(); tasks[id] = task; lock.unlock()
  }
  func remove(_ id: Int) -> Task<Void, Never>? {
    lock.lock(); defer { lock.unlock() }
    return tasks.removeValue(forKey: id)
  }
  func cancelAll() {
    lock.lock()
    let all = tasks
    tasks.removeAll()
    lock.unlock()
    all.values.forEach { $0.cancel() }
  }
}

@objc(TrackerSyncImpl)
public final class TrackerSyncImpl: NSObject {

  // MARK: - configure

  /// configure(configJson). Parses the wire JSON into a native `TrackerSync.SyncConfig`
  /// (SyncMappers.syncConfig(fromWire:) throws on undecodable JSON / an unparseable url →
  /// invalidConfig, the bridge-fault path). Then wires the two UNEXPOSED iOS seams INSIDE the impl:
  /// the pending-upload store (Tracker.shared.pendingUploads) and the health-loop sync
  /// trigger (Tracker.shared.setSyncTrigger(SyncEngine.shared.healthLoopTrigger())). `configure` is
  /// synchronous on SyncEngine; `setSyncTrigger` is `async`, so both run inside one Task.
  @objc(configureConfigJSON:onResolve:onReject:)
  public static func configure(configJSON: NSString,
                               onResolve: @escaping () -> Void,
                               onReject: @escaping (NSString, NSString) -> Void) {
    let json = configJSON as String
    let config: SyncConfig
    do {
      config = try SyncMappers.syncConfig(fromWire: json)
    } catch let e as SyncMapperError {
      onReject("invalidConfig" as NSString, e.message as NSString)
      return
    } catch {
      onReject("invalidConfig" as NSString, String(describing: error) as NSString)
      return
    }
    Task {
      // pendingUploads must be consumed here and never exposed to JS; Android has no
      // equivalent. transport: nil → the SDK's default URLSessionSyncTransport.
      SyncEngine.shared.configure(config, store: Tracker.shared.pendingUploads, transport: nil)
      await Tracker.shared.setSyncTrigger(SyncEngine.shared.healthLoopTrigger())
      onResolve()
    }
  }

  // MARK: - requestSync

  /// requestSync() — synchronous void on SyncEngine; forwards only (callable after accepted
  /// points even when autoSync is true). Resolves immediately.
  @objc(requestSyncOnResolve:onReject:)
  public static func requestSync(onResolve: @escaping () -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    SyncEngine.shared.requestSync()
    onResolve()
  }

  // MARK: - syncNow

  /// syncNow() -> the four-case result. `SyncQueue.Result` is mapped to { kind, count?, reason? }.
  @objc(syncNowOnResolve:onReject:)
  public static func syncNow(onResolve: @escaping (NSDictionary) -> Void,
                             onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let result = await SyncEngine.shared.syncNow()
      onResolve(SyncMappers.syncResultDict(result) as NSDictionary)
    }
  }

  // MARK: - pendingCount

  /// pendingCount() -> TrackerResult<number>. iOS returns a native TrackerResult<Int>, mapped
  /// directly. iOS `ErrorCode` is String-backed and its rawValue is already the wire vocabulary (incl.
  /// `internalError`), so no remap is needed on iOS — matching the getCurrentLocation precedent.
  @objc(pendingCountOnResolve:onReject:)
  public static func pendingCount(onResolve: @escaping (NSDictionary) -> Void,
                                  onReject: @escaping (NSString, NSString) -> Void) {
    Task {
      let result = await SyncEngine.shared.pendingCount()
      switch result {
      case .success(let count):
        onResolve(["ok": true, "value": count] as NSDictionary)
      case .failure(let code, let message):
        onResolve(["ok": false, "code": code.rawValue, "message": message] as NSDictionary)
      }
    }
  }

  // MARK: - ios.onSyncEvent subscription layer

  /// Installed once by the ObjC++ host at init. `payload` is an NSDictionary (the sync event); the
  /// host wraps it as { id, payload } and calls RCTDeviceEventEmitter.emit on "TrackerSyncEmit".
  @objc(setEmitter:)
  public static func setEmitter(_ block: @escaping (Int, Any) -> Void) {
    SyncSubscriptionStore.shared.emitter = block
  }

  /// subscribeSyncEvents(): starts ONE Task consuming SyncEngine.events() and resolves its id.
  @objc(subscribeSyncEventsOnResolve:onReject:)
  public static func subscribeSyncEvents(onResolve: @escaping (NSNumber) -> Void,
                                         onReject: @escaping (NSString, NSString) -> Void) {
    let store = SyncSubscriptionStore.shared
    let id = store.reserve()
    let task = Task { await consumeSyncEvents(id: id) }
    store.store(id, task)
    onResolve(NSNumber(value: id))
  }

  /// unsubscribe(id): cancels the one Task for this subscriber. Cancellation ends the `for await`
  /// (AsyncStream is cancellation-aware).
  @objc(unsubscribeId:onResolve:onReject:)
  public static func unsubscribe(id: Int,
                                 onResolve: @escaping () -> Void,
                                 onReject: @escaping (NSString, NSString) -> Void) {
    SyncSubscriptionStore.shared.remove(id)?.cancel()
    onResolve()
  }

  /// teardown — cancel every active subscriber Task on module dealloc / bridge reload.
  @objc(cancelAllSubscriptions)
  public static func cancelAllSubscriptions() {
    SyncSubscriptionStore.shared.cancelAll()
    SyncSubscriptionStore.shared.emitter = nil
  }

  /// the sync event stream — httpResponse / uploaded / retryScheduled / authExpired. Plain
  /// `for await` adds no buffer; the AsyncStream's own buffering is left untouched (never widened).
  private static func consumeSyncEvents(id: Int) async {
    for await event in SyncEngine.shared.events() {
      if Task.isCancelled { return }
      SyncSubscriptionStore.shared.emitter?(id, SyncMappers.syncEventDict(event) as NSDictionary)
    }
  }
}
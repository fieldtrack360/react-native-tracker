// ios/SyncMappers.swift
//
// Sync wire vocabulary — the ONLY place the iOS `TrackerSync.SyncConfig` is built
// from the wire JSON and the `SyncQueue.Result` / `SyncEvent` enums are stringified. Kept SEPARATE
// from TrackerMappers: the sync surface lives in a distinct framework (TrackerSync) and a distinct
// TurboModule, and the config is mostly divergent from the main TrackerConfig.
import Foundation
import TrackerSync

// A bad-argument fault for configure(): undecodable JSON, a missing url, or a url that will not parse
// (iOS SyncConfig.url is Foundation.URL). The module maps this to a `invalidConfig` Promise rejection.
enum SyncMapperError: Error {
  case invalidConfig(String)
  var message: String {
    switch self {
    case .invalidConfig(let m): return m
    }
  }
}

enum SyncMappers {

  // MARK: - SyncConfig (wire JSON -> native)

  /// Wire SyncConfig JSON -> native iOS `SyncConfig`. iOS reads shared (url/method/headers/autoSync/
  /// batchSize) + the `ios.*` block (requiresNetworkConnectivity + the iOS-only fields). The Android
  /// gate `android.requiresUnmeteredNetwork` is ignored here — the two network gates are NOT unified.
  /// `url` is Foundation.URL: an unparseable string throws invalidConfig. The struct has
  /// only `init(url:)`; every other field is a `var` with an SDK default, set only when present so an
  /// omitted optional keeps the SDK default (no defaulting in the bridge).
  static func syncConfig(fromWire json: String) throws -> SyncConfig {
    guard let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw SyncMapperError.invalidConfig("sync config JSON is not a JSON object")
    }
    guard let urlStr = obj["url"] as? String, !urlStr.isEmpty else {
      throw SyncMapperError.invalidConfig("sync config is missing a url")
    }
    guard let url = URL(string: urlStr) else {
      throw SyncMapperError.invalidConfig("sync config url is not a valid URL: \(urlStr)")
    }
    var c = SyncConfig(url: url)
    if let v = obj["method"] as? String { c.method = v }
    if let v = obj["headers"] as? [String: String] { c.headers = v }
    if let v = obj["autoSync"] as? Bool { c.autoSync = v }
    if let v = obj["batchSize"] as? NSNumber { c.batchSize = v.intValue }
    if let ios = obj["ios"] as? [String: Any] {
      if let v = ios["requiresNetworkConnectivity"] as? Bool { c.requiresNetworkConnectivity = v }
      if let v = ios["wipeOnAuthExpiry"] as? Bool { c.wipeOnAuthExpiry = v }
      if let v = ios["stopTrackingOnAuthExpiry"] as? Bool { c.stopTrackingOnAuthExpiry = v }
      if let v = ios["backoffInitialSec"] as? NSNumber { c.backoffInitialSec = v.doubleValue }
      if let v = ios["backoffCeilingSec"] as? NSNumber { c.backoffCeilingSec = v.doubleValue }
      if let v = ios["autoSyncCoalesceSec"] as? NSNumber { c.autoSyncCoalesceSec = v.doubleValue }
    }
    return c
  }

  // MARK: - SyncQueue.Result (the four cases)

  /// Native `SyncQueue.Result` -> wire { kind, count?, reason? }. Same four cases on both platforms.
  static func syncResultDict(_ r: SyncQueue.Result) -> [String: Any] {
    switch r {
    case .uploaded(let count): return ["kind": "uploaded", "count": count]
    case .empty: return ["kind": "empty"]
    case .retry(let reason): return ["kind": "retry", "reason": reason]
    case .authExpired: return ["kind": "authExpired"]
    }
  }

  // MARK: - SyncEvent (ios.onSyncEvent — iOS only)

  /// Native `SyncEvent` -> wire { type, statusCode?, count?, afterSec?, reason? }. `httpResponse`
  /// carries `statusCode: Int?` — it is ALWAYS present on the wire and is NSNull when the request
  /// never reached a server.
  static func syncEventDict(_ e: SyncEvent) -> [String: Any] {
    switch e {
    case .httpResponse(let statusCode, let count):
      return ["type": "httpResponse",
              "statusCode": statusCode.map { NSNumber(value: $0) } ?? NSNull(),
              "count": count]
    case .uploaded(let count):
      return ["type": "uploaded", "count": count]
    case .retryScheduled(let afterSec, let reason):
      return ["type": "retryScheduled", "afterSec": afterSec, "reason": reason]
    case .authExpired:
      return ["type": "authExpired"]
    }
  }
}
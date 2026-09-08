// android/src/main/java/com/fieldtrack360/tracker/SyncMappers.kt
//
// Sync wire vocabulary — the ONLY place the Android `SyncConfig` is built from the wire JSON and
// the `SyncQueue.Result` / `SyncEvent` types are stringified. Kept SEPARATE from TrackerMappers: the
// sync surface lives in a distinct module (com.field360.traker.sync) and a distinct TurboModule.
package com.fieldtrack360.tracker

import com.field360.traker.sync.LogLevel
import com.field360.traker.sync.LogRecord
import com.field360.traker.sync.LogSyncConfig
import com.field360.traker.sync.LogSyncQueue
import com.field360.traker.sync.LogType
import com.field360.traker.sync.SyncConfig
import com.field360.traker.sync.SyncEvent
import com.field360.traker.sync.SyncQueue
import com.field360.traker.sync.SyncTimeouts
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONArray
import org.json.JSONObject

object SyncMappers {

  // Wire SyncConfig JSON -> native Android `SyncConfig`. Android reads shared (url/method/headers/
  // autoSync/batchSize) + the `android.*` block ONLY. The iOS gate (ios.requiresNetworkConnectivity)
  // and the iOS-only fields (wipeOnAuthExpiry / backoff* / autoSyncCoalesceSec) are ignored — the
  // two network gates are NOT unified. Android url is a plain String (no URL parse); undecodable
  // JSON / a missing url throws -> the module rejects invalidConfig.
  //
  // Built through `SyncConfig.builder()` and only for keys the wire actually carries, so an OMITTED
  // optional keeps the SDK's OWN default instead of one restated here. That matters: this used to
  // construct positionally with a hardcoded `autoSync = false` fallback while the SDK default is
  // `true`, so a host that never mentioned autoSync silently got auto-upload off on Android and on
  // on iOS. Do not reintroduce literal defaults in this function.
  //
  // `buildUnchecked()`, not `build()`: validation belongs to `TrackerSync.configure()`, which also
  // resolves the url against `TrackerConfig.baseUrl` first. Validating here would reject a bare
  // path that configure() would have completed.
  fun syncConfigFromWire(json: String): SyncConfig {
    val o = JSONObject(json) // throws JSONException on undecodable JSON -> invalidConfig
    val url = o.optString("url", "")
    require(url.isNotEmpty()) { "sync config is missing a url" }

    val b = SyncConfig.builder().url(url)
    if (o.has("method") && !o.isNull("method")) b.method(o.getString("method"))
    o.optJSONObject("headers")?.let { h ->
      val keys = h.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        b.header(k, h.getString(k))
      }
    }
    // extraParams: arbitrary JSON, merged into the top level of every request body before the batch.
    // Added one key at a time so insertion order — which is the order they reach the body — is the
    // order the host wrote them in. A null-valued key is DROPPED: the Android SDK has no null value
    // ("omit the key instead"), while iOS models one and encodes JSON null. That is the single
    // extraParams value whose meaning is not shared, and it is documented on the TS type.
    o.optJSONObject("extraParams")?.let { e ->
      val keys = e.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        if (e.isNull(k)) continue
        b.extraParam(k, jsonToAny(e.get(k), k))
      }
    }

    if (o.has("autoSync")) b.autoSync(o.getBoolean("autoSync"))
    if (o.has("batchSize")) b.batchSize(o.getInt("batchSize"))

    o.optJSONObject("android")?.let { a ->
      if (a.has("requiresUnmeteredNetwork")) {
        b.requiresUnmeteredNetwork(a.getBoolean("requiresUnmeteredNetwork"))
      }
      if (a.has("gzipRequestBody")) b.gzipRequestBody(a.getBoolean("gzipRequestBody"))
      if (a.has("allowCleartext")) b.allowCleartext(a.getBoolean("allowCleartext"))
      // timeouts: partial objects are supported, so each leg falls back to the SDK's own default
      // rather than to a number written here.
      a.optJSONObject("timeouts")?.let { t ->
        val d = SyncTimeouts()
        b.timeouts(
          if (t.has("connectMs")) t.getLong("connectMs") else d.connectMs,
          if (t.has("readMs")) t.getLong("readMs") else d.readMs,
          if (t.has("writeMs")) t.getLong("writeMs") else d.writeMs,
        )
      }
    }
    return b.buildUnchecked()
  }

  // One extraParams JSON value -> the plain Kotlin value the SDK takes (`Map<String, Any>` of
  // String / Boolean / boxed number / Map / List). org.json already boxes the scalars as
  // String/Boolean/Integer/Long/Double, so those pass through untouched and a number stays a number
  // on the wire; only the containers are rewrapped.
  //
  // A null inside an OBJECT is dropped, as at the top level. A null inside an ARRAY is not: dropping
  // it would renumber every element after it, so it throws and configure() rejects invalidConfig,
  // naming the key. `path` is that key, carried down only so the message can point at it.
  private fun jsonToAny(v: Any, path: String): Any = when (v) {
    is JSONObject -> buildMap {
      for (k in v.keys()) {
        if (v.isNull(k)) continue
        put(k, jsonToAny(v.get(k), "$path.$k"))
      }
    }
    is JSONArray -> List(v.length()) { i ->
      require(!v.isNull(i)) {
        "extraParams: null at $path[$i] — Android has no null value, and dropping it would " +
          "renumber the array. Use a sentinel, or omit the key"
      }
      jsonToAny(v.get(i), "$path[$i]")
    }
    else -> v
  }

  // Native `SyncQueue.Result` -> wire { kind, count?, reason? }. Four cases shared with iOS:
  // Uploaded(count) / Empty / Retry(reason) / AuthExpired. count/reason are the Kotlin properties
  // behind getCount()/getReason().
  fun syncResultMap(result: SyncQueue.Result): WritableMap = Arguments.createMap().apply {
    when (result) {
      is SyncQueue.Result.Uploaded -> {
        putString("kind", "uploaded")
        putInt("count", result.count)
      }
      is SyncQueue.Result.Empty -> putString("kind", "empty")
      is SyncQueue.Result.Retry -> {
        putString("kind", "retry")
        putString("reason", result.reason)
      }
      is SyncQueue.Result.AuthExpired -> putString("kind", "authExpired")
      // Forbidden (HTTP 403) is ANDROID-ONLY — the iOS SDK has no such case — and crosses as its
      // own "forbidden" kind rather than being folded onto "authExpired". The two demand opposite
      // reactions: AuthExpired (401) tears the session down (tracking stopped, queue cleared,
      // config forgotten), while Forbidden keeps tracking running and every row queued and only
      // halts the retry loop. A host told "authExpired" here would re-login and wipe data to fix
      // what is a scope or permission problem on the same, still-valid credential.
      // Retry.retryAfterMs is NOT surfaced: the SDK acts on it itself (TrackerSync.rescheduleAfter),
      // so it is not a decision the host makes.
      is SyncQueue.Result.Forbidden -> putString("kind", "forbidden")
    }
  }

  // Native `SyncEvent` -> wire { type, statusCode?, count? }, or NULL for a native case the JS
  // vocabulary deliberately does not carry. HttpResponse is field-for-field the iOS
  // `.httpResponse` — same wire shape, same meaning. iOS additionally emits uploaded /
  // retryScheduled / authExpired, which have no Android source; nothing is synthesised here to
  // fill the gap.
  //
  // statusCode is `Int?` and is ALWAYS present on the wire, null when no HTTP response arrived at
  // all (dead network, DNS failure, timeout) — a device problem, which a host must be able to tell
  // apart from a 500.
  fun syncEventMap(event: SyncEvent): WritableMap? = when (event) {
    is SyncEvent.HttpResponse -> Arguments.createMap().apply {
      putString("type", "httpResponse")
      val status = event.statusCode
      if (status == null) putNull("statusCode") else putInt("statusCode", status)
      putInt("count", event.count)
    }
    // Added by Android SDK 1.0.6 — the queue drained because the device came back onto a usable
    // network. NOT forwarded: it would be a `SyncEvent` union member iOS can never emit, and the
    // drain it announces already reports its own outcome through httpResponse, so nothing is lost
    // but the notice. The branch exists because the SDK's `SyncEvent` is a sealed interface and
    // this `when` must stay exhaustive — that is the signal we want when a future case lands.
    is SyncEvent.NetworkAvailable -> null
  }

  // ── Session logs (Android SDK 1.0.10) ─────────────────────────────────────────
  // The second channel's vocabulary. ANDROID-ONLY: there is no iOS twin of any of this, so nothing
  // here has a `ios/SyncMappers.swift` counterpart to stay in step with.

  // Wire LogSyncConfig JSON -> native `LogSyncConfig`.
  //
  // `url` is OPTIONAL here, unlike the points config, and that is the whole design: omitting it is
  // what makes the channel FOLLOW the points endpoint (`TrackerSync.configureLogs` resolves it
  // against the SyncConfig in force plus `v1/logs/batch`, and inherits `device_id` and the points
  // headers). So an absent url must reach the builder as the SDK's own empty default, never as a
  // literal written here.
  //
  // `build()`, not a validating construct: resolution AND validation both belong to
  // `configureLogs()`, which resolves first and then reports what is wrong. Validating here would
  // reject the bare-path and no-url cases it would have completed.
  fun logSyncConfigFromWire(json: String): LogSyncConfig {
    val o = JSONObject(json) // throws JSONException on undecodable JSON -> invalidConfig
    val b = LogSyncConfig.builder()

    if (o.has("url") && !o.isNull("url")) b.url(o.getString("url"))
    if (o.has("deviceId") && !o.isNull("deviceId")) b.deviceId(o.getString("deviceId"))
    if (o.has("method") && !o.isNull("method")) b.method(o.getString("method"))
    o.optJSONObject("headers")?.let { h ->
      val keys = h.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        b.header(k, h.getString(k))
      }
    }
    // Same rules as the points channel's extraParams, and the same jsonToAny: a null-valued key is
    // dropped, a null inside an array throws.
    o.optJSONObject("extraParams")?.let { e ->
      val keys = e.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        if (e.isNull(k)) continue
        b.extraParam(k, jsonToAny(e.get(k), k))
      }
    }

    if (o.has("autoSync")) b.autoSync(o.getBoolean("autoSync"))
    if (o.has("level")) {
      logLevel(o.optString("level"))?.let { b.level(it) }
    }
    o.optJSONArray("types")?.let { arr ->
      // An unrecognised member is skipped rather than defaulted, but an array that yields NOTHING
      // is not written at all: an empty set would silence the channel completely, which is never
      // what a typo meant, and `disableLogSync()` is how a host actually says that.
      val types = (0 until arr.length()).mapNotNull { logType(arr.optString(it)) }.toSet()
      if (types.isNotEmpty()) b.types(types)
    }
    if (o.has("bufferCapacity")) b.bufferCapacity(o.getInt("bufferCapacity"))
    if (o.has("retentionHours")) b.retentionHours(o.getInt("retentionHours"))
    if (o.has("batchSize")) b.batchSize(o.getInt("batchSize"))
    if (o.has("requiresUnmeteredNetwork")) {
      b.requiresUnmeteredNetwork(o.getBoolean("requiresUnmeteredNetwork"))
    }
    if (o.has("gzipRequestBody")) b.gzipRequestBody(o.getBoolean("gzipRequestBody"))
    if (o.has("allowCleartext")) b.allowCleartext(o.getBoolean("allowCleartext"))
    o.optJSONObject("timeouts")?.let { t ->
      val d = SyncTimeouts()
      b.timeouts(
        SyncTimeouts(
          if (t.has("connectMs")) t.getLong("connectMs") else d.connectMs,
          if (t.has("readMs")) t.getLong("readMs") else d.readMs,
          if (t.has("writeMs")) t.getLong("writeMs") else d.writeMs,
        )
      )
    }
    if (o.has("uploadIntervalMinutes")) b.uploadIntervalMinutes(o.getLong("uploadIntervalMinutes"))
    // The one key where an explicit JSON `null` is MEANINGFUL rather than droppable: it turns the
    // prompt drain off. Absent keeps the SDK default (WARN); present-and-null disables.
    if (o.has("nudgeLevel")) {
      if (o.isNull("nudgeLevel")) b.nudgeLevel(null)
      else logLevel(o.optString("nudgeLevel"))?.let { b.nudgeLevel(it) }
    }
    if (o.has("nudgeCooldownMs")) b.nudgeCooldownMs(o.getLong("nudgeCooldownMs"))

    return b.build()
  }

  // Native `LogRecord` -> wire. `elapsedRealtimeNanos` crosses as a STRING: it is a monotonic
  // nanosecond stamp and passes 2^53 after roughly 104 days of uptime, which a double cannot hold
  // exactly. The SDK's own upload DTO stringifies it for the same reason. Everything else is
  // small enough to cross as a number.
  //
  // `data` is passed through as the stored STRING, never parsed: the SDK only checks that it is a
  // JSON structure and does not own the shape, so re-encoding it here could only lose fidelity.
  fun logRecordMap(record: LogRecord): WritableMap = Arguments.createMap().apply {
    putString("id", record.id)
    if (record.sessionId == null) putNull("sessionId") else putString("sessionId", record.sessionId)
    putDouble("seq", record.seq.toDouble())
    putDouble("timeMs", record.timeMs.toDouble())
    putString("elapsedRealtimeNanos", record.elapsedRealtimeNanos.toString())
    putString("level", record.level.wireName)
    putString("type", record.type.wireName)
    putString("tag", record.tag)
    if (record.code == null) putNull("code") else putString("code", record.code)
    putString("message", record.message)
    if (record.data == null) putNull("data") else putString("data", record.data)
  }

  // Native `LogSyncQueue.Result` -> wire { kind, count? | reason?, retryAfterMs? | statusCode? }.
  // NOT the points channel's four cases, and deliberately so:
  //  - `Shipped`, not `Uploaded` — a different queue with a different name in the SDK, and keeping
  //    the SDK's word is what stops the two results being read as interchangeable.
  //  - `retryAfterMs` IS surfaced here, unlike on the points channel. There the SDK acts on the
  //    server's Retry-After itself and the host has no decision to make; here `syncLogsNow()` is a
  //    manual drain a host may be looping, so it needs to know how long to wait.
  //  - `Rejected` is TERMINAL for this channel and inert for every other one — the buffer is kept
  //    and no stored point is touched. The status code is carried because the two shapes behind it
  //    need different reactions: 401/403 is a credential, 404/405/501 is an endpoint that is not
  //    there. Recovery for both is a fresh configureLogs().
  fun logSyncResultMap(result: LogSyncQueue.Result): WritableMap = Arguments.createMap().apply {
    when (result) {
      is LogSyncQueue.Result.Shipped -> {
        putString("kind", "shipped")
        putInt("count", result.count)
      }
      is LogSyncQueue.Result.Empty -> putString("kind", "empty")
      is LogSyncQueue.Result.Retry -> {
        putString("kind", "retry")
        putString("reason", result.reason)
        result.retryAfterMs?.let { putDouble("retryAfterMs", it.toDouble()) }
      }
      is LogSyncQueue.Result.Rejected -> {
        putString("kind", "rejected")
        putInt("statusCode", result.statusCode)
      }
    }
  }

  // Wire vocabulary -> the SDK enums. Lowercase both ways: `LogLevel.wireName` / `LogType.wireName`
  // are `name.lowercase()`, so these are its exact inverse. An unrecognised value returns null and
  // the caller leaves the SDK default in place rather than guessing — the same rule as the config
  // enums in TrackerMappersInput.
  fun logLevel(value: String?): LogLevel? =
    LogLevel.entries.firstOrNull { it.wireName == value }

  fun logType(value: String?): LogType? =
    LogType.entries.firstOrNull { it.wireName == value }
}
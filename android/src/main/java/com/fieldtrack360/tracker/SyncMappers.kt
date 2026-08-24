// android/src/main/java/com/fieldtrack360/tracker/SyncMappers.kt
//
// Sync wire vocabulary — the ONLY place the Android `SyncConfig` is built from the wire JSON and
// the `SyncQueue.Result` / `SyncEvent` types are stringified. Kept SEPARATE from TrackerMappers: the
// sync surface lives in a distinct module (com.field360.traker.sync) and a distinct TurboModule.
package com.fieldtrack360.tracker

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

  // Native `SyncEvent` -> wire { type, statusCode?, count? }. The Android SyncEvent has ONE case,
  // HttpResponse, and it is field-for-field the iOS `.httpResponse` — same wire shape, same
  // meaning. iOS additionally emits uploaded / retryScheduled / authExpired, which have no Android
  // source; nothing is synthesised here to fill the gap.
  //
  // statusCode is `Int?` and is ALWAYS present on the wire, null when no HTTP response arrived at
  // all (dead network, DNS failure, timeout) — a device problem, which a host must be able to tell
  // apart from a 500.
  fun syncEventMap(event: SyncEvent): WritableMap = Arguments.createMap().apply {
    when (event) {
      is SyncEvent.HttpResponse -> {
        putString("type", "httpResponse")
        val status = event.statusCode
        if (status == null) putNull("statusCode") else putInt("statusCode", status)
        putInt("count", event.count)
      }
    }
  }
}
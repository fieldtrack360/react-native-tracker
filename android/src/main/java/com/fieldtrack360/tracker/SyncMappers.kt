// android/src/main/java/com/fieldtrack360/tracker/SyncMappers.kt
//
// Sync wire vocabulary — the ONLY place the Android `SyncConfig` is built from the wire JSON and
// the `SyncQueue.Result` / `SyncEvent` types are stringified. Kept SEPARATE from TrackerMappers: the
// sync surface lives in a distinct module (com.field360.traker.sync) and a distinct TurboModule.
package com.fieldtrack360.tracker

import com.field360.traker.sync.SyncConfig
import com.field360.traker.sync.SyncEvent
import com.field360.traker.sync.SyncQueue
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import org.json.JSONObject

object SyncMappers {

  // Wire SyncConfig JSON -> native Android `SyncConfig`. Android reads shared (url/method/headers/
  // autoSync/batchSize) + `android.requiresUnmeteredNetwork` ONLY. The iOS gate
  // (ios.requiresNetworkConnectivity) and the iOS-only fields (wipeOnAuthExpiry / backoff* /
  // autoSyncCoalesceSec) are ignored — the two network gates are NOT unified. Android url
  // is a plain String (no URL parse). Undecodable JSON / a missing url throws → the module rejects
  // invalidConfig. Positional ctor (SyncConfig.txt:12): (url, method, headers, autoSync, batchSize,
  // requiresUnmeteredNetwork).
  //
  // FIRST-BUILD RECONCILIATION: the primary ctor takes all six non-null args, so an omitted optional
  // needs SOME value here. The synthetic SyncConfig(...,int,DefaultConstructorMarker) ctor
  // (SyncConfig.txt:13) shows the data class HAS Kotlin defaults; the fallbacks below (method="POST",
  // autoSync=false, batchSize=100, requiresUnmeteredNetwork=false) must be confirmed against those
  // real SDK defaults at first build — switch to named-arg omission if they diverge.
  fun syncConfigFromWire(json: String): SyncConfig {
    val o = JSONObject(json) // throws JSONException on undecodable JSON -> invalidConfig
    val url = o.optString("url", "")
    require(url.isNotEmpty()) { "sync config is missing a url" }
    val method = if (o.has("method") && !o.isNull("method")) o.getString("method") else "POST"
    val headers = HashMap<String, String>()
    o.optJSONObject("headers")?.let { h ->
      val keys = h.keys()
      while (keys.hasNext()) {
        val k = keys.next()
        headers[k] = h.getString(k)
      }
    }
    val autoSync = o.optBoolean("autoSync", false)
    val batchSize = o.optInt("batchSize", 100)
    val android = o.optJSONObject("android")
    val requiresUnmeteredNetwork = android?.optBoolean("requiresUnmeteredNetwork", false) ?: false
    return SyncConfig(url, method, headers, autoSync, batchSize, requiresUnmeteredNetwork)
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
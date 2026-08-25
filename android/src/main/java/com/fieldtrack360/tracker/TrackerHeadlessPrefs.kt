package com.fieldtrack360.tracker

import android.content.Context

// The two flags that decide whether headless dispatch installs, mirrored to disk.
//
// They have to survive process death. Application.onCreate runs in EVERY process start —
// including the service-only start BootReceiver triggers after a reboot — and it runs BEFORE any
// JS exists to call ready(), so the config the host wrote last session is the only config there
// is at that moment. Everything else in TrackerConfig is the SDK's to persist; these two are ours,
// because `enableHeadless` is not an SDK field at all.
internal object TrackerHeadlessPrefs {

  private const val FILE = "com.fieldtrack360.tracker.headless"
  private const val KEY_ENABLED = "enableHeadless"
  private const val KEY_STOP_ON_TERMINATE = "stopOnTerminate"

  fun store(context: Context, enableHeadless: Boolean, stopOnTerminate: Boolean) {
    prefs(context).edit()
      .putBoolean(KEY_ENABLED, enableHeadless)
      .putBoolean(KEY_STOP_ON_TERMINATE, stopOnTerminate)
      .apply()
  }

  // ONE decision, not two. Headless only makes sense when the host asked for it AND the session is
  // meant to outlive task removal: stopOnTerminate = true stops the foreground service with the
  // task, so no events are produced to dispatch and the collector would hold a process open for
  // nothing.
  fun isEnabled(context: Context): Boolean = prefs(context).let { p ->
    p.getBoolean(KEY_ENABLED, false) && !p.getBoolean(KEY_STOP_ON_TERMINATE, false)
  }

  private fun prefs(context: Context) =
    context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)
}

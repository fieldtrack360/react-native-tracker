package com.fieldtrack360.tracker

import android.content.Context
import com.field360.tracker.Tracker
import com.field360.tracker.TrackerConfig
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

// Android parity for the launch hook. Android has NO launch-window trap — ready() from JS
// works — but the SDK recommends Application.onCreate for filter-state restore timing, so this
// offers TrackerLaunch.ready(context) for MainApplication.onCreate. Optional on Android,
// required on iOS.
object TrackerLaunch {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  // Fire-and-forget ready() with SDK defaults so filter-state restore runs at onCreate timing.
  // A later JS ready(config) re-runs against real config and is safe — registration guards on
  // isRegistered and only updates capture parameters (JS ready lands in Phase 3).
  @JvmStatic
  fun ready(context: Context) {
    val app = context.applicationContext
    scope.launch {
      Tracker.getInstance(app).ready(TrackerConfig())
    }
  }
}

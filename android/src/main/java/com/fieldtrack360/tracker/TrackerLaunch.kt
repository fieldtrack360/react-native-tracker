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
//
// One exception: with android.enableHeadless it is REQUIRED. Application.onCreate is the only
// callback that runs in a process the OS restarted without a UI, so it is the only place the
// headless collector can be attached before the first event is emitted — and tracker.events has
// replay 0, so an event emitted with nothing collecting is gone.
object TrackerLaunch {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

  // Fire-and-forget ready() with SDK defaults so filter-state restore runs at onCreate timing.
  // A later JS ready(config) re-runs against real config and is safe — registration guards on
  // isRegistered and only updates capture parameters (JS ready lands in Phase 3).
  @JvmStatic
  fun ready(context: Context) {
    val app = context.applicationContext
    // Runs against the flags the LAST session persisted — there is no JS yet to hand config down.
    // A later JS ready() calls install() again with the real config.
    TrackerHeadlessDispatcher.install(app)
    scope.launch {
      Tracker.getInstance(app).ready(TrackerConfig())
    }
  }
}

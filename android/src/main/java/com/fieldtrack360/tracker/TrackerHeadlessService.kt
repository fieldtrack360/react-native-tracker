package com.fieldtrack360.tracker

import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.WritableMap
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.field360.tracker.domain.model.TrackerEvent

// The JS end of headless delivery: boots (or reuses) the app's React instance and runs the task
// the host registered with registerHeadlessTask() in index.js.
//
// getTaskConfig() is not used. The events never travel in the Intent — the dispatcher and this
// service live in the SAME process, so the object is handed over directly and onStartCommand
// drains everything queued at that moment. That keeps the Intent payload-free, which in turn makes
// a redelivered start harmless: it finds an empty queue and stops.
class TrackerHeadlessService : HeadlessJsTaskService() {

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    var started = false
    while (true) {
      val event = TrackerHeadlessDispatcher.poll() ?: break
      // allowedInForeground = true guards a race, not a policy. The dispatcher already refuses
      // to queue anything while a resumed host is on screen; this only stops startTask() from
      // throwing if the user reopens the app in the gap between that check and this call.
      startTask(HeadlessJsTaskConfig(TASK_KEY, taskData(event), TASK_TIMEOUT_MS, true))
      started = true
    }
    // Nothing to run and nothing already running: without this the service would sit alive until
    // some other task happened to finish, holding the wake lock startTask would have taken.
    if (!started) stopSelf(startId)
    return START_NOT_STICKY
  }

  // { name, params } — `params` is the SAME wire object onTrackerEvent() delivers, `type` field and
  // all, and `name` is that type lifted out so a handler can switch on it without narrowing first.
  // Deliberately not a second event vocabulary: one mapper, one shape, both paths.
  private fun taskData(event: TrackerEvent): WritableMap {
    val wire = TrackerMappers.eventMap(event)
    return Arguments.createMap().apply {
      putString("name", wire.getString("type"))
      putMap("params", wire)
    }
  }

  companion object {
    // Must match HEADLESS_TASK_KEY in src/headless.ts.
    const val TASK_KEY = "TrackerHeadless"

    // A safeguard against a host handler that never resolves, not a work budget: the task ends —
    // and the wake lock is released — as soon as the registered async function settles.
    private const val TASK_TIMEOUT_MS = 60_000L
  }
}

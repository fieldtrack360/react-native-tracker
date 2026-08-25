package com.fieldtrack360.tracker

import android.content.Context
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.ReactApplication
import com.facebook.react.common.LifecycleState
import com.field360.tracker.Tracker
import com.field360.tracker.domain.model.TrackerEvent
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import java.util.ArrayDeque

// The process-level half of headless delivery.
//
// TrackerEventsHelper's collectors are owned by a JS subscriber: subscribe() starts the Job,
// unsubscribe() cancels it. In a process the OS restarted without a UI there is no JS to start
// one, and `tracker.events` is a SharedFlow with replay 0 — an event emitted with nothing
// collecting is gone for good. So this attaches its OWN collector from Application.onCreate, which
// is the one callback that runs in a service-only process, and turns each event into a short-lived
// headless task.
//
// The task is short-lived on purpose. React Native takes an untimed PARTIAL_WAKE_LOCK in
// startTask() and releases it in the service's onDestroy, and the service stops itself once its
// tasks drain — a single never-resolving task would hold that wake lock for the life of the
// process.
internal object TrackerHeadlessDispatcher {

  // Mirrors the SDK flow's own extraBufferCapacity so a backlog here cannot outlive what the
  // source would have kept anyway. Newest wins, exactly like DROP_OLDEST upstream.
  private const val QUEUE_CAPACITY = 64

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val queue = ArrayDeque<TrackerEvent>(QUEUE_CAPACITY)
  private var collector: Job? = null

  /**
   * Attach the process-level collector, or tear it down if the host has since opted out.
   *
   * Installs only when `android.enableHeadless` is true AND `android.stopOnTerminate` is false —
   * see TrackerHeadlessPrefs.isEnabled. Called from TrackerLaunch.ready(context), which runs on
   * every process start with whatever flags the last session persisted, and again from ready()
   * once JS has handed the real config down.
   */
  @Synchronized
  fun install(context: Context) {
    val app = context.applicationContext
    if (!TrackerHeadlessPrefs.isEnabled(app)) {
      collector?.cancel()
      collector = null
      queue.clear()
      return
    }
    if (collector != null) return
    collector = scope.launch {
      Tracker.getInstance(app).events.collect { event ->
        // The foreground app already has onTrackerEvent() delivering this exact object; a headless
        // task on top of it would double every handler. Dropping is the same choice the foreground
        // path makes for a host that simply never subscribed.
        if (isForeground(app)) return@collect
        enqueue(event)
        pump(app)
      }
    }
  }

  /** Hand the next queued event to the service. Null when the queue is drained. */
  @Synchronized
  fun poll(): TrackerEvent? = queue.pollFirst()

  @Synchronized
  private fun enqueue(event: TrackerEvent) {
    while (queue.size >= QUEUE_CAPACITY) queue.pollFirst()
    queue.addLast(event)
  }

  // ONE startService per event. The service drains whatever is queued when it gets there, so the
  // two do not have to line up — a start that arrives to an empty queue simply stops itself.
  //
  // A start can be refused: with no foreground service running (tracking stopped, only a geofence
  // receiver woke the process) Android's background-start rule rejects it. Nothing here can
  // recover that, so the event stays queued and the next accepted start takes it along. It is lost
  // if the process dies first — the SDK's own storage stays the source of truth.
  private fun pump(app: Context) {
    try {
      HeadlessJsTaskService.acquireWakeLockNow(app)
      app.startService(Intent(app, TrackerHeadlessService::class.java))
    } catch (t: Throwable) {
      // Queued; the next accepted start drains it.
    }
  }

  /**
   * True while a resumed React host is on screen — the exact condition
   * HeadlessJsTaskContext.startTask() checks before refusing a foreground task.
   */
  private fun isForeground(context: Context): Boolean {
    val app = context.applicationContext as? ReactApplication ?: return false
    val reactContext = try {
      app.reactHost?.currentReactContext
    } catch (t: Throwable) {
      null
    } ?: return false
    return reactContext.lifecycleState == LifecycleState.RESUMED
  }
}

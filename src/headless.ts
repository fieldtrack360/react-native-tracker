// src/headless.ts
//
// Android headless delivery. `onTrackerEvent()` needs a live JS subscriber, and there is none in a
// process the OS restarted without a UI — after a reboot (`BootReceiver`) or a low-memory kill, the
// SDK's foreground service comes back alone. This is the path that reaches JS in that state: the
// native dispatcher collects the SAME `tracker.events` stream at process level and starts ONE
// short-lived headless task per event.
//
// It is not a second event vocabulary. `params` IS the wire `TrackerEvent` that `onTrackerEvent()`
// delivers — identical object, identical cases — and `name` is its `type`, lifted out so a handler
// can switch on it without narrowing first.
//
// Android only, and deliberately so: React Native has no headless JS on iOS. There, a terminated
// app is woken by CoreLocation into a normal launch and the usual subscribers apply; the SDK's own
// storage (`getPoints()`, `geofences.getEvents()`) remains the source of truth for anything that
// happened while no JS was running.
import { AppRegistry, Platform } from 'react-native';
import type { TrackerEvent, TrackerEventType } from './types';

// Must match TrackerHeadlessService.TASK_KEY on the native side.
export const HEADLESS_TASK_KEY = 'TrackerHeadless';

export type HeadlessEvent = {
  name: TrackerEventType;
  params: TrackerEvent;
};

/**
 * Register the handler that receives tracker events while the app has no UI process.
 *
 * Call this at the TOP LEVEL of `index.js` — the bundle root is all a headless boot evaluates, so a
 * registration inside a component or a screen module never runs and the task start fails with
 * "No task registered for key TrackerHeadless".
 *
 * Requires `android.enableHeadless: true` AND `android.stopOnTerminate: false` in `ready()`.
 * `stopOnTerminate: true` tears the service down with the task, so there is nothing left to
 * dispatch from and the native dispatcher stays uninstalled.
 *
 * The task ends when the returned promise settles, which is also when the native service releases
 * its wake lock — so await every piece of work inside the handler.
 */
export function registerHeadlessTask(
  task: (event: HeadlessEvent) => Promise<void>
): void {
  if (Platform.OS !== 'android') return;
  AppRegistry.registerHeadlessTask(HEADLESS_TASK_KEY, () => async (data) => {
    await task(data as HeadlessEvent);
  });
}

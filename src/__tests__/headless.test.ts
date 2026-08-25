import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AppRegistry, Platform } from 'react-native';
import { HEADLESS_TASK_KEY, registerHeadlessTask } from '../headless';
import type { HeadlessEvent } from '../headless';

// The headless path exists ONLY on Android — iOS has no headless JS at all, so the call has to be
// a silent no-op there rather than a throw: a host writes ONE index.js for both platforms.
const registerSpy =
  jest.fn<
    (key: string, provider: () => (data: unknown) => Promise<void>) => void
  >();

describe('registerHeadlessTask', () => {
  beforeEach(() => {
    registerSpy.mockClear();
    AppRegistry.registerHeadlessTask = registerSpy;
    Platform.OS = 'android';
  });

  it('registers under the task key the native service starts', () => {
    registerHeadlessTask(async () => {});
    expect(registerSpy).toHaveBeenCalledWith(
      HEADLESS_TASK_KEY,
      expect.any(Function)
    );
  });

  it('is a no-op on iOS', () => {
    Platform.OS = 'ios';
    registerHeadlessTask(async () => {});
    expect(registerSpy).not.toHaveBeenCalled();
  });

  it('awaits the host handler and forwards the event unchanged', async () => {
    const seen: HeadlessEvent[] = [];
    let settled = false;
    registerHeadlessTask(async (event) => {
      seen.push(event);
      await Promise.resolve();
      settled = true;
    });

    const task = registerSpy.mock.calls[0]![1]();
    const event = {
      name: 'geofenceEnter',
      params: { type: 'geofenceEnter', crossing: { geofenceId: 'depot' } },
    };
    await task(event);

    expect(seen).toEqual([event]);
    // The native service stops when this promise resolves, so a handler that is not awaited would
    // have its work killed mid-flight.
    expect(settled).toBe(true);
  });
});

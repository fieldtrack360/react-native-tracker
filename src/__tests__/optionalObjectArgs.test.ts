import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// EVERY OPTIONAL OBJECT ARGUMENT MUST REACH NATIVE AS AN OBJECT.
//
// On iOS an object-typed parameter in the codegen spec becomes a C++ struct REFERENCE
// (`JS::NativeTracker::PointQueryWire &`), and the generated accessors read the struct's backing
// dictionary unconditionally:
//
//     inline std::optional<bool> …SpecGetCurrentLocationOptions::feedIngestor() const
//     { id const p = _v[@"feedIngestor"]; … }
//
// When JS passes `undefined`, React Native binds that reference to nothing and the first accessor
// call dereferences null — EXC_BAD_ACCESS at 0x0 on the TurboModule queue, before any of this
// package's native code runs. It is a hard crash, not a rejected Promise, so nothing above it can
// catch it.
//
// The wrapper therefore substitutes an empty object. An absent key and an absent argument mean the
// same thing to both native mappers — "use the SDK default" — so this changes no behaviour and
// removes the crash.

const mockNative = {
  getPoints: jest.fn(async () => '[]'),
  getCount: jest.fn(async () => 0),
  getCurrentLocation: jest.fn(async () => ({ ok: true, value: {} })),
  buildTrack: jest.fn(async () => '{}'),
  exportPolylineJson: jest.fn(async () => '{}'),
  exportGeoJson: jest.fn(async () => '{}'),
  geofenceGetEvents: jest.fn(async () => []),
  subscribe: jest.fn(async () => 1),
  unsubscribe: jest.fn(async () => {}),
};

jest.mock('../NativeTracker', () => ({
  __esModule: true,
  default: mockNative,
}));
jest.mock('../NativeTrackerSync', () => ({
  __esModule: true,
  default: { subscribeSyncEvents: jest.fn(), unsubscribe: jest.fn() },
}));

// Imported after the mocks are registered, because the module resolves its native handle on load.

const Tracker = require('../index')
  .default as typeof import('../index').default;

describe('optional object arguments', () => {
  beforeEach(() => {
    for (const fn of Object.values(mockNative)) {
      fn.mockClear();
    }
  });

  it('getCurrentLocation() called with no options forwards an object', async () => {
    await Tracker.getCurrentLocation();
    expect(mockNative.getCurrentLocation).toHaveBeenCalledWith(
      expect.any(Object)
    );
  });

  it('getPoints() called with no query forwards an object', async () => {
    await Tracker.getPoints();
    expect(mockNative.getPoints).toHaveBeenCalledWith(expect.any(Object));
  });

  it('getCount() called with no query forwards an object', async () => {
    await Tracker.getCount();
    expect(mockNative.getCount).toHaveBeenCalledWith(expect.any(Object));
  });

  it('buildTrack() called with no query or options forwards two objects', async () => {
    await Tracker.buildTrack();
    expect(mockNative.buildTrack).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('exportPolylineJson() called with no arguments forwards two objects', async () => {
    await Tracker.exportPolylineJson();
    expect(mockNative.exportPolylineJson).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('exportGeoJson() called with no arguments forwards two objects', async () => {
    await Tracker.exportGeoJson();
    expect(mockNative.exportGeoJson).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('geofences.getEvents() called with no query forwards an object', async () => {
    await Tracker.geofences.getEvents();
    expect(mockNative.geofenceGetEvents).toHaveBeenCalledWith(
      expect.any(Object)
    );
  });

  it('a supplied argument is forwarded unchanged', async () => {
    await Tracker.getPoints({ sessionId: 'abc', limit: 10 });
    expect(mockNative.getPoints).toHaveBeenCalledWith({
      sessionId: 'abc',
      limit: 10,
    });
  });
});

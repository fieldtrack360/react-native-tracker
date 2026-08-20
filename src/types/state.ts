// State, provider, sensors.
import type {
  AccuracyAuthorization,
  MotionQuality,
  MotionState,
  PermissionTier,
  PowerSource,
} from './enums';

export type TrackerState = {
  isReady: boolean;
  isTracking: boolean;
  motionState: MotionState;
  providerState: ProviderState;
  /** null/absent when no session is open. */
  currentSessionId?: string;
};

// Union. Shared fields flat; the platform-only halves are absent — not `false` — on the
// other platform.
export type ProviderState = {
  permissionTier: PermissionTier;
  accuracyAuthorization: AccuracyAuthorization;
  powerSave: boolean;
  ios?: {
    locationServicesEnabled: boolean;
    significantLocationChangeAvailable: boolean;
    regionMonitoringAvailable: boolean;
  };
  android?: {
    gpsEnabled: boolean;
    networkEnabled: boolean;
    fusedAvailable: boolean;
  };
};

// Union. The half for the other platform is absent, not `false` — "no pedometer" and
// "we cannot tell" are different facts.
/** Both platforms. On Android this is the same reading the SDK stamps on every stored point, so
 *  a host display and the uploaded rows cannot disagree; iOS `TrackPoint` carries no battery, so
 *  there is nothing there to agree with.
 *
 *  `percent` and `isCharging` are nullable on purpose: null is "not known", never 0 % / not
 *  charging. Do not coalesce them to a falsy default — a `?? 0` here renders an unknown battery
 *  as a flat one; a simulator and a device with battery monitoring off both report null. `isLow`
 *  is the SDK's own derivation (percent != null && percent <= 15), carried across rather than
 *  recomputed so the threshold stays owned by one side. */
export type BatteryInfo = {
  percent: number | null;
  isCharging: boolean | null;
  powerSource: PowerSource;
  isLow: boolean;
};

export type DeviceSensors = {
  motionQuality: MotionQuality;
  ios?: {
    activityRecognition: boolean;
    stepCounting: boolean;
    significantLocationChange: boolean;
    regionMonitoring: boolean;
  };
  android?: {
    accelerometer: boolean;
    gyroscope: boolean;
    magnetometer: boolean;
    significantMotion: boolean;
    stepDetector: boolean;
    stepCounter: boolean;
    barometer: boolean;
    rotationVector: boolean;
  };
};

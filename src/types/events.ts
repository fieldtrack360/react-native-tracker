// The event union. One subscription carries a 21-case discriminated union; typed so
// an exhaustive `switch` is checkable. Seven cases never fire on one platform — documented so no
// host builds a liveness assumption on a signal that will not arrive.
import type { ActivityType, MotionState } from './enums';
import type { ErrorCode } from './errors';
import type { FixDecision, TrackPoint } from './location';
import type {
  BatteryInfo,
  IntegrityReport,
  LicenseInfo,
  ProviderState,
} from './state';
import type { TrackSession } from './location';
import type { GeofenceCrossing } from './geofence';

export type TrackerEvent =
  | { type: 'location'; point: TrackPoint }
  | { type: 'locationRejected'; decision: FixDecision }
  | { type: 'motionChange'; state: MotionState; point: TrackPoint | null }
  | { type: 'activityChange'; activity: ActivityType; confidence: number }
  | { type: 'enabledChange'; enabled: boolean }
  | { type: 'providerChange'; state: ProviderState }
  | { type: 'heartbeat'; atMs: number }
  | { type: 'powerSaveChange'; enabled: boolean }
  | { type: 'sessionInterrupted'; session: TrackSession }
  | { type: 'diagnostic'; message: string }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'geofenceEnter'; crossing: GeofenceCrossing }
  | { type: 'geofenceExit'; crossing: GeofenceCrossing }
  | { type: 'geofenceDwell'; crossing: GeofenceCrossing } // iOS only
  | { type: 'geofenceAdded'; geofenceId: string } // Android only
  | { type: 'geofenceRemoved'; geofenceId: string } // Android only
  | { type: 'batteryChange'; battery: BatteryInfo }
  | { type: 'licenseDeactivated'; status: string; reason: string | null } // iOS only
  // Android only. The device-integrity flag set CHANGED — this is a transition, not a per-check
  // heartbeat, so no event does not mean no findings. A `block`-policy finding also arrives as
  // `error` with `deviceIntegrityBlocked` and ends an in-flight session. Release builds only:
  // the whole layer is waived on a debuggable install, where `report.waived` is true.
  | { type: 'integrityChange'; report: IntegrityReport }
  // Android only (v1.0.1-alpha-08+). The online licence check returned a verdict it could
  // verify — shortly after each ready(), then every 12 h. NOT emitted when the network failed or
  // the response could not be verified, so its absence carries no information. This is the
  // Android analogue of the iOS-only `licenseDeactivated`, but it is not the same signal: this
  // one fires on every successful check including `active`, while iOS only speaks up to
  // deactivate. Do not write one handler that assumes both.
  | { type: 'licenseChecked'; info: LicenseInfo }
  // iOS only. The app was force-quit (or otherwise silent) and capture resumed elsewhere: iOS
  // never relaunches a killed app for location events, so the span between the two ends was
  // never observed. Fires ONCE, on the first stored point after the silence, and only when the
  // quiet lasted >= 10 min AND resumed >= 250 m away. The matching `TrackSegment` has
  // `type: 'gap'` and contributes nothing to `TrackStats.totalDistanceMeters`;
  // `TrackPoint.odometerM` still credits the straight-line leg.
  | { type: 'trackingGap'; durationSec: number; distanceMeters: number }; // iOS only

export type TrackerEventType = TrackerEvent['type'];

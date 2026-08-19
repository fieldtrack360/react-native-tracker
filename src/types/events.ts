// The event union. One subscription carries a 17-case discriminated union; typed so
// an exhaustive `switch` is checkable. Three cases never fire on one platform — documented so no
// host builds a liveness assumption on a signal that will not arrive.
import type { ActivityType, MotionState } from './enums';
import type { ErrorCode } from './errors';
import type { FixDecision, TrackPoint } from './location';
import type { BatteryInfo, ProviderState } from './state';
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
  | { type: 'batteryChange'; battery: BatteryInfo }; // Android only

export type TrackerEventType = TrackerEvent['type'];

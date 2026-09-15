// Permission answers. The permission strings and the Android Intent never
// cross to JS — they are inputs to the native request flow and a host has no use for them.
import type {
  AccuracyAuthorization,
  MotionAuthorization,
  PermissionTier,
} from './enums';

// A union, not a shared enum. Platform-only members are present and documented. The URL/Intent
// behind `needsSettings` stays native; `openAppSettings()` acts on it.
export type BackgroundRequest =
  | { kind: 'alreadyGranted' }
  | { kind: 'granted' } // iOS only
  | { kind: 'denied' } // iOS only
  | { kind: 'notApplicable' } // Android only
  | { kind: 'needsForegroundFirst' } // iOS 'needsWhenInUseFirst' maps here
  | { kind: 'prompt' } // Android only; the permission array stays native
  | { kind: 'needsSettings' };

// Android only. What the OS and the OEM currently allow the app to do in the background — the
// usual reason a session that started fine stops an hour later. Three reads that need no
// permission, plus the SDK's own verdict on them.
export type BackgroundRestrictions = {
  /** Holds the battery-optimisation exemption. `false` is the normal, healthy state of almost
   *  every app and is not a fault on its own — `degraded` deliberately ignores it. */
  ignoringBatteryOptimizations: boolean;
  /** The user (or OEM) set the app to "Restricted" in its battery settings. */
  backgroundRestricted: boolean;
  /** App standby bucket: 10 active, 20 working set, 30 frequent, 40 rare, 45 restricted.
   *  `null` below API 28, where buckets do not exist. */
  standbyBucket: number | null;
  /** The SDK's verdict: background-restricted, or in the rare/restricted bucket. The state worth
   *  surfacing to the user, and the point to offer the exemption. */
  degraded: boolean;
};

export type { PermissionTier, AccuracyAuthorization, MotionAuthorization };

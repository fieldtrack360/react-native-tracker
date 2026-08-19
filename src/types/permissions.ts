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

export type { PermissionTier, AccuracyAuthorization, MotionAuthorization };

import { TurboModuleRegistry, type TurboModule } from 'react-native';

// Codegen TurboModule spec for the SEPARATE "TrackerSync" module ( layout) — distinct from
// the main "Tracker" module (src/NativeTracker.ts). Codegen turns this into a second Swift/ObjC
// protocol (NativeTrackerSyncSpec) and a second Kotlin abstract class (NativeTrackerSyncSpec); a
// method declared here and unimplemented natively is a build error on both platforms (D1).
//
// Codegen constraints honoured: the SyncConfig crosses as a JSON string (config is mostly
// divergent, each native mapper builds its own native SyncConfig); TrackerResult crosses as a
// concrete { ok, value?, code?, message? } object; the four-case syncNow result crosses as a
// flat inline object { kind, count?, reason? } (no discriminated union in a codegen signature).

// syncNow() — the same four-case result on BOTH platforms: uploaded(count) / empty /
// retry(reason) / authExpired. kind is the discriminator; count is present only for "uploaded",
// reason only for "retry".
export type SyncResultWire = {
  kind: string;
  count?: number;
  reason?: string;
};

export interface Spec extends TurboModule {
  // configure(configJson): the whole SyncConfig (shared + ios.* + android.*) crosses as a JSON
  // string; each native mapper reads only its platform's fields. Undecodable JSON — or, on
  // iOS, an unparseable url (SyncConfig.url is Foundation.URL) — REJECTS invalidConfig (a bridge
  // fault, mirroring ready()); there is nothing to resolve. The pending-upload store and health-loop
  // sync trigger are wired INSIDE the iOS native impl and stay unexposed.
  configure(configJson: string): Promise<void>;

  // requestSync(): enqueue the sync worker / fire the health-loop trigger. Forwards only — call it
  // after accepted points or at an app checkpoint even when autoSync is true (Android does not
  // auto-enqueue on accepted-point events).
  requestSync(): Promise<void>;

  // syncNow(): run one sync pass now → the four-case result.
  syncNow(): Promise<SyncResultWire>;

  // pendingCount() → TrackerResult<number> on the wire. The Android mapper WRAPS its bare
  // Int in { ok:true, value }; iOS maps its native TrackerResult<Int> directly.
  pendingCount(): Promise<{
    ok: boolean;
    value?: number;
    code?: string;
    message?: string;
  }>;

  // ── ios.onSyncEvent — iOS ONLY ───────────────────────────────────────────────
  // NativeEventEmitter contract (addListener/removeListeners are bookkeeping no-ops). Native emits
  // ONE device event "TrackerSyncEmit" with { id, payload }; src/sync.ts routes by id. Reuses the
  // Phase 4 pattern on a DISTINCT device event name. subscribeSyncEvents() starts ONE native Task and
  // resolves its id; on Android it REJECTS unsupportedOnPlatform (no sync event stream). The
  // subscribe/unsubscribe methods are declared on BOTH platforms because codegen (D1) requires it.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  subscribeSyncEvents(): Promise<number>;
  unsubscribe(id: number): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrackerSync');

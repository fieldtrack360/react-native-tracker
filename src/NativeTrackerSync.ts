import { TurboModuleRegistry, type TurboModule } from 'react-native';

// Codegen TurboModule spec for the SEPARATE "TrackerSync" module ( layout) — distinct from
// the main "Tracker" module (src/NativeTracker.ts). Codegen turns this into a second Swift/ObjC
// protocol (NativeTrackerSyncSpec) and a second Kotlin abstract class (NativeTrackerSyncSpec); a
// method declared here and unimplemented natively is a build error on both platforms (D1).
//
// Codegen constraints honoured: the SyncConfig crosses as a JSON string (config is mostly
// divergent, each native mapper builds its own native SyncConfig); TrackerResult crosses as a
// concrete { ok, value?, code?, message? } object; the syncNow result crosses as a flat inline
// object { kind, count?, reason? } (no discriminated union in a codegen signature).

// syncNow() — uploaded(count) / empty / retry(reason) / authExpired on BOTH platforms, plus the
// ANDROID-ONLY forbidden (HTTP 403). kind is the discriminator; count is present only for
// "uploaded", reason only for "retry".
export type SyncResultWire = {
  kind: string;
  count?: number;
  reason?: string;
};

export interface Spec extends TurboModule {
  // configure(configJson): the whole SyncConfig (shared + ios.* + android.*) crosses as a JSON
  // string; each native mapper reads only its platform's fields. Undecodable JSON — or, on
  // iOS, an unparseable url (SyncConfig.url is Foundation.URL); on Android, anything
  // SyncConfig.validate() reports (cleartext url, an unsupported verb, an out-of-range batchSize)
  // — REJECTS invalidConfig (a bridge fault, mirroring ready()); there is nothing to resolve. The
  // pending-upload store and health-loop sync trigger are wired INSIDE the iOS native impl and stay
  // unexposed.
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

  // ── onSyncEvent — BOTH platforms ─────────────────────────────────────────────
  // NativeEventEmitter contract (addListener/removeListeners are bookkeeping no-ops). Native emits
  // ONE device event "TrackerSyncEmit" with { id, payload }; src/sync.ts routes by id. Reuses the
  // Phase 4 pattern on a DISTINCT device event name. subscribeSyncEvents() starts ONE native
  // Task (iOS, over SyncEngine.events()) or Job (Android, collecting TrackerSync.events) and
  // resolves its id; unsubscribe(id) cancels that one.
  //
  // The EVENT VOCABULARY still diverges: only "httpResponse" is emitted on Android, while iOS also
  // sends uploaded / retryScheduled / authExpired. And the Android sink has replay = 1, so a
  // subscriber can be handed the last exchange of an earlier drain on attach; iOS replays nothing.
  addListener(eventName: string): void;
  removeListeners(count: number): void;
  subscribeSyncEvents(): Promise<number>;
  unsubscribe(id: number): Promise<void>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrackerSync');

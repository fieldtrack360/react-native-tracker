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

// androidSyncLogsNow() — shipped(count) / empty / retry(reason, retryAfterMs?) / rejected(statusCode).
// A DIFFERENT four-case set from SyncResultWire above: this channel keeps its buffer on a refusal
// and drops a permanently-rejected batch, which is the inverse of the points channel on both
// counts. Flat inline for the same codegen reason (no discriminated union in a signature).
export type LogSyncResultWire = {
  kind: string;
  count?: number;
  reason?: string;
  retryAfterMs?: number;
  statusCode?: number;
};

// One stored log entry. `elapsedRealtimeNanos` crosses as a STRING — it is a monotonic nanosecond
// stamp and can exceed what a double holds exactly; every other numeric here is small. `data` is
// the raw JSON string as stored, never a parsed object (codegen has no `any`, and the SDK only
// checks that it IS a JSON structure — it does not own the shape).
export type LogRecordWire = {
  id: string;
  sessionId: string | null;
  seq: number;
  timeMs: number;
  elapsedRealtimeNanos: string;
  level: string;
  type: string;
  tag: string;
  code: string | null;
  message: string;
  data: string | null;
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

  // ── Session logs — ANDROID ONLY (Android SDK 1.0.10); iOS REJECTS unsupportedOnPlatform ──────
  // A second channel with its own endpoint, its own database and its own worker. The iOS SDK has
  // no counterpart at all — not a stub, not an empty implementation — so these are `android*`
  // prefixed and the iOS module answers every one of them by rejecting, the same shape as the
  // main module's androidIntegrity()/androidLicenseInfo() family.
  //
  // The LogSyncConfig crosses as a JSON string for the same reason SyncConfig does: it is config,
  // it is nested, and an ABSENT key is not the same as a zero — omitting `url` is what makes the
  // channel follow the points endpoint, and omitting `nudgeLevel` is not the same as sending null.
  // Anything LogSyncConfig.validate() reports REJECTS invalidConfig, mirroring configure().
  androidConfigureLogs(configJson: string): Promise<void>;

  // Stops the channel and cancels its worker. The buffer is NOT wiped — a later
  // androidConfigureLogs() resumes shipping what is still in it.
  androidDisableLogSync(): Promise<void>;

  // log(level, tag, message, code?, data?) — one host entry, recorded as type `message`. `data`
  // must be a JSON structure (object or array) as a STRING; anything else is dropped by the SDK
  // rather than stored as a bare scalar. Recorded synchronously and forwarded only, so this
  // resolves without waiting on the database.
  //
  // FLAT parameters rather than an options object, here and on androidGetLogs: an object-typed
  // codegen param generates a JS::NativeTrackerSync::* C++ struct that this module's .mm would
  // then have to import and unpack for a method whose whole iOS body is a rejection. src/sync.ts
  // keeps the object shape on the public API and spreads it here.
  androidLog(
    level: string,
    tag: string,
    message: string,
    code?: string,
    data?: string
  ): Promise<void>;

  // logLifecycle(phase, tag) — the phase vocabulary is the SDK's own (session_start, service_stop,
  // …); a free string is accepted. `tag` defaults to "Host" when absent.
  androidLogLifecycle(phase: string, tag?: string): Promise<void>;

  // getLogs(sessionId?, limit?, offset?) → the stored entries, newest-first. Defaults limit 200 /
  // offset 0; an absent sessionId reads across sessions.
  androidGetLogs(
    sessionId?: string,
    limit?: number,
    offset?: number
  ): Promise<LogRecordWire[]>;

  // pendingLogCount() → TrackerResult<number>, wrapped native-side exactly as pendingCount() is.
  androidPendingLogCount(): Promise<{
    ok: boolean;
    value?: number;
    code?: string;
    message?: string;
  }>;

  // syncLogsNow(): drain the log buffer now → the four-case LogSyncResultWire.
  androidSyncLogsNow(): Promise<LogSyncResultWire>;

  // requestLogSync(): enqueue the log worker. A no-op when the channel was never configured or has
  // been terminally rejected — it does NOT throw for either.
  androidRequestLogSync(): Promise<void>;

  // Where diagnostics are going. `endpoint` is null until androidConfigureLogs() has been called,
  // and `configured` is exactly `endpoint != null` — both are returned so a caller reads the state
  // it wants without a second round trip.
  androidLogStatus(): Promise<{ configured: boolean; endpoint?: string }>;

  // The log channel's own event stream (`TrackerSync.logEvents`) — a SEPARATE SharedFlow from the
  // points stream, carrying this channel's httpResponse exchanges. Rides the SAME device event
  // "TrackerSyncEmit" and the SAME id space, so `unsubscribe(id)` above cancels either kind.
  androidSubscribeLogEvents(): Promise<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('TrackerSync');

import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TrackerSync } from '@fieldtrack360/react-native-tracker';
import { font, spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  CollapseChevron,
  DiagnosticCard,
  ExplanationBox,
  FactRow,
  LabelledField,
  Note,
  Pill,
  Screen,
  ToggleRow,
} from '../ui';
import { useTracking } from '../state/tracking';
import { createMMKV } from 'react-native-mmkv';

// The upload instrument — the port of SampleApp/Modules/Sync/SyncView.swift and its view model.
//
// Reached from Home rather than given a sixth tab: a sixth tab collapses into "More", and burying
// the permission ladder or the decision log behind that would cost more than this screen gains from
// being one tap closer.
//
// The order answers the questions a host has while wiring an endpoint: where am I sending, how much
// is waiting, and what did the server actually say.
//
// DIVERGENCE: the iOS sample reads `isConfigured` and the live endpoint back off the engine, so the
// screen can say what is IN FORCE rather than what is TYPED — the two differ the moment a host edits
// the field without pressing Configure, and a 401 tears the configuration down with nothing the host
// did to cause it. The bridge exposes configure/requestSync/syncNow/pendingCount and no readback, so
// what this screen shows is the last configuration IT applied. An authExpired event is therefore
// treated as the teardown it is, and the badge is cleared on it.

const FEED_LIMIT = 60;
const storage = createMMKV();
const ENDPOINT_KEY = 'sync.endpoint';

// Back is the root header's chevron, not this screen's own control — the header already swaps its
// logo for one while this is up, and a second Home button inside the first card was two ways out.
export function SyncScreen() {
  const theme = useTheme();
  const tracking = useTracking();

  /// The run the uploads are tagged with. `resolvedSessionId` is the pin when Home has one and the
  /// live session otherwise — and pressing Start releases the pin, so a run in progress always
  /// reads as itself here.
  const liveSessionId = tracking.resolvedSessionId;

  /// Left empty on purpose. A default endpoint would be a request this app makes to somebody else's
  /// server on first launch — a restored value was typed here by the tester. Restoring it does NOT
  /// configure: the uploader is only ever wired by the host pressing Configure.
  const [endpoint, setEndpoint] = useState(
    () => storage.getString(ENDPOINT_KEY) ?? ''
  );

  /// Written on every keystroke rather than on Configure, because the field being wiped by a trip
  /// to Home is exactly the case this exists for, and that trip does not go through Configure.
  const updateEndpoint = useCallback((value: string) => {
    setEndpoint(value);
    storage.set(ENDPOINT_KEY, value);
  }, []);

  /// Sent as `Authorization` when non-empty. A 401 from a stale one is worth demonstrating — it is
  /// the only sync outcome that tears the uploader down.
  const [bearerToken, setBearerToken] = useState('');
  const [autoSync, setAutoSync] = useState(true);

  /// In the provider, not here: this screen unmounts every time the tester leaves the tab, Home
  /// reads the same flag to say whether sync is wired, and a restart re-applies the configuration
  /// before this screen is ever opened.
  const configuredEndpoint = tracking.configuredSyncEndpoint;
  const clearConfiguration = tracking.clearSyncConfiguration;
  const [pending, setPending] = useState<number | undefined>(undefined);
  const [lastResult, setLastResult] = useState<string | undefined>(undefined);
  const [feed, setFeed] = useState<string[]>([]);

  /// Collapsed by default, like every other diagnostic on Home — a host only opens these once the
  /// summary above (Status, Pending) says something needs a closer look.
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const [isFeedExpanded, setIsFeedExpanded] = useState(false);

  const record = useCallback((kind: string, detail: string) => {
    const stamp = new Date().toLocaleTimeString();
    setFeed((previous) =>
      [`${stamp}  ${kind}  ${detail}`, ...previous].slice(0, FEED_LIMIT)
    );
  }, []);

  const refreshPending = useCallback(async () => {
    try {
      const result = await TrackerSync.pendingCount();
      if (result.ok) {
        setPending(result.value);
      } else {
        setPending(undefined);
        setLastResult(`${result.code}: ${result.message}`);
      }
    } catch (error) {
      setPending(undefined);
      setLastResult(String(error));
    }
  }, []);

  useEffect(() => {
    void refreshPending();
  }, [refreshPending]);

  useEffect(() => {
    // The stream runs on BOTH platforms, but only `httpResponse` is emitted on Android — the SDK's
    // SyncEvent has that one case there. The other three arms below are iOS-only and simply never
    // fire on Android, which is why there is no Platform.OS branch: the switch already says it.
    //
    // Android also replays the last exchange to a new subscriber (its sink is replay = 1), so the
    // first line in the feed after opening this screen may be a drain that finished while it was
    // closed. That is the SDK's own choice and it is what a diagnostics screen wants.
    const unsubscribe = TrackerSync.onSyncEvent((event) => {
      switch (event.type) {
        // The case this screen exists for. A 500, a 422 and a timeout produce the same retry, and
        // only the status tells a host which of the three it is looking at.
        case 'httpResponse':
          record(
            'HTTP',
            `${event.statusCode ?? 'no response'} for ${event.count} point${event.count === 1 ? '' : 's'}`
          );
          break;
        // iOS only from here down.
        case 'uploaded':
          record('UPLOADED', String(event.count));
          void refreshPending();
          break;
        case 'retryScheduled':
          record(
            'RETRY',
            `in ${Math.round(event.afterSec)}s — ${event.reason}`
          );
          break;
        case 'authExpired':
          // Terminal, and the only event a host must act on: refresh belongs to the auth stack.
          record('AUTH', '401 — configuration torn down');
          clearConfiguration();
          break;
        default:
          record('EVENT', 'unrecognised');
      }
    });
    return unsubscribe;
  }, [clearConfiguration, record, refreshPending]);

  /// The applying itself is the provider's — it also owns the session re-push and the restore on
  /// launch, both of which have to happen with this screen closed. This is only the button.
  const configure = async () => {
    const error = await tracking.configureSync({
      url: endpoint,
      bearerToken: bearerToken !== '' ? bearerToken : undefined,
      autoSync,
    });
    if (error) {
      setLastResult(`not configured: ${error}`);
      return;
    }
    setLastResult(`configured for ${endpoint}`);
    record(
      'CONFIG',
      `${endpoint}${liveSessionId ? ` session ${liveSessionId.slice(0, 8)}` : ''}`
    );
    await refreshPending();
  };

  /// Drains now and reports what happened. `syncNow()` awaits the outcome, unlike `requestSync()`,
  /// which is why this button can say what the server did rather than only that it was asked.
  const syncNow = async () => {
    try {
      const result = await TrackerSync.syncNow();
      switch (result.kind) {
        case 'uploaded':
          setLastResult(`uploaded ${result.count}`);
          break;
        case 'empty':
          setLastResult('nothing queued');
          break;
        case 'retry':
          setLastResult(`retry — ${result.reason}`);
          break;
        case 'authExpired':
          setLastResult('401 — uploader torn down');
          clearConfiguration();
          break;
        // Android only, and deliberately NOT the same as authExpired: the rows are all still
        // queued and tracking is still running — only the retry loop has stopped. Configure again
        // with a credential allowed to write this endpoint and the same queue drains.
        case 'forbidden':
          setLastResult(
            '403 — uploads halted, queue kept; re-configure to resume'
          );
          clearConfiguration();
          break;
        default:
          setLastResult('unrecognised result');
      }
      tracking.note('SYNC', `syncNow -> ${result.kind}`);
    } catch (error) {
      setLastResult(String(error));
    }
    await refreshPending();
  };

  /// Fire-and-forget, coalesced by the engine. The other half of the manual trigger, shown so a host
  /// can see there are two and why they differ.
  const requestSync = async () => {
    try {
      await TrackerSync.requestSync();
      setLastResult('sync requested');
      tracking.note('SYNC', 'requestSync');
    } catch (error) {
      setLastResult(String(error));
    }
  };

  return (
    <Screen>
      {/* MARK: - Endpoint */}
      <DiagnosticCard title="Server Endpoint Configuration" glyph="🔗">
        <LabelledField
          name="URL"
          value={endpoint}
          onChange={updateEndpoint}
          placeholder="https://your.server/track"
          keyboardType="url"
          autoCapitalize="none"
          labelStyle={styles.fieldLabel}
          inputStyle={styles.fieldInput}
        />
        <LabelledField
          name="Bearer token (optional)"
          value={bearerToken}
          onChange={setBearerToken}
          placeholder="token"
          autoCapitalize="none"
          secureTextEntry
          labelStyle={styles.fieldLabel}
          inputStyle={styles.fieldInput}
        />
        <ToggleRow
          label="Auto-sync on every accepted point"
          isOn={autoSync}
          onToggle={() => setAutoSync((value) => !value)}
          labelStyle={styles.toggleLabel}
        />

        <ActionButton
          title="Configure"
          glyph="✓"
          prominent
          disabled={endpoint === ''}
          onPress={() => void configure()}
        />

        <FactRow
          name="Status"
          value={configuredEndpoint ? 'CONFIGURED' : 'NOT CONFIGURED'}
          tint={configuredEndpoint ? theme.status.good : theme.idle}
          stackedFont
          spaceBetween
        />
        {/* Where it is ACTUALLY sending, which is not necessarily what is typed above: the two
            diverge the moment the field is edited without pressing Configure. */}
        {configuredEndpoint ? (
          <FactRow name="Sending to" value={configuredEndpoint} />
        ) : null}
        {/* What extraParams.session_id currently carries. Re-pushed automatically on a session
            change, so this and the uploads never disagree once Configure has been pressed. */}
        <FactRow
          name="session_id"
          value={liveSessionId ?? 'no session yet'}
          tint={liveSessionId ? theme.status.good : theme.idle}
          stackedFont
          spaceBetween
        />

        <Note style={styles.sectionNote}>
          The uploader is given the SDK's own queue rather than reaching for it,
          which is what keeps the core free of any knowledge that an uploader
          exists. Points are queued whether or not this is configured, so
          nothing is lost by wiring it later.
        </Note>
        <Note style={styles.sectionNote}>
          This badge is what THIS screen configured, not a readback: the bridge
          exposes no isConfigured. An authExpired event clears it, because that
          is the one teardown the host does not cause.
        </Note>
      </DiagnosticCard>

      {/* MARK: - Queue
          Collapsed by default like every other diagnostic — Pending stays visible in the header so
          a host can tell at a glance whether anything needs syncing, without opening the card. */}
      <DiagnosticCard
        title="Queue"
        glyph="📥"
        onHeaderPress={() => setIsQueueExpanded((expanded) => !expanded)}
        right={<CollapseChevron expanded={isQueueExpanded} theme={theme} />}
      >
        {isQueueExpanded ? (
          <>
            <FactRow
              name="Pending"
              value={pending ?? '—'}
              tint={pending && pending > 0 ? theme.status.good : theme.idle}
              stackedFont
              spaceBetween
            />

            <ActionRow>
              <ActionButton
                title="Sync now"
                glyph="⬆"
                onPress={() => void syncNow()}
              />
              {/* Both triggers, deliberately: they differ in whether the caller learns the outcome,
                  and a host choosing between them should see that difference. */}
              <ActionButton
                title="Request"
                glyph="✈"
                onPress={() => void requestSync()}
              />
              <ActionButton
                title="Pending"
                glyph="↻"
                onPress={() => void refreshPending()}
              />
            </ActionRow>

            {lastResult ? (
              <ExplanationBox text={lastResult} tint={theme.idle} />
            ) : null}

            <Note style={styles.sectionNote}>
              syncNow() awaits the outcome and reports it; requestSync() returns
              immediately and coalesces repeated calls. Rows are only marked
              uploaded on a confirmed success, so a dropped response costs a
              duplicate rather than a point.
            </Note>
            <Note style={styles.sectionNote}>
              Call requestSync() after accepted points even with autoSync on —
              Android does not auto-enqueue the worker on accepted-point events.
            </Note>
          </>
        ) : null}
      </DiagnosticCard>

      {/* MARK: - Feed */}
      <DiagnosticCard
        title="Feed"
        glyph="📈"
        onHeaderPress={() => setIsFeedExpanded((expanded) => !expanded)}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            {feed.length > 0 ? (
              <Pill text={String(feed.length)} tint={theme.idle} />
            ) : null}
            <CollapseChevron expanded={isFeedExpanded} theme={theme} />
          </View>
        }
      >
        {isFeedExpanded ? (
          <>
            <Note style={styles.sectionNote}>
              One HTTP line per exchange, before the outcome — a queue larger
              than the batch size reports every round trip. "no response" means
              the request never reached a server: offline, DNS, TLS. iOS only:
              Android has no sync event stream, so this card stays empty there
              and that is the SDK working as designed.
            </Note>

            {feed.length === 0 ? (
              <Note style={styles.sectionNote}>Nothing yet.</Note>
            ) : (
              <View style={{ gap: 6 }}>
                {feed.map((line, index) => {
                  // `${stamp}  ${kind}  ${detail}`, split back apart so the timestamp reads dim
                  // and the event kind reads as the thing a scanning eye should land on first.
                  const [stamp, kind, ...rest] = line.split('  ');
                  return (
                    <Text key={`${index}-${line}`} style={styles.feedLine}>
                      <Text
                        style={[
                          styles.feedStamp,
                          { color: theme.secondaryLabel },
                        ]}
                      >
                        {stamp}
                      </Text>
                      <Text style={[styles.feedKind, { color: theme.accent }]}>
                        {'  '}
                        {kind}
                      </Text>
                      <Text style={{ color: theme.label }}>
                        {'  '}
                        {rest.join('  ')}
                      </Text>
                    </Text>
                  );
                })}
              </View>
            )}
          </>
        ) : null}
      </DiagnosticCard>

      <View style={{ height: spacing.section }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  // Slightly roomier than the shared Note default — these two cards carry the densest prose on
  // the screen, and the tighter default line-height read cramped next to the monospaced feed.
  sectionNote: {
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.1,
  },
  feedLine: {
    fontFamily: font.mono,
    fontSize: 12,
    lineHeight: 18,
  },
  feedStamp: {
    fontSize: 11,
  },
  feedKind: {
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  // Uppercase + tracked, matching the treatment FactRow's stackedFont uses elsewhere — a field
  // label reads as a category heading, not a sentence.
  fieldLabel: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  fieldInput: {
    fontSize: 14,
    fontWeight: '500',
  },
  toggleLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});

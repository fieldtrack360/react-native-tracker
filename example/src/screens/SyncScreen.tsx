import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import {
  TrackerSync,
  type SyncConfig,
} from '@fieldtrack360/react-native-tracker';
import { font, spacing, useTheme } from '../theme';
import {
  ActionButton,
  ActionRow,
  DiagnosticCard,
  ExplanationBox,
  FactRow,
  LabelledField,
  Note,
  Screen,
  ToggleRow,
} from '../ui';
import { useTracking } from '../state/tracking';

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

export function SyncScreen({ onBack }: { onBack: () => void }) {
  const theme = useTheme();
  const tracking = useTracking();

  /// Left empty on purpose. A default endpoint would be a request this app makes to somebody else's
  /// server on first launch.
  const [endpoint, setEndpoint] = useState('');

  /// Sent as `Authorization` when non-empty. A 401 from a stale one is worth demonstrating — it is
  /// the only sync outcome that tears the uploader down.
  const [bearerToken, setBearerToken] = useState('');
  const [autoSync, setAutoSync] = useState(true);

  const [configuredEndpoint, setConfiguredEndpoint] = useState<
    string | undefined
  >(undefined);
  const [pending, setPending] = useState<number | undefined>(undefined);
  const [lastResult, setLastResult] = useState<string | undefined>(undefined);
  const [feed, setFeed] = useState<string[]>([]);

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
    // ios.onSyncEvent is iOS-only; on Android the subscription rejects `unsupportedOnPlatform` and
    // this unsubscribe is a safe no-op. No Platform.OS branch — the namespace is always present.
    const unsubscribe = TrackerSync.ios.onSyncEvent((event) => {
      switch (event.type) {
        // The case this screen exists for. A 500, a 422 and a timeout produce the same retry, and
        // only the status tells a host which of the three it is looking at.
        case 'httpResponse':
          record(
            'HTTP',
            `${event.statusCode ?? 'no response'} for ${event.count} point${event.count === 1 ? '' : 's'}`
          );
          break;
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
          setConfiguredEndpoint(undefined);
          break;
        default:
          record('EVENT', 'unrecognised');
      }
    });
    return unsubscribe;
  }, [record, refreshPending]);

  const configure = async () => {
    const config: SyncConfig = {
      url: endpoint,
      method: 'POST',
      autoSync,
      batchSize: 100,
      ...(bearerToken !== ''
        ? { headers: { Authorization: `Bearer ${bearerToken}` } }
        : {}),
      // The two network gates are NOT unified: "any connectivity" and "unmetered only" are
      // different policies, so each sits in its own platform namespace and neither is collapsed.
      ios: { requiresNetworkConnectivity: true },
      android: { requiresUnmeteredNetwork: false },
    };
    try {
      await TrackerSync.configure(config);
      setConfiguredEndpoint(endpoint);
      setLastResult(`configured for ${endpoint}`);
      record('CONFIG', endpoint);
      tracking.note(
        'SYNC',
        `configured endpoint=${endpoint} autoSync=${autoSync}`
      );
      await refreshPending();
    } catch (error) {
      // A bridge fault, not a domain failure: an unparseable URL rejects rather than resolving
      // ok:false.
      setLastResult(`not configured: ${String(error)}`);
    }
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
          setConfiguredEndpoint(undefined);
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
      <ActionRow>
        <ActionButton title="← Home" onPress={onBack} />
      </ActionRow>

      {/* MARK: - Endpoint */}
      <DiagnosticCard title="Endpoint" glyph="🔗">
        <LabelledField
          name="URL"
          value={endpoint}
          onChange={setEndpoint}
          placeholder="https://your.server/track"
          keyboardType="url"
          autoCapitalize="none"
        />
        <LabelledField
          name="Bearer token (optional)"
          value={bearerToken}
          onChange={setBearerToken}
          placeholder="token"
          autoCapitalize="none"
        />
        <ToggleRow
          label="Auto-sync on every accepted point"
          isOn={autoSync}
          onToggle={() => setAutoSync((value) => !value)}
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
        />
        {/* Where it is ACTUALLY sending, which is not necessarily what is typed above: the two
            diverge the moment the field is edited without pressing Configure. */}
        {configuredEndpoint ? (
          <FactRow name="Sending to" value={configuredEndpoint} />
        ) : null}

        <Note>
          The uploader is given the SDK's own queue rather than reaching for it,
          which is what keeps the core free of any knowledge that an uploader
          exists. Points are queued whether or not this is configured, so
          nothing is lost by wiring it later.
        </Note>
        <Note>
          This badge is what THIS screen configured, not a readback: the bridge
          exposes no isConfigured. An authExpired event clears it, because that
          is the one teardown the host does not cause.
        </Note>
      </DiagnosticCard>

      {/* MARK: - Queue */}
      <DiagnosticCard title="Queue" glyph="📥">
        <FactRow name="Pending" value={pending ?? '—'} />

        <ActionRow>
          <ActionButton
            title="Sync now"
            glyph="⬆"
            onPress={() => void syncNow()}
          />
          {/* Both triggers, deliberately: they differ in whether the caller learns the outcome, and
              a host choosing between them should see that difference. */}
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

        <Note>
          syncNow() awaits the outcome and reports it; requestSync() returns
          immediately and coalesces repeated calls. Rows are only marked
          uploaded on a confirmed success, so a dropped response costs a
          duplicate rather than a point.
        </Note>
        <Note>
          Call requestSync() after accepted points even with autoSync on —
          Android does not auto-enqueue the worker on accepted-point events.
        </Note>
      </DiagnosticCard>

      {/* MARK: - Feed */}
      <DiagnosticCard title="Feed" glyph="📈">
        <Note>
          One HTTP line per exchange, before the outcome — a queue larger than
          the batch size reports every round trip. "no response" means the
          request never reached a server: offline, DNS, TLS. iOS only: Android
          has no sync event stream, so this card stays empty there and that is
          the SDK working as designed.
        </Note>

        {feed.length === 0 ? (
          <Note>Nothing yet.</Note>
        ) : (
          <View>
            {feed.map((line, index) => (
              <Text
                key={`${index}-${line}`}
                style={{
                  color: theme.label,
                  fontFamily: font.mono,
                  fontSize: 11,
                  lineHeight: 16,
                }}
              >
                {line}
              </Text>
            ))}
          </View>
        )}
      </DiagnosticCard>

      <View style={{ height: spacing.section }} />
    </Screen>
  );
}

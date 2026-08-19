import { useState } from 'react';
import { Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
// react-native-safe-area-context, not RN's own SafeAreaView.
//
// RN's SafeAreaView is iOS-ONLY: on Android it renders as a plain View and applies no insets at
// all. With edge-to-edge on (the default from Android 15 / targetSdk 35), the app draws behind the
// status bar and the navigation bar, so the header sits under the clock and the tab bar sits under
// the gesture pill — which is exactly what the device showed. This library reports real insets on
// both platforms.
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { spacing, useTheme } from './theme';
import { TrackingProvider } from './state/tracking';
import { HomeScreen } from './screens/HomeScreen';
import { TrackScreen } from './screens/TrackScreen';
import { FencesScreen } from './screens/FencesScreen';
import { DebugScreen } from './screens/DebugScreen';
import { DecisionsScreen } from './screens/DecisionsScreen';
import { SyncScreen } from './screens/SyncScreen';

// The five tabs, in diagnostic order — the port of SampleApp/App/RootView.swift.
//
// Home is where a run is started and where the permission ladder lives. Track, Debug and Decisions
// are instruments and they all read the same session selection, so all three always describe the
// same run.
//
// Fences is the exception, and deliberately so: geofences are independent of tracking in the SDK, so
// the screen reads no session and owns its own state. A tester can arm a fence with no run ever
// having been started, which is exactly the case a host will ship.
//
// Sync is pushed from Home rather than given a sixth tab, for the reason the iOS sample gives: a
// sixth tab collapses into "More", and hiding the permission ladder or the decision log behind that
// would cost more than upload gains from being one tap closer.
//
// ZERO per-platform branching in this app — the unified API is unified.

const TABS = [
  { id: 'home', title: 'Home', glyph: '🏠' },
  { id: 'track', title: 'Track', glyph: '🗺' },
  { id: 'fences', title: 'Fences', glyph: '📍' },
  { id: 'debug', title: 'Debug', glyph: '🔶' },
  { id: 'decisions', title: 'Decisions', glyph: '📓' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function App() {
  return (
    // One provider for the whole app, owned here. It owns the event subscription, the resolved
    // session and the capture log — a second instance would open a second subscription and double
    // every line in the log.
    // SafeAreaProvider wraps everything so any screen — and the modals in ui.tsx — can read insets.
    <SafeAreaProvider>
      <TrackingProvider>
        <RootView />
      </TrackingProvider>
    </SafeAreaProvider>
  );
}

function RootView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<TabId>('home');
  const [showSync, setShowSync] = useState(false);
  const [showPermissionLadder, setShowPermissionLadder] = useState(false);

  const title = showSync
    ? 'Upload'
    : (TABS.find((entry) => entry.id === tab)?.title ?? '');

  return (
    <View style={[styles.root, { backgroundColor: theme.screen }]}>
      {/* barStyle only: RN 0.87 dropped backgroundColor and translucent, because under edge-to-edge
          the app is always drawn behind a transparent status bar and the insets are the contract. */}
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />

      <View
        style={[
          styles.header,
          {
            borderBottomColor: theme.separator,
            backgroundColor: theme.bar,
            // The bar extends INTO the status bar area and pads its content down, rather than
            // starting below it: a strip of screen-coloured background above a floating header is
            // the thing edge-to-edge is supposed to avoid.
            paddingTop: insets.top + 10,
          },
        ]}
      >
        <Text style={[styles.headerTitle, { color: theme.label }]}>
          Tracker · {title}
        </Text>
        {tab === 'home' && !showSync ? (
          <>
            <Pressable
              style={styles.headerButton}
              onPress={() => setShowSync(true)}
            >
              <Text style={styles.headerButtonGlyph}>☁️</Text>
            </Pressable>
            <Pressable
              style={styles.headerButton}
              onPress={() => setShowPermissionLadder(true)}
            >
              <Text style={styles.headerButtonGlyph}>🔐</Text>
            </Pressable>
          </>
        ) : null}
      </View>

      <View style={styles.body}>
        {showSync ? (
          <SyncScreen onBack={() => setShowSync(false)} />
        ) : tab === 'home' ? (
          <HomeScreen
            isPermissionLadderVisible={showPermissionLadder}
            onOpenPermissionLadder={() => setShowPermissionLadder(true)}
            onClosePermissionLadder={() => setShowPermissionLadder(false)}
          />
        ) : tab === 'track' ? (
          <TrackScreen />
        ) : tab === 'fences' ? (
          <FencesScreen />
        ) : tab === 'debug' ? (
          <DebugScreen />
        ) : (
          <DecisionsScreen />
        )}
      </View>

      {!showSync ? (
        <View
          style={[
            styles.tabBar,
            {
              borderTopColor: theme.separator,
              backgroundColor: theme.bar,
              // The gesture pill / navigation bar lives here. Without the inset the last row of
              // labels is under it and the tabs are half-untappable.
              paddingBottom: insets.bottom + 8,
            },
          ]}
        >
          {TABS.map((entry) => (
            <Pressable
              key={entry.id}
              style={styles.tab}
              onPress={() => setTab(entry.id)}
            >
              <Text style={styles.tabGlyph}>{entry.glyph}</Text>
              <Text
                style={[
                  styles.tabTitle,
                  {
                    color:
                      tab === entry.id ? theme.accent : theme.secondaryLabel,
                  },
                ]}
              >
                {entry.title}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  headerButton: { paddingLeft: spacing.row, paddingVertical: 2 },
  headerButtonGlyph: { fontSize: 20 },
  body: { flex: 1 },
  tabBar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, paddingTop: 8, alignItems: 'center', gap: 2 },
  tabGlyph: { fontSize: 18 },
  tabTitle: { fontSize: 11, fontWeight: '600' },
});

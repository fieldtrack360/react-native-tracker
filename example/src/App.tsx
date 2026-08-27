// Global Imports
import { useState } from 'react';
import {
  Image,
  LayoutAnimation,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

// Local Imports
import { spacing, useTheme } from './theme';
import { ScreenBackdrop } from './ui';
import { TrackingProvider } from './state/tracking';

// Screen Imports
import { HomeScreen } from './screens/HomeScreen';
import { SyncScreen } from './screens/SyncScreen';
import { TrackScreen } from './screens/TrackScreen';
import { DebugScreen } from './screens/DebugScreen';
import { FencesScreen } from './screens/FencesScreen';
import { DecisionsScreen } from './screens/DecisionsScreen';

// Asset Imports
import logo from './assets/logo.png';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TABS = [
  { id: 'home', title: 'Home' },
  { id: 'track', title: 'Track' },
  { id: 'fences', title: 'Fences' },
  { id: 'debug', title: 'Debug' },
  { id: 'decisions', title: 'Decisions' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/// The tab icons.
///
/// Stroked paths on a 24-unit grid, one stroke width and one box for all five, colour passed in —
/// which is what makes the row follow the scheme instead of fighting it. The two attempts before
/// this one are worth recording: emoji ignore `color` entirely, and font glyphs like ⌂ next to ☰
/// are different stroke weights and different optical sizes that no font size reconciles.
const ICON_BOX = 24;
const STROKE = 1.75;

function TabIcon({ id, colour }: { id: TabId; colour: string }) {
  const stroke = {
    stroke: colour,
    strokeWidth: STROKE,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
  };
  return (
    <Svg width={ICON_BOX} height={ICON_BOX} viewBox="0 0 24 24">
      {id === 'home' ? (
        <>
          <Path
            d="M3 9.6 12 3l9 6.6V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"
            {...stroke}
          />
          <Path d="M9.5 21v-6h5v6" {...stroke} />
        </>
      ) : null}
      {/* A route with a start and an end, rather than an arrow: tracking is the line between two
          points, not a heading. */}
      {id === 'track' ? (
        <>
          <Circle cx="6" cy="19" r="2.6" {...stroke} />
          <Circle cx="18" cy="5" r="2.6" {...stroke} />
          <Path
            d="M8.6 19h8.4a3.5 3.5 0 0 0 0-7H7a3.5 3.5 0 0 1 0-7h8.4"
            {...stroke}
          />
        </>
      ) : null}
      {/* Concentric rings around a point — a monitored region, which is what a geofence is. */}
      {id === 'fences' ? (
        <>
          <Circle cx="12" cy="12" r="8.6" {...stroke} />
          <Circle cx="12" cy="12" r="4.2" {...stroke} />
          <Circle cx="12" cy="12" r="1.1" fill={colour} />
        </>
      ) : null}
      {id === 'debug' ? (
        <>
          <Path
            d="M12 20.5c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"
            {...stroke}
          />
          <Path d="M9 7.1v-1a3 3 0 0 1 6 0v1" {...stroke} />
          <Path d="M12 20.5V11" {...stroke} />
          <Path
            d="M6.2 12H2.8M6.5 8.6A3.6 3.6 0 0 1 3 5M6.6 15.4A3.6 3.6 0 0 0 3 19"
            {...stroke}
          />
          <Path
            d="M17.8 12h3.4M17.5 8.6A3.6 3.6 0 0 0 21 5M17.4 15.4A3.6 3.6 0 0 1 21 19"
            {...stroke}
          />
        </>
      ) : null}
      {/* A log: three entries, each with its bullet. */}
      {id === 'decisions' ? (
        <>
          <Path d="M8.5 6.5H21M8.5 12H21M8.5 17.5H21" {...stroke} />
          <Path d="M3.6 6.5h.01M3.6 12h.01M3.6 17.5h.01" {...stroke} />
        </>
      ) : null}
    </Svg>
  );
}

export default function App() {
  return (
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

  return (
    <View style={[styles.root, { backgroundColor: theme.screen }]}>
      <ScreenBackdrop />
      {/* Glyph colour only. RN 0.87 dropped `backgroundColor` and `translucent`: under edge-to-edge
          the bars are always transparent, and their colour is the theme's business (styles.xml). */}
      <StatusBar barStyle={theme.isDark ? 'light-content' : 'dark-content'} />
      <View
        style={[
          styles.header,
          {
            backgroundColor: theme.bar,
            shadowColor: theme.shadow,
            paddingTop: insets.top + 10,
          },
        ]}
      >
        {showSync ? (
          <Pressable
            style={styles.headerButtonLeft}
            hitSlop={12}
            onPress={() => setShowSync(false)}
          >
            <View
              style={[styles.headerBackChevron, { borderColor: theme.accent }]}
            />
          </Pressable>
        ) : (
          <Image source={logo} style={styles.headerLogo} resizeMode="contain" />
        )}
        <Text style={[styles.headerTitle, { color: theme.label }]}>
          {showSync ? 'Server Sync' : 'Tracker-RN'}
        </Text>
      </View>
      <View style={styles.body}>
        {showSync ? (
          <SyncScreen />
        ) : tab === 'home' ? (
          <HomeScreen
            isPermissionLadderVisible={showPermissionLadder}
            onOpenPermissionLadder={() => setShowPermissionLadder(true)}
            onClosePermissionLadder={() => setShowPermissionLadder(false)}
            onOpenSync={() => setShowSync(true)}
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
            styles.tabBarWrap,
            { paddingBottom: Platform.OS == 'ios' ? 20 : insets.bottom + 10 },
          ]}
        >
          <View
            style={[
              styles.tabBar,
              {
                backgroundColor: theme.bar,
                borderColor: theme.cardBorder,
                shadowColor: theme.shadow,
              },
            ]}
          >
            {TABS.map((entry) => {
              const isActive = tab === entry.id;
              return (
                <Pressable
                  key={entry.id}
                  style={styles.tab}
                  onPress={() => {
                    LayoutAnimation.configureNext(
                      LayoutAnimation.Presets.easeInEaseOut
                    );
                    setTab(entry.id);
                  }}
                >
                  <View
                    style={[
                      styles.tabGlyphWrap,
                      isActive && [
                        styles.tabGlyphWrapActive,
                        {
                          backgroundColor: theme.status.good,
                          shadowColor: theme.status.good,
                        },
                      ],
                    ]}
                  >
                    <TabIcon
                      id={entry.id}
                      colour={isActive ? theme.onSolid : theme.secondaryLabel}
                    />
                    {isActive ? (
                      <Text
                        style={[
                          styles.tabTitle,
                          styles.tabTitleInBubble,
                          { color: theme.onSolid },
                        ]}
                      >
                        {entry.title}
                      </Text>
                    ) : null}
                  </View>
                  {!isActive ? (
                    <Text
                      style={[
                        styles.tabTitle,
                        styles.tabTitleInactive,
                        { color: theme.secondaryLabel },
                      ]}
                    >
                      {entry.title}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  // No bottom hairline: the header sits above a tinted screen, and a line there reads as a seam.
  // A soft downward shadow separates the two surfaces without drawing an edge.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.screen,
    paddingBottom: 12,
    zIndex: 2,
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  headerLogo: {
    width: 28,
    height: 28,
    borderRadius: 6,
    marginRight: spacing.row,
  },
  headerButtonLeft: {
    marginRight: spacing.row,
    marginLeft: -6,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBackChevron: {
    width: 12,
    height: 12,
    borderLeftWidth: 2.5,
    borderBottomWidth: 2.5,
    transform: [{ rotate: '45deg' }],
    marginLeft: 4,
  },
  body: { flex: 1 },
  // `spacing.screen`, the same inset every Screen pads its cards by, so the bar's edges line up
  // with the column of cards above it rather than sitting a few points inside them.
  tabBarWrap: { paddingHorizontal: spacing.screen, paddingTop: 8 },
  tabBar: {
    flexDirection: 'row',
    borderRadius: 40,
    borderWidth: StyleSheet.hairlineWidth,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 8,
    paddingVertical: 4,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  tabGlyphWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabGlyphWrapActive: {
    width: 70,
    height: 56,
    borderRadius: 28,
    gap: 2,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 4,
  },
  tabTitle: {
    fontSize: 10,
    fontWeight: '600',
  },
  tabTitleInactive: {
    fontSize: 10,
    marginTop: -4,
  },
  tabTitleInBubble: {
    fontSize: 10,
  },
});

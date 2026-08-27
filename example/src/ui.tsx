import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
// Insets rather than RN's SafeAreaView: that component is iOS-only, so on Android this sheet's
// toolbar would sit under the status bar and its content under the gesture pill.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  elevation,
  font,
  radius,
  spacing,
  useTheme,
  type Palette,
} from './theme';

// The shared parts every tab uses — the port of SampleApp/Shared/Theme/Components.swift and
// SampleApp/Shared/SessionPicker.swift.
//
// Shared for the reason the iOS sample shares them: five tabs each drawing their own grouped box is
// five sets of padding that drift apart, and a diagnostic screen where the Debug tab's counts sit a
// few points off the Decisions tab's counts is a screen people stop trusting.

// MARK: - Screen

export function Screen({ children }: { children: ReactNode }) {
  return (
    // Transparent, not `theme.screen`: the backdrop is painted once at the root so it runs the full
    // height of the window — under the floating tab bar and under Android's transparent navigation
    // bar. A screen painting its own opaque ground would cut that off at the tab bar's top edge.
    <View style={{ flex: 1, backgroundColor: 'transparent' }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          padding: spacing.screen,
          gap: spacing.section,
          paddingBottom: spacing.screen,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {children}
      </ScrollView>
    </View>
  );
}

// MARK: - ScreenBackdrop

/// The two soft colour washes behind every screen: cool at the top of the window, warm at the
/// bottom, meeting in an untinted band across the middle.
///
/// React Native has no gradient without a native dependency, and this sample deliberately ships
/// none — so each wash is a stack of equal-height bands whose alpha eases to zero. Bands rather
/// than the obvious two big soft-tinted circles: a circle has an EDGE, and on a sparse screen with
/// no cards over it that edge reads as a hard arc cutting across the page. A band stack has no
/// silhouette to see, only a fade down the window.
const BAND_COUNT = 28;

export function ScreenBackdrop() {
  const theme = useTheme();
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {Array.from({ length: BAND_COUNT }, (_, index) => {
        // The band's centre, 0 at the top of the window and 1 at the bottom.
        const at = (index + 0.5) / BAND_COUNT;
        return (
          <View key={index} style={styles.band}>
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: `rgba(${theme.glowTop.rgb}, ${
                    theme.glowTop.alpha * fade(1 - at / 0.55)
                  })`,
                },
              ]}
            />
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: `rgba(${theme.glowBottom.rgb}, ${
                    theme.glowBottom.alpha * fade((at - 0.45) / 0.55)
                  })`,
                },
              ]}
            />
          </View>
        );
      })}
    </View>
  );
}

/// Clamps to 0…1 and eases, so a wash thins out towards its far end instead of ramping linearly —
/// a linear ramp still reads as a straight-edged wedge where it runs out.
function fade(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped;
}

// MARK: - DiagnosticCard

/// The one card every tab uses. `systemImage` is carried as an emoji glyph — React Native has no SF
/// Symbols, and the icon is what a tester scans for when they are told "the Queue card".
export function DiagnosticCard({
  title,
  glyph,
  right,
  onHeaderPress,
  pulseColor,
  children,
}: {
  title: string;
  glyph: string;
  /** Rendered on the same line as the title, right-aligned — for cards whose header controls
   *  belong next to the name rather than on a row of their own below it. */
  right?: ReactNode;
  /** Makes the whole header row (title and `right`) a single tap target — for a collapsible
   *  card, where the touch target should not be limited to a small chevron. */
  onHeaderPress?: () => void;
  /** Set (e.g. to theme.status.good) to ring the card in a solid border of that colour with a soft
   *  glow that breathes around the whole outline — the "this is live" signal for a card whose
   *  state changes off-screen, like Status while a run is recording. Unset draws the card's
   *  normal flat edge. */
  pulseColor?: string;
  children: ReactNode;
}) {
  const theme = useTheme();
  const HeaderContainer = onHeaderPress ? Pressable : View;
  /// A soft glow breathing around the whole outline rather than a segment tracing it — no per-edge
  /// geometry means no seams or corner artifacts to get wrong, at any card size.
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!pulseColor) {
      glow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(glow, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseColor, glow]);

  const glowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 0.9],
  });
  // Native shadows barely render on Android regardless of animation, so the border's own colour
  // breathing between a dim and a full tint is what actually reads as "live" on both platforms —
  // the shadow underneath is a bonus on iOS, not the primary signal.
  const borderColor = pulseColor
    ? glow.interpolate({
        inputRange: [0, 1],
        outputRange: [withAlpha(pulseColor, 0.35), pulseColor],
      })
    : theme.cardBorder;

  return (
    <Animated.View
      style={[
        styles.card,
        elevation(theme),
        {
          backgroundColor: theme.card,
          borderRadius: radius.card,
          borderWidth: pulseColor ? 2 : StyleSheet.hairlineWidth,
          borderColor,
        },
        pulseColor
          ? {
              shadowColor: pulseColor,
              shadowOpacity: glowOpacity,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 0 },
              elevation: 6,
            }
          : null,
      ]}
    >
      <HeaderContainer
        style={
          onHeaderPress
            ? ({ pressed }: { pressed: boolean }) => [
                styles.cardHeader,
                pressed ? { opacity: 0.6 } : null,
              ]
            : styles.cardHeader
        }
        {...(onHeaderPress ? { onPress: onHeaderPress } : {})}
      >
        <View
          style={[
            styles.cardGlyphBadge,
            { backgroundColor: withAlpha(theme.accent, theme.tintFill) },
          ]}
        >
          <Text style={styles.cardGlyph}>{glyph}</Text>
        </View>
        <Text style={[styles.cardTitle, { color: theme.label, flex: 1 }]}>
          {title}
        </Text>
        {right}
      </HeaderContainer>
      {children}
    </Animated.View>
  );
}

// MARK: - FactRow

/// One name/value pair from a status card.
///
/// The value is monospaced and trailing-aligned so a column of them can be read down rather than
/// across, and `tint` carries health — a tier of `none` and a tier of `always` must not be the same
/// colour on a screen whose job is to answer "why is nothing being recorded".
export function FactRow({
  name,
  value,
  tint,
  stacked,
  stackedFont,
  spaceBetween,
}: {
  name: string;
  value: string | number;
  tint?: string;
  /// Title above value instead of side-by-side — for a narrow box that sits next to others in a row. */
  stacked?: boolean;
  /// Stacked's uppercase-name/bold-value type sizing without the column layout — for a row that
  /// must stay single-line but should read like the stacked facts next to it.
  stackedFont?: boolean;
  /// Pushes name and value to opposite edges of the row instead of hugging them together — for a
  /// row that spans the full card width on its own, like Session.
  spaceBetween?: boolean;
}) {
  const theme = useTheme();
  const useStackedFont = stacked || stackedFont;
  return (
    <View
      style={[
        stacked ? styles.factRowStacked : styles.factRow,
        spaceBetween && { justifyContent: 'space-between' },
      ]}
    >
      <Text
        style={[
          styles.factName,
          useStackedFont && styles.factNameStacked,
          spaceBetween && styles.factNameSpaceBetween,
          { color: theme.secondaryLabel },
        ]}
        numberOfLines={1}
        adjustsFontSizeToFit={stacked}
        minimumFontScale={0.7}
      >
        {useStackedFont ? name.toUpperCase() : name}
      </Text>
      <Text
        selectable
        style={[
          styles.factValue,
          stacked
            ? styles.factValueStacked
            : stackedFont && styles.factValueStackedFont,
          { color: tint ?? theme.label },
        ]}
        numberOfLines={2}
      >
        {String(value)}
      </Text>
    </View>
  );
}

// MARK: - CollapseChevron

/// Rotates to point up when the card it sits in is expanded — visually centred whichever way it
/// points. Shared by every collapsible DiagnosticCard so the treatment stays identical tab to tab.
export function CollapseChevron({
  expanded,
  theme,
}: {
  expanded: boolean;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View
      style={{
        width: 26,
        height: 26,
        borderRadius: 13,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: withAlpha(theme.accent, theme.tintFill),
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRightWidth: 2,
          borderBottomWidth: 2,
          borderColor: theme.accent,
          marginTop: expanded ? 2 : -2,
          transform: [{ rotate: expanded ? '-135deg' : '45deg' }],
        }}
      />
    </View>
  );
}

// MARK: - Pill

/// A small tinted label — a count, a verdict, a state.
export function Pill({ text, tint }: { text: string; tint?: string }) {
  const theme = useTheme();
  const colour = tint ?? theme.idle;
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: withAlpha(colour, theme.tintFill) },
      ]}
    >
      <Text style={[styles.pillText, { color: colour }]}>{text}</Text>
    </View>
  );
}

// MARK: - ExplanationBox

/// A block of prose attached to a control that cannot do anything useful yet.
///
/// A link on its own tells a user where to go and nothing about what to do when they arrive, and
/// the Always rung is exactly the case where the user has one chance to get it right.
export function ExplanationBox({
  text,
  tint,
}: {
  text: string;
  tint?: string;
}) {
  const theme = useTheme();
  const colour = tint ?? theme.status.warn;
  return (
    <View
      style={[
        styles.explanation,
        { backgroundColor: withAlpha(colour, theme.tintSoft) },
      ]}
    >
      <Text style={[styles.caption, { color: theme.secondaryLabel }]}>
        {text}
      </Text>
    </View>
  );
}

// MARK: - Prose

/// The caption paragraphs that carry this sample's teaching. Every card in the iOS sample ends in
/// one, and they are the reason the screens are worth reading rather than only pressing.
export function Note({
  children,
  style,
}: {
  children: ReactNode;
  /** Overrides on top of the shared caption style — for a card whose prose needs its own rhythm
   *  without changing every other Note in the app. */
  style?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Text style={[styles.caption, { color: theme.secondaryLabel }, style]}>
      {children}
    </Text>
  );
}

export function Divider() {
  const theme = useTheme();
  return (
    <View
      style={{
        height: StyleSheet.hairlineWidth,
        backgroundColor: theme.separator,
      }}
    />
  );
}

// MARK: - ActionRow

/// A row of buttons that becomes a column when the labels no longer fit beside each other. The iOS
/// original switches on Dynamic Type; here the switch is the window width, which is the same
/// question asked the way React Native can answer it.
export function ActionRow({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <View
      style={[
        styles.actionRow,
        { flexDirection: width < 360 ? 'column' : 'row' },
      ]}
    >
      {children}
    </View>
  );
}

export function ActionButton({
  title,
  glyph,
  onPress,
  prominent = false,
  destructive = false,
  disabled = false,
  compact = false,
  busy = false,
  tone,
  subtitle,
}: {
  title: string;
  glyph?: string;
  onPress: () => void;
  prominent?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Sized to its label instead of filling the row — for a button that stands alone under centred
   *  text, where a full-width bar reads as the card's primary action rather than as a retry. */
  compact?: boolean;
  /** Work is in flight: the glyph is replaced by a spinner and the press is swallowed. A separate
   *  prop from `disabled` because the two read differently — disabled is "you cannot", busy is
   *  "wait" — and a control that only dims while it works looks broken rather than working. */
  busy?: boolean;
  /** Overrides the tint the variant would pick. For a button that reports an outcome in its own
   *  colour — a green flash on success — without a third boolean variant. */
  tone?: string;
  /** A quieter second line under the title. Where the button's own label can carry what it is
   *  about to do, so the card does not need a separate line of prose to say it. */
  subtitle?: string;
}) {
  const theme = useTheme();
  const tint = tone ?? (destructive ? theme.status.bad : theme.accent);
  const isBlocked = disabled || busy;

  /// Presses scale the button rather than only fading it. On a diagnostic screen where the same
  /// press can take a second to resolve (a location fix), the squeeze is the only immediate
  /// acknowledgement the tester gets that the tap landed at all.
  const scale = useRef(new Animated.Value(1)).current;
  const springTo = (value: number) => {
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();
  };

  return (
    <Animated.View
      style={[
        { transform: [{ scale }] },
        compact ? { flex: 0, alignSelf: 'center' } : { flex: 1 },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={() => springTo(0.97)}
        onPressOut={() => springTo(1)}
        disabled={isBlocked}
        accessibilityRole="button"
        accessibilityState={{ disabled: isBlocked, busy }}
        accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
        style={({ pressed }) => [
          styles.button,
          compact ? styles.buttonCompact : null,
          {
            backgroundColor: prominent ? tint : withAlpha(tint, theme.tintFill),
            // The sheen is clipped by the button's own corners.
            overflow: 'hidden',
            // Hairline edge on the quiet variant, matching every other tinted surface in the app;
            // none on the prominent one, whose own colour is the edge.
            borderWidth: prominent ? 0 : StyleSheet.hairlineWidth,
            borderColor: withAlpha(tint, theme.tintEdge),
            // Busy keeps its full strength: the spinner is the state, and dimming it as well reads
            // as a button that refused the press.
            opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
          },
          // Tinted with the button's own colour, the way Home's Start control is lifted — a neutral
          // black shadow under a saturated button reads as grime, not as height.
          prominent && !disabled
            ? {
                shadowColor: tint,
                shadowOpacity: 0.3,
                shadowRadius: 10,
                shadowOffset: { width: 0, height: 4 },
                elevation: 3,
              }
            : null,
        ]}
      >
        {prominent ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {Array.from({ length: SHEEN_BANDS }, (_, band) => (
              <View
                key={band}
                style={{
                  flex: 1,
                  backgroundColor: `rgba(255, 255, 255, ${
                    SHEEN_PEAK * (1 - band / (SHEEN_BANDS - 1))
                  })`,
                }}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.buttonLabel}>
          {busy ? (
            <ActivityIndicator
              size="small"
              color={prominent ? theme.onSolid : tint}
            />
          ) : null}
          <Text
            numberOfLines={1}
            style={[
              styles.buttonText,
              { color: prominent ? theme.onSolid : tint },
            ]}
          >
            {!busy && glyph ? `${glyph} ` : ''}
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text
            numberOfLines={1}
            style={[
              styles.buttonSubtitle,
              {
                color: prominent
                  ? withAlpha(theme.onSolid, 0.78)
                  : withAlpha(tint, 0.8),
              },
            ]}
          >
            {subtitle}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

/// The bands a prominent button's fill is faked from. No gradient library in this sample, and one
/// dependency for one button is a bad trade: eight slices of decreasing white over the tint read as
/// a vertical gradient at any size a button is, and cost nothing.
const SHEEN_BANDS = 8;
const SHEEN_PEAK = 0.16;

// MARK: - Chip

/// A toggle that greys out rather than disappearing. A control that vanishes reads as a missing
/// feature; one that greys out reads as a missing input.
///
/// Both states are FILLED — tinted when on, neutral when off — rather than an outline that gains a
/// colour. Home's vocabulary is tinted surfaces and hairline edges, and an outlined ghost pill next
/// to it reads as a control from a different app.
export function Chip({
  title,
  tint,
  isOn,
  isEnabled = true,
  onPress,
  compact = false,
}: {
  title: string;
  tint?: string;
  isOn: boolean;
  isEnabled?: boolean;
  onPress: () => void;
  /** Tighter sides, for a row of five that has to stay on one line — a segmented row that wraps
   *  stops reading as one choice. */
  compact?: boolean;
}) {
  const theme = useTheme();
  const colour = tint ?? theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={!isEnabled}
      style={[
        styles.chip,
        compact ? styles.chipCompact : null,
        {
          backgroundColor: isOn
            ? withAlpha(colour, theme.tintFill)
            : theme.fill,
          borderColor: isOn
            ? withAlpha(colour, theme.tintEdge + 0.08)
            : theme.fillBorder,
          opacity: isEnabled ? 1 : 0.4,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[
          styles.chipText,
          { color: isOn ? colour : theme.secondaryLabel },
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

// MARK: - LabelledField

/// A named field. Small enough to live here rather than in a screen, because three screens use it.
export function LabelledField({
  name,
  value,
  onChange,
  placeholder,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  secureTextEntry = false,
  style,
  labelStyle,
  inputStyle,
}: {
  name: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'url';
  autoCapitalize?: 'none' | 'sentences';
  /** Masks input, e.g. for tokens and other secrets that shouldn't render as plain text. */
  secureTextEntry?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Overrides on top of the shared label style — for a card whose fields need their own rhythm
   *  without changing every other LabelledField in the app. */
  labelStyle?: StyleProp<TextStyle>;
  /** Overrides on top of the shared input style, same reasoning as `labelStyle`. */
  inputStyle?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[{ flex: 1, gap: spacing.hair }, style]}>
      <Text
        style={[styles.caption, { color: theme.secondaryLabel }, labelStyle]}
      >
        {name}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={theme.tertiaryLabel}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        style={[
          styles.field,
          {
            color: theme.label,
            backgroundColor: theme.fill,
            borderColor: theme.separator,
          },
          inputStyle,
        ]}
      />
    </View>
  );
}

// MARK: - Toggle row

export function ToggleRow({
  label,
  isOn,
  onToggle,
  labelStyle,
}: {
  label: string;
  isOn: boolean;
  onToggle: () => void;
  /** Overrides on top of the shared label style, same reasoning as `LabelledField`'s. */
  labelStyle?: StyleProp<TextStyle>;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onToggle} style={styles.toggleRow}>
      <Text
        style={[styles.caption, { color: theme.label, flex: 1 }, labelStyle]}
      >
        {label}
      </Text>
      <Pill
        text={isOn ? 'ON' : 'OFF'}
        tint={isOn ? theme.status.good : theme.idle}
      />
    </Pressable>
  );
}

// MARK: - ContentUnavailable

/// The port of `ContentUnavailableView`: a title, an explanation, and optionally the one action
/// that resolves it.
export function ContentUnavailable({
  glyph,
  title,
  message,
  actionTitle,
  onAction,
}: {
  glyph: string;
  title: string;
  message: string;
  actionTitle?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.unavailable}>
      {/* The glyph sits in the same tinted disc a card header's does, three sizes up. A bare emoji
          floating on the card was the one illustration in the app with no surface under it. */}
      <View
        style={[
          styles.unavailableBadge,
          { backgroundColor: withAlpha(theme.accent, theme.tintSoft) },
        ]}
      >
        <Text style={{ fontSize: 30 }}>{glyph}</Text>
      </View>
      <Text style={[styles.unavailableTitle, { color: theme.label }]}>
        {title}
      </Text>
      <Text
        style={[
          styles.caption,
          {
            color: theme.secondaryLabel,
            textAlign: 'center',
            // A full-width measure centred under a short title reads as a paragraph that lost its
            // card. Held to a column, it reads as the title's explanation.
            maxWidth: 320,
          },
        ]}
      >
        {message}
      </Text>
      {/* Stretched rather than compact: the empty state's one action reads as the card's own
          button when it spans the card, and as a stray chip when it does not. */}
      {actionTitle && onAction ? (
        <View style={{ alignSelf: 'stretch' }}>
          <ActionButton title={actionTitle} onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

// MARK: - LogPane

/// One line of a feed, in its three parts. Structurally the same shape as the provider's
/// `LogEntry` — kept as its own type here so the shared component stays independent of the state
/// module rather than importing back into it.
export type LogLine = { stamp: string; kind: string; detail: string };

/// The channels that are not neutral. Everything unlisted reads as the accent: the feed's job is to
/// make the two or three lines that changed something findable in a scroll of forty that did not,
/// and colouring every kind differently would defeat exactly that.
const LOG_KIND_TINTS: Record<string, 'good' | 'warn' | 'bad'> = {
  READY: 'good',
  START: 'good',
  ENABLED: 'good',
  ACCEPT: 'good',
  PERM: 'warn',
  POWER: 'warn',
  DIAG: 'warn',
  REJECT: 'bad',
  ERROR: 'bad',
  DEGRADED: 'bad',
};

/// The convenience copy of a feed, newest first, in a fixed-height pane so a busy drive cannot push
/// the rest of the screen off the bottom. The durable record is the capture log.
///
/// A badged kind and a stamp on one line, the detail wrapped underneath: a scanning tester is
/// looking for the channel first and the text second, and the old single mono line made both the
/// same weight — which meant finding the one ERROR in a wall of PROVIDER lines was a read, not a
/// glance. The detail stays monospaced because it is full of aligned numbers.
/// The pane itself, without the line rendering: a fixed-height, inset, scrollable box. Split out of
/// `LogPane` so a feed whose rows are not `LogLine`s — the decision log — sits in exactly the same
/// container as the event feed rather than a lookalike that drifts.
export function LogPaneShell({
  children,
  height = 260,
}: {
  children: ReactNode;
  height?: number;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={[
        styles.logPane,
        {
          height,
          backgroundColor: theme.fill,
          borderColor: theme.fillBorder,
        },
      ]}
      nestedScrollEnabled
    >
      {children}
    </ScrollView>
  );
}

/// One row of a pane, hairline-separated from the row above it.
export function LogPaneRow({
  children,
  first,
}: {
  children: ReactNode;
  first: boolean;
}) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.logEntry,
        !first && {
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: theme.separator,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function LogPane({
  lines,
  height = 260,
}: {
  lines: LogLine[];
  height?: number;
}) {
  const theme = useTheme();
  return (
    <LogPaneShell height={height}>
      {lines.map((line, index) => {
        const role = LOG_KIND_TINTS[line.kind];
        const tint = role ? theme.status[role] : theme.accent;
        return (
          <LogPaneRow
            key={`${index}-${line.stamp}-${line.kind}`}
            first={index === 0}
          >
            <View style={styles.logEntryHeader}>
              <Pill text={line.kind} tint={tint} />
              <Text style={[styles.logStamp, { color: theme.secondaryLabel }]}>
                {line.stamp}
              </Text>
            </View>
            <Text selectable style={[styles.log, { color: theme.label }]}>
              {line.detail}
            </Text>
          </LogPaneRow>
        );
      })}
    </LogPaneShell>
  );
}

// MARK: - SessionPicker

export type PickerSession = {
  id: string;
  startedAtMs: number;
  endedAtMs?: number;
  tag?: string;
  isOpen: boolean;
};

/// The session selector, shared by Home, Track, Debug and Decisions.
///
/// ONE component, deliberately. Three copies would drift, and the drift is not cosmetic — it is a
/// tab labelling a session `a1b2c3d4` while another labels the same row by its start time, at which
/// point two screens that disagree look like a data bug rather than a formatting one.
///
/// `undefined` means THE LIVE SESSION, not "nothing selected": the tracking state resolves the
/// selection as `selectedSessionId ?? currentSession()?.id`, so leaving this alone follows the run
/// happening now and picking a row pins every tab to the same past run.
export function SessionPicker({
  sessions,
  selection,
  onSelect,
  resolvedSessionId,
}: {
  sessions: PickerSession[];
  selection?: string;
  onSelect: (id: string | undefined) => void;
  resolvedSessionId?: string;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [isOpen, setIsOpen] = useState(false);
  const selected = sessions.find((session) => session.id === selection);

  return (
    <View style={{ gap: spacing.tight }}>
      <Pressable
        onPress={() => setIsOpen(true)}
        style={({ pressed }) => [
          styles.picker,
          {
            backgroundColor: theme.fill,
            borderColor: theme.fillBorder,
            opacity: pressed ? 0.6 : 1,
          },
        ]}
      >
        <Text
          style={[styles.pickerLabel, { color: theme.label }]}
          numberOfLines={1}
        >
          {selected ? sessionLabel(selected) : 'Live session'}
        </Text>
        {/* The same badge the collapsible cards use for their chevron, pointing down. A bare "▾"
            glyph in secondary grey was the one control on the screen with no surface of its own. */}
        <CollapseChevron expanded={false} theme={theme} />
      </Pressable>

      <View style={styles.pickerFooter}>
        <Text
          selectable
          style={[styles.factValue, { color: theme.secondaryLabel }]}
        >
          {resolvedSessionId
            ? `id ${shortId(resolvedSessionId)}`
            : 'no session yet'}
        </Text>
        <Pill text={`${sessions.length} RECORDED`} />
      </View>

      <Modal
        visible={isOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setIsOpen(false)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setIsOpen(false)}
        >
          <Pressable
            style={[
              styles.sheet,
              // The real inset, so the last session row clears the gesture pill on Android and the
              // home indicator on iOS.
              {
                backgroundColor: theme.card,
                paddingBottom: spacing.screen + insets.bottom,
              },
            ]}
            onPress={() => {}}
          >
            <Text style={[styles.cardTitle, { color: theme.secondaryLabel }]}>
              Session
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              <Pressable
                onPress={() => {
                  onSelect(undefined);
                  setIsOpen(false);
                }}
                style={styles.sheetRow}
              >
                <Text style={{ color: selection ? theme.label : theme.accent }}>
                  Live session
                </Text>
              </Pressable>
              {sessions.map((session) => (
                <Pressable
                  key={session.id}
                  onPress={() => {
                    onSelect(session.id);
                    setIsOpen(false);
                  }}
                  style={styles.sheetRow}
                >
                  <Text
                    style={{
                      color:
                        selection === session.id ? theme.accent : theme.label,
                    }}
                    numberOfLines={1}
                  >
                    {sessionLabel(session)}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// MARK: - Sheet

/// A presented sheet with a title and two actions — the rationale sheet's shape.
export function Sheet({
  isVisible,
  title,
  onDismiss,
  confirmTitle,
  onConfirm,
  children,
}: {
  isVisible: boolean;
  title: string;
  onDismiss: () => void;
  confirmTitle?: string;
  onConfirm?: () => void;
  children: ReactNode;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={isVisible} animationType="slide" onRequestClose={onDismiss}>
      {/* A full-screen Modal draws under the status bar and the notch, and this sheet's only two
          controls live in the bar at the very top. Without the inset, "Not now" and "Continue"
          render behind the clock and the Dynamic Island — visible, and half untappable, which is a
          sheet the user cannot leave. */}
      <View
        style={{
          flex: 1,
          backgroundColor: theme.screen,
          paddingTop: insets.top,
        }}
      >
        <ScreenBackdrop />
        <View style={[styles.sheetBar, { borderBottomColor: theme.separator }]}>
          <Pressable onPress={onDismiss}>
            <Text style={{ color: theme.accent, fontSize: 16 }}>Close</Text>
          </Pressable>
          <Text style={{ color: theme.label, fontSize: 16, fontWeight: '600' }}>
            {title}
          </Text>
          {confirmTitle && onConfirm ? (
            <Pressable onPress={onConfirm}>
              <Text
                style={{ color: theme.accent, fontSize: 16, fontWeight: '600' }}
              >
                {confirmTitle}
              </Text>
            </Pressable>
          ) : (
            <View style={{ width: 60 }} />
          )}
        </View>
        <ScrollView
          contentContainerStyle={{
            padding: spacing.screen,
            gap: spacing.section,
          }}
        >
          {children}
        </ScrollView>
      </View>
    </Modal>
  );
}

// MARK: - Formatting

/// The first eight characters of the id, which is what every other surface prints and what a field
/// tester reads back over the phone.
export function shortId(id?: string): string {
  if (!id) {
    return '—';
  }
  return id.slice(0, 8);
}

/// `21:34 · 10 Aug · commute · 8m · a1b2c3d4` — start time first, because a field tester scans for
/// the run they just did.
export function sessionLabel(session: PickerSession): string {
  const started = new Date(session.startedAtMs);
  const parts = [
    started.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    }),
    started.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  ];
  if (session.tag) {
    parts.push(session.tag);
  }
  if (session.isOpen) {
    parts.push('open');
  } else if (session.endedAtMs) {
    parts.push(
      duration(
        Math.max(
          0,
          Math.round((session.endedAtMs - session.startedAtMs) / 1000)
        )
      )
    );
  }
  parts.push(shortId(session.id));
  return parts.join(' · ');
}

export function duration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`;
}

/// `#rrggbb` plus an alpha, because React Native has no `Color.opacity`.
///
/// An `rgba()` input keeps its channels and takes the new alpha SCALED by the one it arrived with,
/// rather than passing through untouched. The neutral roles — `idle`, `secondaryLabel` — are
/// already part-transparent ink, and returning those verbatim painted a tint meant to sit at 0.14
/// as a near-solid slab: a `138 RECORDED` pill in dark grey next to identical pills in pale blue.
export function withAlpha(colour: string, alpha: number): string {
  const rgba = colour.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/
  );
  if (rgba) {
    const existing = rgba[4] === undefined ? 1 : Number(rgba[4]);
    return `rgba(${rgba[1]}, ${rgba[2]}, ${rgba[3]}, ${alpha * existing})`;
  }
  const hex = colour.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type { Palette };

const styles = StyleSheet.create({
  band: { flex: 1 },
  card: { padding: spacing.card, gap: spacing.row },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.tight,
  },
  cardGlyphBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardGlyph: { fontSize: 16 },
  cardTitle: { fontSize: font.cardTitle + 1, fontWeight: '700' },
  caption: { fontSize: 12, lineHeight: 17 },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.row },
  factRowStacked: { flexDirection: 'column', gap: spacing.tight },
  factName: { fontSize: font.factName, flexShrink: 0 },
  factNameStacked: {
    fontSize: font.factName - 2,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  factNameSpaceBetween: {
    fontSize: font.factName + 1,
  },
  factValue: {
    fontFamily: font.mono,
    fontSize: font.factValue,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  factValueStacked: {
    flex: 0,
    textAlign: 'left',
    fontSize: font.factValue + 2,
    fontWeight: '700',
  },
  /// Stacked's type sizing on a row that stays side-by-side, keeping `factValue`'s flexible width
  /// so a long value — a full 36-character session id — wraps inside the card instead of running
  /// off its right edge.
  factValueStackedFont: {
    fontSize: font.factValue + 2,
    fontWeight: '700',
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.tight,
    paddingVertical: spacing.hair + 1,
  },
  pillText: { fontFamily: font.mono, fontSize: font.pill, fontWeight: '700' },
  explanation: { borderRadius: radius.inner, padding: spacing.row },
  actionRow: { gap: spacing.row },
  button: {
    flex: 1,
    borderRadius: radius.inner,
    paddingVertical: 11,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonCompact: { flex: 0, alignSelf: 'center', paddingHorizontal: 22 },
  buttonLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.tight,
  },
  buttonText: { fontSize: 13.5, fontWeight: '700', letterSpacing: 0.2 },
  buttonSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: 2,
  },
  chip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.card,
    paddingVertical: 7,
  },
  chipCompact: { paddingHorizontal: spacing.row },
  chipText: { fontSize: 12.5, fontWeight: '600' },
  field: {
    borderRadius: radius.inner,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: font.mono,
    fontSize: 13,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.row },
  // Its own top padding only. The card already pads its bottom edge, and padding both left the
  // empty state floating well above the card's floor.
  unavailable: {
    alignItems: 'center',
    gap: spacing.row,
    paddingTop: spacing.section,
    paddingHorizontal: spacing.section,
  },
  unavailableBadge: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  unavailableTitle: { fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  logPane: {
    borderRadius: radius.inner,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing.tight,
  },
  log: { fontFamily: font.mono, fontSize: font.log, lineHeight: 15 },
  logEntry: { gap: spacing.hair, paddingVertical: spacing.tight },
  logEntryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.tight,
  },
  logStamp: { fontFamily: font.mono, fontSize: font.pill },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.tight,
    borderRadius: radius.inner,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    // Smaller than a plain row's: the chevron badge inside is 26pt tall and sets the height.
    paddingVertical: 8,
  },
  pickerLabel: { flex: 1, fontSize: 13.5, fontWeight: '600' },
  pickerFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.tight,
  },
  sheetBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.screen,
    gap: spacing.tight,
  },
  sheetRow: { paddingVertical: 12 },
  sheetBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.screen,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});

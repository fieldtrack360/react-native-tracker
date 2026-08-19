import { type ReactNode, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
// Insets rather than RN's SafeAreaView: that component is iOS-only, so on Android this sheet's
// toolbar would sit under the status bar and its content under the gesture pill.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, spacing, useTheme, type Palette } from './theme';

// The shared parts every tab uses — the port of SampleApp/Shared/Theme/Components.swift and
// SampleApp/Shared/SessionPicker.swift.
//
// Shared for the reason the iOS sample shares them: five tabs each drawing their own grouped box is
// five sets of padding that drift apart, and a diagnostic screen where the Debug tab's counts sit a
// few points off the Decisions tab's counts is a screen people stop trusting.

// MARK: - Screen

export function Screen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: theme.screen }}
      contentContainerStyle={{
        padding: spacing.screen,
        gap: spacing.section,
        paddingBottom: 48,
      }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

// MARK: - DiagnosticCard

/// The one card every tab uses. `systemImage` is carried as an emoji glyph — React Native has no SF
/// Symbols, and the icon is what a tester scans for when they are told "the Queue card".
export function DiagnosticCard({
  title,
  glyph,
  right,
  onHeaderPress,
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
  children: ReactNode;
}) {
  const theme = useTheme();
  const HeaderContainer = onHeaderPress ? Pressable : View;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.card, borderRadius: radius.card },
      ]}
    >
      <HeaderContainer
        style={{ flexDirection: 'row', alignItems: 'center' }}
        {...(onHeaderPress ? { onPress: onHeaderPress } : {})}
      >
        <Text
          style={[styles.cardTitle, { color: theme.secondaryLabel, flex: 1 }]}
        >
          {glyph} {title}
        </Text>
        {right}
      </HeaderContainer>
      {children}
    </View>
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
}: {
  name: string;
  value: string | number;
  tint?: string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.factRow}>
      <Text style={[styles.factName, { color: theme.secondaryLabel }]}>
        {name}
      </Text>
      <Text
        selectable
        style={[styles.factValue, { color: tint ?? theme.label }]}
        numberOfLines={2}
      >
        {String(value)}
      </Text>
    </View>
  );
}

// MARK: - Pill

/// A small tinted label — a count, a verdict, a state.
export function Pill({ text, tint }: { text: string; tint?: string }) {
  const theme = useTheme();
  const colour = tint ?? theme.idle;
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(colour, 0.14) }]}>
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
      style={[styles.explanation, { backgroundColor: withAlpha(colour, 0.1) }]}
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
export function Note({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Text style={[styles.caption, { color: theme.secondaryLabel }]}>
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
}: {
  title: string;
  glyph?: string;
  onPress: () => void;
  prominent?: boolean;
  destructive?: boolean;
  disabled?: boolean;
}) {
  const theme = useTheme();
  const tint = destructive ? theme.status.bad : theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.button,
        {
          backgroundColor: prominent ? tint : withAlpha(tint, 0.12),
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      <Text
        numberOfLines={1}
        style={[styles.buttonText, { color: prominent ? '#ffffff' : tint }]}
      >
        {glyph ? `${glyph} ` : ''}
        {title}
      </Text>
    </Pressable>
  );
}

// MARK: - Chip

/// A toggle that greys out rather than disappearing. A control that vanishes reads as a missing
/// feature; one that greys out reads as a missing input.
export function Chip({
  title,
  tint,
  isOn,
  isEnabled = true,
  onPress,
}: {
  title: string;
  tint?: string;
  isOn: boolean;
  isEnabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const colour = tint ?? theme.accent;
  return (
    <Pressable
      onPress={onPress}
      disabled={!isEnabled}
      style={[
        styles.chip,
        {
          backgroundColor: isOn ? withAlpha(colour, 0.16) : 'transparent',
          borderColor: isOn ? colour : theme.separator,
          opacity: isEnabled ? 1 : 0.4,
        },
      ]}
    >
      <Text
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
  style,
}: {
  name: string;
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'url';
  autoCapitalize?: 'none' | 'sentences';
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  return (
    <View style={[{ flex: 1, gap: spacing.hair }, style]}>
      <Text style={[styles.caption, { color: theme.secondaryLabel }]}>
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
        style={[
          styles.field,
          {
            color: theme.label,
            backgroundColor: theme.fill,
            borderColor: theme.separator,
          },
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
}: {
  label: string;
  isOn: boolean;
  onToggle: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable onPress={onToggle} style={styles.toggleRow}>
      <Text style={[styles.caption, { color: theme.label, flex: 1 }]}>
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
      <Text style={{ fontSize: 34 }}>{glyph}</Text>
      <Text style={[styles.unavailableTitle, { color: theme.label }]}>
        {title}
      </Text>
      <Text
        style={[
          styles.caption,
          { color: theme.secondaryLabel, textAlign: 'center' },
        ]}
      >
        {message}
      </Text>
      {actionTitle && onAction ? (
        <ActionButton title={actionTitle} onPress={onAction} />
      ) : null}
    </View>
  );
}

// MARK: - LogPane

/// The convenience copy of a feed, newest first, in a fixed-height pane so a busy drive cannot push
/// the rest of the screen off the bottom. The durable record is the capture log.
export function LogPane({
  lines,
  height = 260,
}: {
  lines: string[];
  height?: number;
}) {
  const theme = useTheme();
  return (
    <ScrollView
      style={[styles.logPane, { height, backgroundColor: theme.fill }]}
      nestedScrollEnabled
    >
      {lines.map((line, index) => (
        <Text
          key={`${index}-${line}`}
          selectable
          style={[styles.log, { color: theme.label }]}
        >
          {line}
        </Text>
      ))}
    </ScrollView>
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
        style={[
          styles.picker,
          { backgroundColor: theme.fill, borderColor: theme.separator },
        ]}
      >
        <Text
          style={[styles.pickerLabel, { color: theme.label }]}
          numberOfLines={1}
        >
          {selected ? sessionLabel(selected) : 'Live session'}
        </Text>
        <Text style={{ color: theme.secondaryLabel }}>▾</Text>
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
export function withAlpha(colour: string, alpha: number): string {
  if (colour.startsWith('rgba')) {
    return colour;
  }
  const hex = colour.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export type { Palette };

const styles = StyleSheet.create({
  card: { padding: spacing.card, gap: spacing.row },
  cardTitle: { fontSize: font.cardTitle, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17 },
  factRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.row },
  factName: { fontSize: font.factName, flexShrink: 0 },
  factValue: {
    fontFamily: font.mono,
    fontSize: font.factValue,
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
  },
  pill: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.tight,
    paddingVertical: spacing.hair + 1,
  },
  pillText: { fontFamily: font.mono, fontSize: font.pill, fontWeight: '700' },
  explanation: { borderRadius: radius.pill, padding: spacing.row },
  actionRow: { gap: spacing.row },
  button: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 13, fontWeight: '600' },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.card,
    paddingVertical: spacing.tight,
  },
  chipText: { fontSize: 13, fontWeight: '500' },
  field: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: font.mono,
    fontSize: 13,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.row },
  unavailable: {
    alignItems: 'center',
    gap: spacing.row,
    padding: spacing.section,
  },
  unavailableTitle: { fontSize: 17, fontWeight: '600' },
  logPane: { borderRadius: 8, padding: spacing.tight },
  log: { fontFamily: font.mono, fontSize: font.log, lineHeight: 15 },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.tight,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  pickerLabel: { flex: 1, fontSize: 13 },
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
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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

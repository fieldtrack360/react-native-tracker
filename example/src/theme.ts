import { useColorScheme } from 'react-native';

// The sample's visual vocabulary, in one place — the port of SampleApp/Shared/Theme/Theme.swift.
//
// The colours here are DIAGNOSTIC, not decorative. The three layer colours are quoted verbatim from
// the iOS sample — grey raw, blue filter, green stored — and the whole three-layer reading is
// unreadable if any tab picks its own. Same for the verdict colours: a reviewer looking at the
// decision log and the debug counts side by side has to be able to match them by eye, and that only
// works while one file owns them.

// The two system-grouped backgrounds SwiftUI gives the iOS sample for free. Spelled out here
// because React Native has no semantic colours: `Color(uiColor: .systemGroupedBackground)` is the
// screen, `.secondarySystemGroupedBackground` is the card sitting on it.
const light = {
  screen: '#f2f2f7',
  card: '#ffffff',
  separator: '#c6c6c8',
  fill: 'rgba(120,120,128,0.12)',
  label: '#000000',
  secondaryLabel: 'rgba(60,60,67,0.6)',
  tertiaryLabel: 'rgba(60,60,67,0.3)',
  accent: '#007aff',
  bar: '#f9f9f9',
};

const dark = {
  screen: '#000000',
  card: '#1c1c1e',
  separator: '#38383a',
  fill: 'rgba(120,120,128,0.24)',
  label: '#ffffff',
  secondaryLabel: 'rgba(235,235,245,0.6)',
  tertiaryLabel: 'rgba(235,235,245,0.3)',
  accent: '#0a84ff',
  bar: '#1c1c1e',
};

// The three-layer overlay. "Which layer did the artefact first appear in" is the highest-value
// question in the system, and it is answered by colour.
export const layer = {
  /** Layer 1 — raw fixes, exactly as the platform delivered them. */
  raw: '#6b6b6b',
  /** Layer 2 — what the filter believed, recorded on every decision. */
  filter: '#2170f0',
  /** Layer 3 — what was actually stored. */
  stored: '#0da35c',
};

// Green / amber / red. Amber rather than grey for `skip`, because a skip is a fix the filter
// consumed and chose not to store — a fact worth seeing, not an absence.
export const verdict = {
  accept: '#0d9954',
  skip: '#d49a08',
  reject: '#d12929',
};

// Health, for a status card. Deliberately four values and not a boolean: "not yet known" and "known
// to be off" read identically in a two-state design, and on the permission ladder that difference
// is the whole screen.
export const status = {
  good: '#0d9954',
  warn: '#d49a08',
  bad: '#d12929',
};

export const spacing = {
  hair: 2,
  tight: 6,
  row: 10,
  card: 14,
  section: 18,
  screen: 16,
};

export const radius = {
  card: 12,
  pill: 6,
};

// Everything that carries a number a field tester will read aloud over the phone is monospaced.
// Proportional digits in a capture log make two aligned columns look ragged and two ragged ones
// look aligned.
export const font = {
  mono: 'Menlo',
  cardTitle: 15,
  factName: 12,
  factValue: 12,
  log: 10.5,
  pill: 10,
};

export type Palette = typeof light & {
  layer: typeof layer;
  verdict: typeof verdict;
  status: typeof status;
  /** `status.good/warn/bad` plus the one value that is a colour role rather than a health one. */
  idle: string;
  isDark: boolean;
};

export function useTheme(): Palette {
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const base = isDark ? dark : light;
  return {
    ...base,
    layer,
    verdict,
    status,
    idle: base.secondaryLabel,
    isDark,
  };
}

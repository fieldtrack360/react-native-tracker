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
  screen: '#eef1f7',
  card: '#ffffff',
  /** The card's own edge. A hairline tinted with the ink colour rather than a grey line: on a
   *  tinted screen a neutral grey border reads as dirty, a low-alpha ink one just reads as an edge. */
  cardBorder: 'rgba(16,24,40,0.07)',
  separator: 'rgba(16,24,40,0.10)',
  fill: 'rgba(16,24,40,0.045)',
  /** The edge of a filled box. Half the card border, because these boxes nest inside one. */
  fillBorder: 'rgba(16,24,40,0.05)',
  label: '#0b1220',
  secondaryLabel: 'rgba(16,24,40,0.58)',
  tertiaryLabel: 'rgba(16,24,40,0.3)',
  accent: '#2563eb',
  bar: '#ffffff',
  /** The ink laid over a SOLID tinted fill — a prominent button, the Start/Stop control. One value
   *  per scheme rather than one per colour, because within a scheme every solid fill sits on the
   *  same side of the contrast line: light mode's fills are all deep enough for white, dark mode's
   *  are all light enough that white on them is the unreadable pairing and near-black is not. */
  onSolid: '#ffffff',
  /** The three alphas every tinted surface in the app is built from — a pill's ground, a badge's
   *  disc, the quiet variant of a button, the hairline around any of them.
   *
   *  Carried per scheme because alpha is not scheme-neutral: a tint at 0.14 over white lands well
   *  clear of the card, the same 0.14 over a near-black card is a colour you have to hunt for. Dark
   *  needs roughly half again as much before the surface reads as a surface at all. */
  tintFill: 0.14,
  /** The quieter ground — an explanation box, a large empty-state disc, where the tint is a wash
   *  behind prose rather than a chip the eye should land on. */
  tintSoft: 0.1,
  /** The edge around a tinted fill. Always above `tintFill`, so the shape has a boundary. */
  tintEdge: 0.22,
  /** The two soft colour washes the screen backdrop paints behind everything — see
   *  `ScreenBackdrop`. Carried as channels plus a peak alpha rather than a finished colour string,
   *  because the backdrop fades each one across the window and so needs the alpha on its own. */
  glowTop: { rgb: '37, 99, 235', alpha: 0.16 },
  glowBottom: { rgb: '13, 153, 84', alpha: 0.18 },
  shadow: '#0b1220',
  shadowOpacity: 0.07,
};

const dark = {
  // A step lighter than the old near-black pair. The screen has to stay clearly below the card or
  // the stack of cards flattens, but a #0a0c11 screen under a #161a22 card is two blacks a phone at
  // outdoor brightness renders as one.
  screen: '#0d1017',
  card: '#1a1f29',
  cardBorder: 'rgba(255,255,255,0.10)',
  separator: 'rgba(255,255,255,0.14)',
  fill: 'rgba(255,255,255,0.075)',
  fillBorder: 'rgba(255,255,255,0.09)',
  label: '#f5f7fa',
  // Lifted from 0.62/0.32: at those alphas the caption prose under every card — which is where this
  // sample keeps its teaching — sat at the edge of legible on an OLED panel.
  secondaryLabel: 'rgba(235,240,250,0.72)',
  tertiaryLabel: 'rgba(235,240,250,0.42)',
  accent: '#7cb4ff',
  bar: '#1a1f29',
  onSolid: '#0b1220',
  tintFill: 0.2,
  tintSoft: 0.14,
  tintEdge: 0.34,
  // Softer than light mode's. A wash reads as a wash over white; over a near-black screen the same
  // alpha reads as a coloured haze sitting in front of the content, and the green one pooling
  // behind the floating tab bar was the worst of it.
  glowTop: { rgb: '124, 180, 255', alpha: 0.09 },
  glowBottom: { rgb: '45, 200, 130', alpha: 0.08 },
  shadow: '#000000',
  shadowOpacity: 0.45,
};

// The three-layer overlay. "Which layer did the artefact first appear in" is the highest-value
// question in the system, and it is answered by colour.
//
// Each of the three diagnostic families below ships TWO sets. The hues are identical — a reviewer
// comparing a light screenshot to a dark one still matches grey to grey and green to green — but
// the lightness is not, and it cannot be: `#0d9954` is a green chosen to be legible against white,
// and the same green as text on a near-black card is a smear. What has to be preserved across the
// two schemes is the READING, not the hex.
export const layer = {
  /** Layer 1 — raw fixes, exactly as the platform delivered them. */
  raw: '#6b6b6b',
  /** Layer 2 — what the filter believed, recorded on every decision. */
  filter: '#2170f0',
  /** Layer 3 — what was actually stored. */
  stored: '#0da35c',
};

const darkLayer: typeof layer = {
  raw: '#9ba3ae',
  filter: '#6aa6ff',
  stored: '#3ad68f',
};

// Green / amber / red. Amber rather than grey for `skip`, because a skip is a fix the filter
// consumed and chose not to store — a fact worth seeing, not an absence.
export const verdict = {
  accept: '#0d9954',
  skip: '#d49a08',
  reject: '#d12929',
};

const darkVerdict: typeof verdict = {
  accept: '#3ecf8e',
  skip: '#f2c14e',
  reject: '#ff7b7b',
};

// Health, for a status card. Deliberately four values and not a boolean: "not yet known" and "known
// to be off" read identically in a two-state design, and on the permission ladder that difference
// is the whole screen.
export const status = {
  good: '#0d9954',
  warn: '#d49a08',
  bad: '#d12929',
};

const darkStatus: typeof status = {
  good: '#3ecf8e',
  warn: '#f2c14e',
  bad: '#ff7b7b',
};

export const spacing = {
  hair: 2,
  tight: 6,
  row: 10,
  card: 14,
  section: 12,
  screen: 16,
};

export const radius = {
  card: 18,
  /** The boxes nested inside a card. Always smaller than `card`, so the nesting reads as nesting
   *  rather than as two cards that happen to overlap. */
  inner: 12,
  pill: 8,
};

/// One elevation, applied to every raised surface. Two would drift, and on a screen of stacked
/// cards a card floating higher than its neighbour reads as a state, not as decoration.
export const elevation = (palette: {
  shadow: string;
  shadowOpacity: number;
}) => ({
  shadowColor: palette.shadow,
  shadowOpacity: palette.shadowOpacity,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 3,
});

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
    layer: isDark ? darkLayer : layer,
    verdict: isDark ? darkVerdict : verdict,
    status: isDark ? darkStatus : status,
    idle: base.secondaryLabel,
    isDark,
  };
}

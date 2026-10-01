/**
 * Semantic design tokens for Reduction Mobile.
 *
 * Mirrors the palette in artifacts/reduction/src/index.css (the "cookbook"
 * theme: warm parchment page, cream cards, terracotta "ready to cook" accent)
 * so the mobile companion feels like the same product as the web app. The
 * dark palette has diverged: the phone's is "Cocoa" (Oct 1), the web's is
 * still the original near-black.
 *
 * `warm`/`cool`/`danger` are extra semantic accents beyond the scaffold's
 * defaults — they carry the same meaning as on web: warm = "ready now" /
 * primary call to action, cool = a secondary/quiet accent, danger = a
 * destructive or error state.
 */

const colors = {
  light: {
    // Legacy aliases (kept for backward compatibility)
    text: '#211d18',
    tint: '#211d18',

    // Core surfaces
    background: '#e8d5b2',
    foreground: '#211d18',

    // Cards / elevated surfaces
    card: '#fffdf6',
    cardForeground: '#211d18',

    // Primary action color (buttons, links, active states)
    primary: '#211d18',
    primaryForeground: '#fffcf3',

    // Secondary / less-emphasis interactive surfaces
    secondary: '#eaeedd',
    secondaryForeground: '#5b6d47',

    // Muted / subdued elements (dividers, timestamps, placeholders)
    muted: '#f7f0df',
    mutedForeground: '#6b6154',

    // Accent highlights (badges, selected items, focus rings) — "ready to
    // cook now" warm terracotta, the web app's primary visual signature.
    accent: '#f9d6cf',
    accentForeground: '#6e1c14',

    // Destructive actions (delete, error states)
    destructive: '#92351b',
    destructiveForeground: '#fdeee5',

    // Borders and input outlines
    border: '#e4d6b8',
    input: '#e4d6b8',

    // Extra semantic tokens beyond the scaffold defaults
    borderStrong: '#c9b48a',
    faint: '#948b7d',
    warmBg: '#f9d6cf',
    warmLine: '#b93326',
    warmInk: '#6e1c14',
    coolBg: '#eaeedd',
    coolLine: '#8ba668',
    coolInk: '#5b6d47',
    dangerBg: '#fdeee5',
    dangerLine: '#eec9b4',
    dangerInk: '#92351b',

    // Surfaces that used to be literals in their components (Oct 1), so the
    // dark palette reaches them. Light values are exactly the old literals.
    // Find's tabs behind the chosen one (FolderTabs).
    tabBack: '#c9b48a',
    tabBackLine: '#c9b48a',
    // The Recipe Box's cream pages and the reel's cards (BookPage, PageFace,
    // StarterReel): paper in both themes, toned down a step in dark.
    paper: '#fbf6ea',
    paperSpine: '#f4ecdb',
    // The paper's two greys and the "Not cooked yet" pill (PageFace,
    // BookPage, StarterReel), literals there until Oct 1: the time, serves
    // and steps, the site; and the "+N more", the page number, the blank
    // page. Light is exactly the old literals (themeTokens.test.ts).
    paperMuted: '#8a7a66',
    paperFaint: '#a8977f',
    paperPill: '#ece3d0',
    // The toast's dark pill (Toast.tsx), white text on it in both themes.
    toastBg: '#2a2118',
  },

  // "Cocoa" (Oct 1, the owner's choice from a mock): a warm brown page
  // instead of near-black, diagram cells a clear step above it, and edges
  // light enough to see — cell edges 3.2:1 against the cells, the frame
  // 5.6:1 against the page. Before/after ratios in ROADMAP "Dark mode:
  // Cocoa". The red ready, green done and green active tab are the same
  // translucent tints as before, so they render over the new cells.
  dark: {
    text: '#f6eedd',
    tint: '#f6eedd',

    background: '#211a16',
    foreground: '#f6eedd',

    card: '#3b2f28',
    cardForeground: '#f6eedd',

    primary: '#f6eedd',
    primaryForeground: '#1c1a16',

    secondary: 'rgba(133,168,92,0.16)',
    secondaryForeground: '#b3c795',

    // The diagram's pinned ingredient column, and pressed surfaces.
    muted: '#463930',
    mutedForeground: '#c7b9a3',

    accent: 'rgba(228,92,70,0.26)',
    accentForeground: '#ffc0b1',

    destructive: 'rgba(146,53,27,0.28)',
    destructiveForeground: '#ff9c85',

    // Cell edges and dividers.
    border: '#8f7a69',
    input: '#8f7a69',

    // The diagram's outer frame (and every other strong rule).
    borderStrong: '#a68f7b',
    // Not in the mock: lifted from #786f60 so the small uppercase labels
    // keep their contrast on the lighter cards (2.6:1 otherwise; now 3.55:1
    // on a card, 4.7:1 on the page), and still read quieter than
    // mutedForeground.
    faint: '#928472',
    warmBg: 'rgba(228,92,70,0.26)',
    warmLine: '#ef6a53',
    warmInk: '#ffc0b1',
    coolBg: 'rgba(133,168,92,0.16)',
    coolLine: '#8aac5b',
    coolInk: '#b3c795',
    dangerBg: 'rgba(146,53,27,0.28)',
    dangerLine: 'rgba(238,201,180,0.35)',
    dangerInk: '#ff9c85',

    tabBack: '#3b2f28',
    tabBackLine: '#76624f',
    paper: '#ebdfc6',
    // The same step toward the spine as light's (#fbf6ea -> #f4ecdb).
    paperSpine: '#e4d5b7',
    // The lightest grey that keeps small text at 4.5:1 on the darker paper
    // (4.53:1; the light greys measured 3.15:1 and 2.15:1 here, Oct 1).
    // At that floor the two greys meet: dark mode has one paper grey.
    // The pill keeps light's tint, a step above the paper; 4.69:1 on it.
    paperMuted: '#706150',
    paperFaint: '#706150',
    paperPill: '#ece3d0',
    // The pinned column's colour: the old #2a2118 all but vanished on the
    // new page (1.1:1); this is a step above it (1.6:1) with white text 10:1.
    toastBg: '#463930',
  },

  // Colorblind mode — the web's :root[data-colorblind="true"] tokens: a
  // blue/orange pair over the warm/cool "ready vs. done" accents, layered
  // on whichever base is active (hooks/useColors.ts). Only the accent
  // tokens change; the page, cards and ink stay the base's.
  colorblindLight: {
    warmBg: '#fce3bd',
    warmLine: '#a35c05',
    warmInk: '#6b3d05',
    coolBg: '#dfebf6',
    coolLine: '#3d8fc4',
    coolInk: '#2b5f7e',
    accent: '#fce3bd',
    accentForeground: '#6b3d05',
    secondary: '#dfebf6',
    secondaryForeground: '#2b5f7e',
  },
  colorblindDark: {
    warmBg: 'rgba(230,159,0,0.22)',
    warmLine: '#e6a324',
    warmInk: '#ffd68a',
    coolBg: 'rgba(86,168,224,0.2)',
    coolLine: '#6fb3e0',
    coolInk: '#bfe3fa',
    accent: 'rgba(230,159,0,0.22)',
    accentForeground: '#ffd68a',
    secondary: 'rgba(86,168,224,0.2)',
    secondaryForeground: '#bfe3fa',
  },

  // Border radii (px), synced from the web app, which draws three: small
  // buttons at 11 (.rd-btn), the primary action at 12 (.rd-go), and cards at
  // 15 (.rd-card; the diagram frame is 14). One radius for everything is how
  // the scaffold's screens came to look stamped from a single die.
  radius: 11,
  radiusButton: 12,
  radiusCard: 15,
};

export default colors;

/** Headings/UI use Space Grotesk, numeric/mono contexts use Space Mono, body
 *  text uses the platform system sans. Loaded in app/_layout.tsx. */
export const fonts = {
  heading: 'SpaceGrotesk_600SemiBold',
  headingBold: 'SpaceGrotesk_700Bold',
  headingMedium: 'SpaceGrotesk_500Medium',
  mono: 'SpaceMono_400Regular',
  monoBold: 'SpaceMono_700Bold',
};

/**
 * The web card's shadow (.rd-card: 0 1px 2px .18 + 0 9px 22px -11px .34),
 * folded into the one shadow React Native draws. Spread onto any card-like
 * surface. It matters more here than on the web: `border` is within a shade
 * of the page colour, so on parchment a card with no shadow has no edge at
 * all (see DiagramView's header for the same finding on the diagram).
 * Android ignores the shadow props and uses `elevation`.
 */
export const cardShadow = {
  shadowColor: '#3a2418',
  shadowOpacity: 0.18,
  shadowRadius: 11,
  shadowOffset: { width: 0, height: 5 },
  elevation: 3,
} as const;

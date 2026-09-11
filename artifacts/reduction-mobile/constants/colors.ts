/**
 * Semantic design tokens for Reduction Mobile.
 *
 * Mirrors the palette in artifacts/reduction/src/index.css (the "cookbook"
 * theme: warm parchment page, cream cards, terracotta "ready to cook" accent)
 * so the mobile companion feels like the same product as the web app.
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
  },

  dark: {
    text: '#ece6d9',
    tint: '#ece6d9',

    background: '#131110',
    foreground: '#ece6d9',

    card: '#2a2622',
    cardForeground: '#ece6d9',

    primary: '#ece6d9',
    primaryForeground: '#1c1a16',

    secondary: 'rgba(133,168,92,0.16)',
    secondaryForeground: '#b3c795',

    muted: '#2b2723',
    mutedForeground: '#a89f8f',

    accent: 'rgba(228,92,70,0.26)',
    accentForeground: '#ffc0b1',

    destructive: 'rgba(146,53,27,0.28)',
    destructiveForeground: '#ff9c85',

    border: '#3b352c',
    input: '#3b352c',

    borderStrong: '#4e463a',
    faint: '#786f60',
    warmBg: 'rgba(228,92,70,0.26)',
    warmLine: '#ef6a53',
    warmInk: '#ffc0b1',
    coolBg: 'rgba(133,168,92,0.16)',
    coolLine: '#8aac5b',
    coolInk: '#b3c795',
    dangerBg: 'rgba(146,53,27,0.28)',
    dangerLine: 'rgba(238,201,180,0.35)',
    dangerInk: '#ff9c85',
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

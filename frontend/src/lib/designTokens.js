/**
 * KALUSAGAP Design System — canonical tokens.
 *
 * Single source of truth for palette, type scale, spacing and radius.
 * Extracted from the existing CSS/Tailwind config and reused by every
 * component and page.
 */

/* ------------------------------- Palette -------------------------------- */

/**
 * Institutional palette (extracted from tailwind.config brand.* and index.css).
 *
 * NAVY — authority, interactivity, active states, page headings
 *   --primary:      #0B4A8F (brand-blue)   deep government navy
 *   --primary-dark: #072F5F (brand-dark)   deeper accent navy
 *   --primary-dawn: #0E3A75                highlight accent
 *
 * GOLD — KALUSAGAP crest crest, applied sparingly: active-nav indicator,
 *   thin page-header rules, official-seal emphasis only.
 *
 * BACKGROUND — cool off-white page wash, pure white card surfaces,
 *   muted card-nested for secondary info boxes, input surface.
 *
 * BODY TEXT — slate grays, never pure black.
 *
 * SEMANTIC — color has meaning:
 *   green   = completed, active, verified
 *   amber   = pending, due, attention
 *   rose    = overdue, high risk, destructive
 *   navy    = interactive / selected
 *   Everything else is neutral gray.
 */
export const PALETTE = Object.freeze({
  primary: "0B4A8F",
  primaryDark: "072F5F",
  primaryDawn: "0E3A75",
  gold: "B98A1E",
  goldLight: "E4C35D",
  goldPale: "FBF3DE",
  ink: "12263F",
  body: "2A3747",
  muted: "54637A",
  subtle: "8A95A4",
  divider: "D6DEE8",
  dividerSubtle: "E7ECF1",
  bg: "F4F6FA",
  card: "FFFFFF",
  cardNested: "EDF3FA",
  input: "FFFFFF",
  inputBorder: "D6DEE8",
  darkMode: {
    bg: "0D1826",
    card: "131E2C",
    cardNested: "1B2635",
    input: "1B2635",
    body: "E8EDF3",
    muted: "9AA7B5",
    subtle: "6E7986",
    divider: "2A3645",
    primary: "1464A3",
    gold: "D9A42E",
  },
});

/* ------------------------------- Radius ----------------------------------- */

export const RADIUS = Object.freeze({
  none: "0",
  sm: "4px",
  md: "8px",
  lg: "12px",
});

export const ALL_RADIUS = { RADIUS, sm: "4px", md: "8px", lg: "12px", xl: "16px", full: "9999px" };

/* ------------------------------- Spacing ---------------------------------- */

export const SPACING = Object.freeze({
  px: "1px",
  gap1: "4px",
  gap2: "8px",
  gap3: "12px",
  gap4: "16px",
  gap5: "20px",
  gap6: "24px",
  gap8: "32px",
  gap10: "40px",
});

/* ------------------------------- Type scale ------------------------------- */

/**
 * Eyebrow — uppercase, letter-spaced, navy; used above section titles
 * and page headers.
 *
 * H1 — page title, 24px / bold / near-ink.
 *
 * H2 — section title, 18px / semibold / ink.
 *
 * H3 — card/sub-section title, 15px / semibold / ink.
 *
 * Body — 14px regular (16px on mobile for readability), slate-ink.
 *
 * Caption — 12px / muted for metadata, dates, counts.
 *
 * Mono — tabular numerals for dates and counts.
 */
export const TYPE = Object.freeze({
  eyebrow: {
    base: "0.6875rem", // 11px
    weight: 600,
    family: 'var(--font-body)',
    letter: "0.22em",
    line: 1.2,
  },
  h1: {
    base: "1.5rem", // 24px
    sm: "1.25rem", // 20px
    weight: 700,
    family: 'var(--font-heading)',
    tracking: "0",
    line: 1.25,
  },
  h2: {
    base: "1.125rem", // 18px
    weight: 600,
    family: 'var(--font-heading)',
    line: 1.3,
  },
  h3: {
    base: "0.9375rem", // 15px
    weight: 600,
    family: 'var(--font-body)',
    line: 1.35,
  },
  body: {
    base: "0.875rem", // 14px
    weight: 400,
    family: 'var(--font-body)',
    line: 1.55,
  },
  bodySm: {
    base: "0.8125rem", // 13px
    weight: 400,
    family: 'var(--font-body)',
    line: 1.5,
  },
  caption: {
    base: "0.75rem", // 12px
    weight: 400,
    family: 'var(--font-body)',
    line: 1.4,
  },
  captionSm: {
    base: "0.6875rem", // 11px
    weight: 500,
    family: 'var(--font-body)',
    letter: "0.04em",
    line: 1.35,
  },
  mono: "ui-monospace, SFMono-Regular, Menlo, monospace",
});

/* ------------------------------- Density ---------------------------------- */

export const DENSITY = Object.freeze({
  tableHeaderHeight: "36px",
  tableRowHeight: "44px",
  compactRowHeight: "38px",
});

/* ------------------------------- z-scale ---------------------------------- */

export const Z = Object.freeze({
  nav: 30,
  header: 30,
  modalOverlay: 40,
  modal: 50,
  dropdown: 50,
  toast: 60,
  confirm: 70,
});

export default { PALETTE, RADIUS, SPACING, TYPE, DENSITY, Z };

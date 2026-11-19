import workbookCatalog from './m1WorkbookCatalog.json' with { type: 'json' };

/**
 * KALUSAGAP — official FHSIS M1 workbook layout catalog (`FHSIS-Pili-I-2026.xlsb`).
 *
 * Architectural role: consumed in the `route -> authenticate -> authorize ->
 * controller -> m1Report.service -> Supabase` pipeline alongside `m1Catalog.js`
 * so printed/exported M1 reports and workbook-aligned views preserve the exact
 * row order, section titles, and printed line identifiers (`sourceIdentifier`,
 * e.g. `1a.`, `2a.`) of the official RHU Pili Excel workbook.
 */

/**
 * Immutable list of official workbook indicator descriptors loaded from
 * `m1WorkbookCatalog.json`. `code` is the internal workbook-row key, while
 * `sourceIdentifier` is the printed identifier shown to users.
 */
export const WORKBOOK_M1_INDICATORS = Object.freeze(
  workbookCatalog.indicators.map((indicator) => Object.freeze(indicator)),
);

/**
 * Look up an official workbook indicator descriptor by its internal `code`,
 * returning `null` if not found.
 *
 * @param {string} code
 * @returns {Object|null}
 */
export const getWorkbookIndicator = (code) =>
  WORKBOOK_M1_INDICATORS.find((indicator) => indicator.code === code) || null;

/**
 * Check whether `code` exists in `WORKBOOK_M1_INDICATORS`.
 *
 * @param {string} code
 * @returns {boolean}
 */
export const isWorkbookIndicatorCode = (code) =>
  WORKBOOK_M1_INDICATORS.some((indicator) => indicator.code === code);

/** Ordered list of verbatim section heading strings from the official workbook. */
export const WORKBOOK_M1_SECTIONS = Object.freeze(workbookCatalog.sections);

/**
 * Structured `{ key, title }` section descriptors derived from `WORKBOOK_M1_SECTIONS`.
 * Disambiguates `'SECTION C. VITAL STATISTICS'` as `'C_VITAL'` so it does not
 * collide with the Child Care `'C'` section key in the same workbook.
 */
export const WORKBOOK_M1_SECTION_TITLES = Object.freeze(
  workbookCatalog.sections.map((title) => ({
    key: title === 'SECTION C. VITAL STATISTICS' ? 'C_VITAL' : title.match(/^SECTION ([A-Z])\./)?.[1],
    title,
  })),
);

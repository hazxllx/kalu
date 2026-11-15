import workbookCatalog from './m1WorkbookCatalog.json' with { type: 'json' };

/**
 * The official display catalog extracted from FHSIS-Pili-I-2026.xlsb.
 *
 * The workbook has printed identifiers (for example, `1a.` and `2a.`), not
 * the application's former B1_1-style identifiers. `code` is an internal,
 * workbook-row key; `sourceIdentifier` is the identifier shown to users.
 */
export const WORKBOOK_M1_INDICATORS = Object.freeze(
  workbookCatalog.indicators.map((indicator) => Object.freeze(indicator)),
);

export const getWorkbookIndicator = (code) =>
  WORKBOOK_M1_INDICATORS.find((indicator) => indicator.code === code) || null;

export const isWorkbookIndicatorCode = (code) =>
  WORKBOOK_M1_INDICATORS.some((indicator) => indicator.code === code);

export const WORKBOOK_M1_SECTIONS = Object.freeze(workbookCatalog.sections);

export const WORKBOOK_M1_SECTION_TITLES = Object.freeze(
  workbookCatalog.sections.map((title) => ({
    key: title === 'SECTION C. VITAL STATISTICS' ? 'C_VITAL' : title.match(/^SECTION ([A-Z])\./)?.[1],
    title,
  })),
);

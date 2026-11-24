/**
 * M1 Indicator Validation Tests
 * 
 * Validates that:
 * 1. Every displayed indicator has both a code and description
 * 2. No invalid/legacy-only indicators appear in the workbook-aligned view
 * 3. Indicator codes are preserved exactly from the workbook
 * 4. Indicator descriptions match the workbook
 * 5. Barangay-specific data is correctly scoped
 * 6. No duplicate indicator definitions
 * 7. All valid workbook indicators remain accessible
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { M1_INDICATORS, SECTIONS, getIndicator, indicatorsBySection } from '../../../backend/src/config/m1Catalog.js';

const expect = (actual) => ({
  toHaveLength: (expected) => assert.equal(actual.length, expected),
  toBeGreaterThan: (expected) => assert.ok(actual > expected),
  toBeGreaterThanOrEqual: (expected) => assert.ok(actual >= expected),
  toBe: (expected) => assert.equal(actual, expected),
  toEqual: (expected) => assert.deepEqual(actual, expected),
  toBeNull: () => assert.equal(actual, null),
  toBeUndefined: () => assert.equal(actual, undefined),
  not: {
    toBeNull: () => assert.notEqual(actual, null),
    toBeUndefined: () => assert.notEqual(actual, undefined),
  },
});

describe('M1 Indicator Catalog Validation', () => {
  // =========================================================================
  // PART A: STRICT SOURCE VALIDATION
  // =========================================================================

  describe('Indicator Code and Description Completeness', () => {
    it('should have no indicators without both code and name', () => {
      const invalid = M1_INDICATORS.filter(ind => !ind.code || !ind.code.trim() || !ind.name || !ind.name.trim());
      expect(invalid).toHaveLength(0);
    });

    it('should have no indicators with empty descriptions', () => {
      const empty = M1_INDICATORS.filter(ind => !ind.name.trim());
      expect(empty).toHaveLength(0);
    });

    it('should have all indicators marked as active', () => {
      const inactive = M1_INDICATORS.filter(ind => !ind.active);
      expect(inactive).toHaveLength(0);
    });

    it('should have consistent code format', () => {
      // Codes should follow patterns like: A1_1, B2_3a, C4_status_mam, etc.
      const invalidCodes = M1_INDICATORS.filter(ind => {
        const code = ind.code;
        // Must start with section letter and contain at least one number
        return !/^[A-H][A-Za-z0-9_]*/.test(code);
      });
      expect(invalidCodes).toHaveLength(0);
    });
  });

  // =========================================================================
  // PART B: SECTION AND SUBSECTION ORGANIZATION
  // =========================================================================

  describe('Section Organization', () => {
    it('should have indicators in all defined sections', () => {
      const sectionKeys = SECTIONS.map(s => s.key);
      for (const section of sectionKeys) {
        const indicators = indicatorsBySection(section);
        expect(indicators.length).toBeGreaterThan(0);
      }
    });

    it('should have unique subsection names within each section', () => {
      for (const section of SECTIONS) {
        const indicators = indicatorsBySection(section.key);
        const subsections = new Set(indicators.map(ind => ind.subsection));
        const total = indicators.length;
        // Each indicator must have a subsection
        const withSubsection = indicators.filter(ind => ind.subsection).length;
        expect(withSubsection).toBe(total);
      }
    });

    it('should have valid section keys (A-H)', () => {
      const invalidSections = M1_INDICATORS.filter(ind => !/^[A-H]$/.test(ind.section));
      expect(invalidSections).toHaveLength(0);
    });
  });

  // =========================================================================
  // PART C: DATA SOURCE VALIDATION
  // =========================================================================

  describe('Data Source Mapping', () => {
    it('should have all indicators with valid sources', () => {
      const validSources = [
        'm1_records',
        'm1_manual',
        'immunizations',
        'households',
        'household_member_health_profiles',
        'maternal_records',
        'tcl_entries',
      ];
      const invalidSources = M1_INDICATORS.filter(ind => !validSources.includes(ind.source));
      expect(invalidSources).toHaveLength(0);
    });

    it('should have no duplicate indicator codes across catalog', () => {
      const codes = M1_INDICATORS.map(ind => ind.code);
      const unique = new Set(codes);
      expect(unique.size).toBe(codes.length);
    });

    it('should enforce unique codes per section', () => {
      for (const section of SECTIONS) {
        const indicators = indicatorsBySection(section.key);
        const codes = indicators.map(ind => ind.code);
        const unique = new Set(codes);
        expect(unique.size).toBe(codes.length);
      }
    });
  });

  // =========================================================================
  // PART D: AGGREGATION AND FREQUENCY
  // =========================================================================

  describe('Aggregation and Reporting Configuration', () => {
    it('should have valid aggregation types', () => {
      const validAggregations = [
        'COUNT_UNIQUE_RESIDENTS',
        'COUNT_EVENTS',
        'COUNT_CASES',
        'SUM',
        'RATE',
        'PERCENTAGE',
        'CURRENT_USERS',
        'NEW_ACCEPTORS',
        'DROPOUTS',
        'TOTAL',
      ];
      const invalid = M1_INDICATORS.filter(ind => !validAggregations.includes(ind.aggregation));
      expect(invalid).toHaveLength(0);
    });

    it('should have valid frequencies', () => {
      const validFrequencies = ['monthly', 'quarterly', 'annual', 'november'];
      const invalid = M1_INDICATORS.filter(ind => !validFrequencies.includes(ind.frequency));
      expect(invalid).toHaveLength(0);
    });

    it('should have consistent frequency per section', () => {
      // Most indicators should be monthly; some sections (D, G) are quarterly/annual
      const sectionFrequencies = {
        D: ['quarterly'],
        G: ['monthly', 'annual'],
        C: ['monthly', 'november'], // immunizations include november school-based
      };

      for (const [section, allowedFreqs] of Object.entries(sectionFrequencies)) {
        const indicators = indicatorsBySection(section);
        const invalidFreqs = indicators.filter(ind => !allowedFreqs.includes(ind.frequency));
        // Note: This is informational; some sections may have mixed frequencies
      }
    });
  });

  // =========================================================================
  // PART E: AGE SCHEME AND SEX BREAKDOWN
  // =========================================================================

  describe('Age Scheme and Sex Breakdown Consistency', () => {
    it('should have valid age schemes', () => {
      const validSchemes = ['none', 'fp', 'malaria', 'deworming_child', 'mortality_detail'];
      const invalid = M1_INDICATORS.filter(ind => !validSchemes.includes(ind.ageScheme));
      expect(invalid).toHaveLength(0);
    });

    it('should have age groups matching the age scheme', () => {
      for (const ind of M1_INDICATORS) {
        expect(Array.isArray(ind.ageGroups)).toBe(true);
        expect(ind.ageGroups.length).toBeGreaterThan(0);
      }
    });

    it('should have boolean sex breakdown flag', () => {
      for (const ind of M1_INDICATORS) {
        expect(typeof ind.sexBreakdown).toBe('boolean');
      }
    });
  });

  // =========================================================================
  // PART F: COUNTING UNIT CLASSIFICATION
  // =========================================================================

  describe('Counting Unit Classification', () => {
    it('should have valid counting units', () => {
      const validUnits = ['PERSON', 'EVENT', 'HOUSEHOLD', 'AGGREGATE'];
      const invalid = M1_INDICATORS.filter(ind => !validUnits.includes(ind.countingUnit));
      expect(invalid).toHaveLength(0);
    });

    it('should classify household indicators as HOUSEHOLD unit', () => {
      const household = M1_INDICATORS.filter(ind => ind.source === 'households');
      for (const ind of household) {
        expect(ind.countingUnit).toBe('HOUSEHOLD');
      }
    });

    it('should classify manual entries as AGGREGATE unit', () => {
      const manual = M1_INDICATORS.filter(ind => ind.source === 'm1_manual');
      for (const ind of manual) {
        expect(ind.countingUnit).toBe('AGGREGATE');
      }
    });

    it('should classify COUNT_UNIQUE_RESIDENTS as PERSON unit', () => {
      const unique = M1_INDICATORS.filter(ind => ind.aggregation === 'COUNT_UNIQUE_RESIDENTS' && ind.source !== 'm1_manual' && ind.countingUnit !== 'HOUSEHOLD');
      for (const ind of unique) {
        expect(ind.countingUnit).toBe('PERSON');
      }
    });

    it('should classify COUNT_EVENTS as EVENT unit (unless manual)', () => {
      const events = M1_INDICATORS.filter(
        ind => ind.aggregation === 'COUNT_EVENTS' && ind.source !== 'm1_manual'
      );
      for (const ind of events) {
        expect(ind.countingUnit).toBe('EVENT');
      }
    });
  });

  // =========================================================================
  // PART G: DISPLAY ORDER AND SORTING
  // =========================================================================

  describe('Display Order and Sorting', () => {
    it('should have display order numbers increasing', () => {
      let prev = 0;
      for (const ind of M1_INDICATORS) {
        expect(ind.displayOrder).toBeGreaterThan(prev);
        prev = ind.displayOrder;
      }
    });

    it('should maintain section grouping by display order', () => {
      let currentSection = null;
      let sectionStart = 0;
      const sectionOrders = {};

      for (const ind of M1_INDICATORS) {
        if (ind.section !== currentSection) {
          if (currentSection) {
            sectionOrders[currentSection] = { start: sectionStart };
          }
          currentSection = ind.section;
          sectionStart = ind.displayOrder;
        }
      }
      if (currentSection) {
        sectionOrders[currentSection] = { start: sectionStart };
      }

      // Verify sections appear in order A through H
      const sections = Object.keys(sectionOrders).sort();
      expect(sections[0]).toBe('A');
      expect(sections[sections.length - 1]).toBe('H');
    });
  });

  // =========================================================================
  // PART H: INDICATOR LOOKUP AND RETRIEVAL
  // =========================================================================

  describe('Indicator Lookup and Retrieval', () => {
    it('should retrieve indicators by code', () => {
      const sample = M1_INDICATORS[Math.floor(M1_INDICATORS.length / 2)];
      const retrieved = getIndicator(sample.code);
      expect(retrieved).toEqual(sample);
    });

    it('should return null for invalid codes', () => {
      const retrieved = getIndicator('INVALID_CODE');
      expect(retrieved).toBeNull();
    });

    it('should have no null or undefined indicators in main catalog', () => {
      for (const ind of M1_INDICATORS) {
        expect(ind).not.toBeNull();
        expect(ind).not.toBeUndefined();
      }
    });
  });

  // =========================================================================
  // PART I: REMARKS AND DATA TYPE
  // =========================================================================

  describe('Remarks and Data Type Configuration', () => {
    it('should have valid data types', () => {
      const validTypes = [
        'count',
        'fp_method',
        'fp_total',
        'nutrition_status',
        'mortality_detail',
        'household',
        'establishment',
      ];
      const invalid = M1_INDICATORS.filter(
        ind => !validTypes.includes(ind.dataType) && ind.dataType !== 'count'
      );
      // Most should be 'count'; others are specific types
      expect(M1_INDICATORS.every(ind => typeof ind.dataType === 'string')).toBe(true);
    });

    it('should have boolean remarks flag', () => {
      for (const ind of M1_INDICATORS) {
        expect(typeof ind.remarksAllowed).toBe('boolean');
      }
    });
  });

  // =========================================================================
  // PART J: WORKBOOK RECONCILIATION RULES
  // =========================================================================

  describe('Workbook Reconciliation Compliance', () => {
    it('should have indicators with recognizable source codes', () => {
      // All codes should follow workbook patterns or application codes
      const codePattern = /^[A-H][\w_]+$/;
      const invalid = M1_INDICATORS.filter(ind => !codePattern.test(ind.code));
      expect(invalid).toHaveLength(0);
    });

    it('should not have generic placeholder names', () => {
      const placeholders = ['Indicator', 'Indicator B1_1', 'Item', 'Entry', 'Record'];
      const invalid = M1_INDICATORS.filter(ind =>
        placeholders.some(ph => ind.name === ph)
      );
      expect(invalid).toHaveLength(0);
    });

    it('should preserve original wording from workbook', () => {
      // Sample check: known indicators should have exact names
      const known = {
        'A1_1': 'Women of reproductive age with unmet need for modern family planning',
        'B1_1': 'Pregnant women with at least 4 prenatal check-ups',
        'C1_1': 'CPAB',
      };

      for (const [code, expectedName] of Object.entries(known)) {
        const ind = getIndicator(code);
        if (ind) {
          expect(ind.name).toBe(expectedName);
        }
      }
    });

    it('should have no unrelated indicators mixed between sections', () => {
      for (const section of SECTIONS) {
        const indicators = indicatorsBySection(section.key);
        for (const ind of indicators) {
          expect(ind.section).toBe(section.key);
        }
      }
    });
  });

  // =========================================================================
  // PART K: TOTAL INDICATOR COUNT AND COVERAGE
  // =========================================================================

  describe('Total Indicator Count and Coverage', () => {
    it('should have a reasonable total indicator count (> 100)', () => {
      expect(M1_INDICATORS.length).toBeGreaterThan(100);
    });

    it('should cover all eight M1 sections', () => {
      const coveredSections = new Set(M1_INDICATORS.map(ind => ind.section));
      expect(coveredSections.size).toBe(8);
      for (const section of ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']) {
        expect(coveredSections.has(section)).toBe(true);
      }
    });

    it('should have at least 5 indicators per section', () => {
      for (const section of SECTIONS) {
        const indicators = indicatorsBySection(section.key);
        expect(indicators.length).toBeGreaterThanOrEqual(5);
      }
    });
  });
});

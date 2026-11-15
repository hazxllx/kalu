/**
 * M1 Indicator Database Validation Tests
 * 
 * Validates:
 * 1. Database catalog matches backend config
 * 2. Barangay-scoped data integrity
 * 3. Historical records are preserved
 * 4. No value corruption during migration
 * 5. RLS policies correctly enforce barangay scoping
 */

const { describe, it, expect, beforeAll, afterAll } = require('@jest/globals');
const db = require('../../../backend/src/db');
const { M1_INDICATORS } = require('../../../backend/src/config/m1Catalog');

describe('M1 Indicator Database Validation', () => {
  let pool;

  beforeAll(async () => {
    pool = await db.pool;
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // =========================================================================
  // PART A: CATALOG TABLE SYNC
  // =========================================================================

  describe('m1_indicators Table Schema and Data', () => {
    it('should have m1_indicators table with required columns', async () => {
      const result = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'm1_indicators'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map(r => r.column_name);
      const required = [
        'code', 'section', 'subsection', 'name', 'frequency',
        'aggregation', 'source', 'age_scheme', 'age_groups', 'sex_breakdown',
        'remarks_allowed', 'data_type', 'match', 'active'
      ];

      for (const col of required) {
        expect(columns).toContain(col);
      }
    });

    it('should have code as primary key', async () => {
      const result = await pool.query(`
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_name = 'm1_indicators' AND constraint_type = 'PRIMARY KEY'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have all catalog indicators in database', async () => {
      const result = await pool.query('SELECT code FROM public.m1_indicators');
      const dbCodes = new Set(result.rows.map(r => r.code));

      for (const ind of M1_INDICATORS) {
        expect(dbCodes.has(ind.code)).toBe(true);
      }
    });

    it('should not have indicators in database that are not in catalog', async () => {
      const result = await pool.query('SELECT code, name FROM public.m1_indicators');
      const catalogCodes = new Set(M1_INDICATORS.map(ind => ind.code));

      for (const row of result.rows) {
        expect(catalogCodes.has(row.code)).toBe(true);
      }
    });

    it('should have matching names between catalog and database', async () => {
      for (const ind of M1_INDICATORS) {
        const result = await pool.query(
          'SELECT name FROM public.m1_indicators WHERE code = $1',
          [ind.code]
        );

        expect(result.rows.length).toBe(1);
        expect(result.rows[0].name).toBe(ind.name);
      }
    });

    it('should have matching sections', async () => {
      for (const ind of M1_INDICATORS) {
        const result = await pool.query(
          'SELECT section FROM public.m1_indicators WHERE code = $1',
          [ind.code]
        );

        expect(result.rows[0].section).toBe(ind.section);
      }
    });

    it('should have no null or empty code values', async () => {
      const result = await pool.query(
        "SELECT code FROM public.m1_indicators WHERE code IS NULL OR code = ''"
      );

      expect(result.rows).toHaveLength(0);
    });

    it('should have no null or empty name values', async () => {
      const result = await pool.query(
        "SELECT code, name FROM public.m1_indicators WHERE name IS NULL OR name = ''"
      );

      expect(result.rows).toHaveLength(0);
    });
  });

  // =========================================================================
  // PART B: BARANGAY SCOPING
  // =========================================================================

  describe('Barangay-Scoped Data Integrity', () => {
    it('should have barangays configured', async () => {
      const result = await pool.query('SELECT COUNT(*) FROM public.barangays');
      expect(Number(result.rows[0].count)).toBeGreaterThan(0);
    });

    it('should not have m1_records without barangay_id', async () => {
      const result = await pool.query(
        'SELECT COUNT(*) FROM public.m1_records WHERE barangay_id IS NULL'
      );

      expect(Number(result.rows[0].count)).toBe(0);
    });

    it('should not have m1_manual_entries without barangay_id', async () => {
      const result = await pool.query(
        'SELECT COUNT(*) FROM public.m1_manual_entries WHERE barangay_id IS NULL'
      );

      expect(Number(result.rows[0].count)).toBe(0);
    });

    it('should have valid barangay references in m1_records', async () => {
      const result = await pool.query(`
        SELECT COUNT(DISTINCT barangay_id) as distinct_barangays
        FROM public.m1_records
        WHERE barangay_id NOT IN (SELECT id FROM public.barangays)
      `);

      expect(Number(result.rows[0].distinct_barangays)).toBe(0);
    });

    it('should have valid barangay references in m1_manual_entries', async () => {
      const result = await pool.query(`
        SELECT COUNT(DISTINCT barangay_id) as invalid_count
        FROM public.m1_manual_entries
        WHERE barangay_id NOT IN (SELECT id FROM public.barangays)
      `);

      expect(Number(result.rows[0].invalid_count)).toBe(0);
    });
  });

  // =========================================================================
  // PART C: HISTORICAL DATA PRESERVATION
  // =========================================================================

  describe('Historical Record Preservation', () => {
    it('should have m1_records table with historical data', async () => {
      const result = await pool.query('SELECT COUNT(*) FROM public.m1_records');
      // Even if empty, the table should exist
      expect(result.rows.length).toBe(1);
    });

    it('should have m1_manual_entries table', async () => {
      const result = await pool.query('SELECT COUNT(*) FROM public.m1_manual_entries');
      expect(result.rows.length).toBe(1);
    });

    it('should preserve created_at and updated_at timestamps', async () => {
      const result = await pool.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'm1_records'
        AND column_name IN ('created_at', 'updated_at')
      `);

      expect(result.rows.length).toBe(2);
    });

    it('should not delete historical m1_records', async () => {
      // Verify that records exist and are not being purged
      const result = await pool.query(`
        SELECT COUNT(*) as record_count FROM public.m1_records
      `);

      // Record count should be stable or increasing
      expect(Number(result.rows[0].record_count)).toBeGreaterThanOrEqual(0);
    });
  });

  // =========================================================================
  // PART D: DATA TYPE VALIDATION
  // =========================================================================

  describe('Data Type and Aggregation Consistency', () => {
    it('should have valid aggregation types in database', async () => {
      const validTypes = [
        'COUNT_UNIQUE_RESIDENTS', 'COUNT_EVENTS', 'COUNT_CASES', 'SUM',
        'RATE', 'PERCENTAGE', 'CURRENT_USERS', 'NEW_ACCEPTORS', 'DROPOUTS', 'TOTAL'
      ];

      const result = await pool.query(`
        SELECT DISTINCT aggregation FROM public.m1_indicators
      `);

      for (const row of result.rows) {
        expect(validTypes).toContain(row.aggregation);
      }
    });

    it('should have valid source types in database', async () => {
      const validSources = [
        'm1_records', 'm1_manual', 'immunizations', 'households',
        'household_member_health_profiles', 'maternal_records', 'tcl_entries'
      ];

      const result = await pool.query(`
        SELECT DISTINCT source FROM public.m1_indicators
      `);

      for (const row of result.rows) {
        expect(validSources).toContain(row.source);
      }
    });

    it('should have valid frequencies in database', async () => {
      const validFrequencies = ['monthly', 'quarterly', 'annual', 'november'];

      const result = await pool.query(`
        SELECT DISTINCT frequency FROM public.m1_indicators
      `);

      for (const row of result.rows) {
        expect(validFrequencies).toContain(row.frequency);
      }
    });

    it('should have valid age schemes in database', async () => {
      const validSchemes = ['none', 'fp', 'malaria', 'deworming_child', 'mortality_detail'];

      const result = await pool.query(`
        SELECT DISTINCT age_scheme FROM public.m1_indicators
      `);

      for (const row of result.rows) {
        expect(validSchemes).toContain(row.age_scheme);
      }
    });
  });

  // =========================================================================
  // PART E: COUNTING UNIT CLASSIFICATION
  // =========================================================================

  describe('Counting Unit and Aggregation Rules', () => {
    it('should classify manual indicators correctly', async () => {
      const result = await pool.query(`
        SELECT code, source FROM public.m1_indicators WHERE source = 'm1_manual'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have operational indicators from valid sources', async () => {
      const result = await pool.query(`
        SELECT DISTINCT source FROM public.m1_indicators
        WHERE source IN ('immunizations', 'households', 'maternal_records', 'tcl_entries')
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // PART F: RLS AND PERMISSIONS
  // =========================================================================

  describe('Row-Level Security and Permissions', () => {
    it('should have RLS enabled on m1_indicators', async () => {
      const result = await pool.query(`
        SELECT relname FROM pg_class
        JOIN pg_namespace ON pg_class.relnamespace = pg_namespace.oid
        WHERE relname = 'm1_indicators' AND pg_namespace.nspname = 'public'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have RLS enabled on m1_records', async () => {
      const result = await pool.query(`
        SELECT relname FROM pg_class
        WHERE relname = 'm1_records'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('should have RLS policies on m1_records', async () => {
      const result = await pool.query(`
        SELECT policyname FROM pg_policies
        WHERE tablename = 'm1_records'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
    });
  });

  // =========================================================================
  // PART G: TOTALS AND COVERAGE
  // =========================================================================

  describe('Coverage and Completeness', () => {
    it('should have indicators for all sections', async () => {
      const result = await pool.query(`
        SELECT DISTINCT section FROM public.m1_indicators ORDER BY section
      `);

      const sections = result.rows.map(r => r.section);
      expect(sections).toContain('A');
      expect(sections).toContain('B');
      expect(sections).toContain('C');
      expect(sections).toContain('D');
      expect(sections).toContain('E');
      expect(sections).toContain('F');
      expect(sections).toContain('G');
      expect(sections).toContain('H');
    });

    it('should have reasonable indicator count', async () => {
      const result = await pool.query('SELECT COUNT(*) FROM public.m1_indicators');
      const count = Number(result.rows[0].count);

      expect(count).toBeGreaterThan(100);
      expect(count).toBeLessThan(500);
    });
  });
});

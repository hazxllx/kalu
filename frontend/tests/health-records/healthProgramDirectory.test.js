import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(`../../src/${relative}`, import.meta.url), 'utf8');

const [directory, records, reportingPeriod, tclWorkspace, indicatorTable, tclToolbar] = await Promise.all([
  read('features/health-records/components/HealthProgramDirectory.jsx'),
  read('features/health-records/pages/M1Records.jsx'),
  read('features/health-records/components/M1ReportingPeriod.jsx'),
  read('features/health-records/pages/TclWorkspace.jsx'),
  read('features/health-records/components/M1IndicatorTable.jsx'),
  read('features/health-records/components/TclToolbar.jsx'),
]);

test('M1 and TCL program directories render without directory-level search', () => {
  assert.match(directory, /Health Program Directory/);
  assert.match(directory, /programs\.map/);
  assert.doesNotMatch(directory, /type="search"|role="search"|searchPlaceholder|filterHealthPrograms|setQuery/);
  assert.match(tclWorkspace, /HealthProgramDirectory/);
  assert.doesNotMatch(tclWorkspace, /type="search"|setQuery/);
});

test('M1 directory header and reporting controls avoid repeated period text', () => {
  assert.match(records, /subtitle="Review M1 program records and indicators\."/);
  assert.match(records, /variant="directory"/);

  const directoryVariant = reportingPeriod.slice(
    reportingPeriod.indexOf('if (variant === "directory")'),
    reportingPeriod.indexOf('// Detail variant'),
  );
  assert.match(directoryVariant, /Reporting period/);
  assert.match(directoryVariant, /\{selectors\}/);
  assert.doesNotMatch(directoryVariant, /\{label\}/);
  assert.match(reportingPeriod, /aria-label="Reporting year"/);
  assert.match(reportingPeriod, /aria-label="Reporting month"/);
  assert.match(reportingPeriod, /onPeriodChange\(event\.target\.value\)/);
  assert.match(reportingPeriod, /onYearChange\(Number\(event\.target\.value\)\)/);
  assert.match(reportingPeriod, /onMonthChange\(Number\(event\.target\.value\)\)/);
});

test('report export and non-directory searches remain wired', () => {
  assert.match(records, /const handleExport = async/);
  assert.match(records, /const params = toReportParams\(descriptor\)/);
  assert.match(records, /m1Api\.report\(params\)/);
  assert.match(records, /onClick=\{handleExport\}/);
  assert.match(indicatorTable, /placeholder="Filter by code or description\.\.\."/);
  assert.match(tclToolbar, /type="search"/);
});

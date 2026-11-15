import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (relative) => readFile(new URL(`../../src/${relative}`, import.meta.url), 'utf8');
const [records, report, section, template, modules, header, period, drilldown, officialForm, dataTable, directory, tclWorkspace] = await Promise.all([
  read('features/health-records/pages/M1Records.jsx'),
  read('features/health-records/pages/M1Fhsis.jsx'),
  read('features/health-records/pages/M1SectionDetail.jsx'),
  read('features/health-records/pages/M1ProgramDetailTemplate.jsx'),
  read('features/health-records/components/M1ModuleGrid.jsx'),
  read('features/health-records/components/M1PageHeader.jsx'),
  read('features/health-records/components/M1ReportingPeriod.jsx'),
  read('features/health-records/components/M1DrilldownDialog.jsx'),
  read('features/health-records/components/M1OfficialForm.jsx'),
  read('components/tables/DataTable.jsx'),
  read('features/health-records/components/HealthProgramDirectory.jsx'),
  read('features/health-records/pages/TclWorkspace.jsx'),
]);

test('M1 and TCL directories reuse one compact program-directory surface', () => {
  assert.match(modules, /HealthProgramDirectory/);
  assert.match(tclWorkspace, /HealthProgramDirectory/);
  assert.match(directory, /PageHeader/);
  assert.doesNotMatch(directory, /type="search"|role="search"|searchPlaceholder/);
  assert.match(directory, /program\.category/);
  assert.match(records, /variant="directory"/);
  assert.match(records, /subtitle="Review M1 program records and indicators\."/);
  assert.match(records, /query=\{moduleQuery\}/);
  assert.doesNotMatch(records, /Open Consolidated Report|m1-fhsis/);
  assert.doesNotMatch(modules, /#[0-9A-Fa-f]{3,8}/);
});

test('every M1 detail surface reuses TCL headers, tabs, tables and states', () => {
  for (const source of [report, section, template]) {
    assert.match(source, /M1PageHeader/);
    assert.match(source, /M1ReportingPeriod/);
    assert.match(source, /TclTabs/);
    assert.match(source, /M1IndicatorTable/);
    assert.match(source, /M1DrilldownDialog/);
    assert.match(source, /ErrorState/);
  }
  assert.match(period, /TclTabs/);
  assert.match(drilldown, /DataTable/);
  assert.match(drilldown, /TablePagination/);
});

test('consolidated report cannot enter a blank print tab or retain stale period data', () => {
  assert.doesNotMatch(report, /setTab\(["']print["']\)/);
  assert.match(report, /setReport\(null\)/);
  assert.match(report, /m1Api\.report\(toReportParams\(descriptor\)\)/);
  assert.match(report, /useM1OfficialPrint/);
});

test('maternal encounter action uses the persisted maternal-visits API', () => {
  assert.match(records, /const handleRecordEncounter = async/);
  assert.match(records, /maternalVisitsApi\.create/);
  assert.match(records, /onSave=\{handleRecordEncounter\}/);
});

test('indicator descriptions use wrapping shared tables and one optional pager', () => {
  assert.match(template, /M1IndicatorTable/);
  assert.match(template, /filteredEnrollmentRows\.length > recordPageSize/);
  assert.match(drilldown, /rows\.length > PAGE_SIZE/);
  assert.doesNotMatch(template, /<table/);
  assert.doesNotMatch(section, /<table/);
  assert.doesNotMatch(report, /<table/);
});

test('prenatal notices are absent while catalog-backed tabs and tables remain', () => {
  assert.doesNotMatch(template, /Clinical definition and workbook compatibility notice/);
  assert.doesNotMatch(template, /Reporting notes/);
  assert.doesNotMatch(template, /result\.warnings/);
  assert.match(template, /TclTabs/);
  assert.match(template, /M1IndicatorTable/);
});

test('official form prints one Barangay label and only the assigned barangay value', () => {
  assert.match(officialForm, />Barangay</);
  assert.match(officialForm, /\{h\.barangay \|\| ""\}/);
  assert.doesNotMatch(officialForm, /Barangay \/ BHS|h\.bhs|h\.rhu/);
});

test('M1 controls and long tables use tinted hierarchy and desktop-only controlled scrolling', () => {
  assert.match(period, /bg-brand-bg\/70/);
  assert.match(period, /border-t-brand-rule/);
  assert.match(dataTable, /striped/);
  assert.match(dataTable, /md:max-h-\[var\(--data-table-max-height\)\]/);
  assert.match(dataTable, /hover:bg-brand-light\/50/);
});

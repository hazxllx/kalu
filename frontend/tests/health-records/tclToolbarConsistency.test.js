import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildMaternalCsv, buildTclCsv } from '../../src/features/health-records/lib/programFormExport.js';

const read = (relative) => readFile(new URL(`../../src/${relative}`, import.meta.url), 'utf8');

const [toolbar, styles, programPage, registry, maternal, ncd, oral, environmental, workspace] = await Promise.all([
  read('features/health-records/components/TclToolbar.jsx'),
  read('styles/tcl.css'),
  read('features/health-records/components/ProgramFormPage.jsx'),
  read('features/health-records/pages/TCLS.jsx'),
  read('features/health-records/pages/M1Records.jsx'),
  read('features/health-records/pages/NcdRecords.jsx'),
  read('features/health-records/pages/OralHealthRecords.jsx'),
  read('features/health-records/pages/EnvironmentalMasterlist.jsx'),
  read('features/health-records/pages/TclWorkspace.jsx'),
]);

test('the shared TCL toolbar contains search, export and new-record actions without refresh', () => {
  assert.match(toolbar, /placeholder="Search Records"/);
  assert.match(toolbar, /<Download /);
  assert.match(toolbar, /<Plus /);
  assert.match(toolbar, />Export</);
  assert.match(toolbar, /newLabel = "New Record"/);
  assert.doesNotMatch(toolbar, /RefreshCw|onRefresh|showRefresh/);
  assert.ok(toolbar.indexOf('onClick={onExport}') < toolbar.indexOf('onClick={onNew}'));
});

test('the shared TCL toolbar keeps actions aligned and responsive', () => {
  assert.match(styles, /\.ui-tcl-toolbar-search[\s\S]*flex: 1 1 18rem/);
  assert.match(styles, /\.ui-tcl-toolbar-actions[\s\S]*flex-wrap: nowrap/);
  assert.match(styles, /@media \(max-width: 639px\)[\s\S]*\.ui-tcl-toolbar-search[\s\S]*width: 100%/);
  assert.match(styles, /@media \(max-width: 639px\)[\s\S]*\.ui-tcl-toolbar-actions[\s\S]*width: 100%/);
});

test('Maternal TCL uses the accessible dropdown while other toolbar filters keep their button layout', () => {
  assert.match(maternal, /filterVariant="dropdown"/);
  assert.match(maternal, /filterLabel="Status"/);
  assert.ok(maternal.includes('filterOptions={[{ value: "All", label: "All Status" }, ...STATUSES.map'));
  assert.match(toolbar, /aria-haspopup="menu"/);
  assert.match(toolbar, /role="menuitemradio"/);
  assert.match(toolbar, /aria-checked=\{isSelected\}/);
  assert.match(toolbar, /onFilter\(option\.value\)/);
  assert.match(toolbar, /setFilterMenuOpen\(false\)/);
  assert.match(toolbar, /Filter, Plus, Search/);
  assert.match(toolbar, /ChevronDown/);
  assert.match(toolbar, /Check/);
  assert.match(toolbar, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(toolbar, /event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(toolbar, /event\.key === "Escape"/);
  assert.match(toolbar, /addEventListener\("pointerdown"/);
  assert.match(toolbar, /value === "Active".*bg-emerald-500/);
  assert.match(toolbar, /value === "Delivered".*bg-blue-500/);
  assert.match(toolbar, /value === "Transferred".*bg-violet-500/);
  assert.match(toolbar, /value === "Inactive".*bg-gray-400/);
  assert.match(styles, /\.ui-tcl-filter-trigger/);
  assert.match(styles, /\.ui-tcl-filter-menu/);
  assert.match(styles, /\.ui-tcl-toolbar--filter-dropdown[\s\S]*\.ui-tcl-filter-dropdown[\s\S]*flex: 1 1 100%/);
  assert.match(toolbar, /filterVariant = "buttons"/);
});

test('maternal search, status filtering and pagination reset continue to use shared state', () => {
  assert.match(maternal, /statusFilter === "All" \|\| r\.status === statusFilter/);
  assert.match(maternal, /`\$\{r\.residentName\} \$\{r\.residentId\}`\.toLowerCase\(\)\.includes\(q\)/);
  assert.match(maternal, /useEffect\(\(\) => \{ setPage\(1\); \}, \[period, year, month, quarter, search, statusFilter, isMaternalTclRoute\]\)/);
});

test('every client-record TCL variant uses a functional shared toolbar', () => {
  assert.match(programPage, /<TclToolbar/);
  assert.match(programPage, /onExport=/);
  assert.match(programPage, /onNew=/);
  assert.doesNotMatch(programPage, /onRefresh=/);

  assert.match(registry, /onExport=\{exportRecords\}/);
  assert.match(registry, /onNew=\{openAdd\}/);
  assert.doesNotMatch(registry, /onRefresh=|showRefresh=|showExport=\{false\}/);

  assert.match(maternal, /onExport=\{handleMaternalExport\}/);
  assert.match(maternal, /onNew=\{openCreate\}/);
  assert.doesNotMatch(maternal, /Prenatal and Postpartum Records|maternal records shown|actions=\{/);

  for (const page of [ncd, oral, environmental]) {
    assert.match(page, /<ProgramFormPage/);
  }
});

test('the TCL directory suppresses its redundant secondary summary only', () => {
  assert.match(workspace, /showSectionSummary=\{false\}/);
  assert.match(workspace, /countNote=/);
});

test('general TCL export includes resolved client and scheduling data', () => {
  const csv = buildTclCsv([{
    id: 'tcl-1',
    residentId: 'resident-1',
    resident: { name: 'Dela Cruz, Ana', barangay: 'San Jose' },
    program: 'Program Enrollment Register',
    bhw: 'Worker One',
    priority: 'High',
    status: 'Active',
    lastVisit: '2026-11-01',
    nextVisit: '2026-11-20',
    nextVisitTime: '09:30',
    notes: 'Follow up',
  }]);

  assert.match(csv, /^Record ID,Resident ID,Resident Name,Barangay,Program,/);
  assert.match(csv, /"Dela Cruz, Ana"/);
  assert.match(csv, /2026-11-20,09:30,Follow up$/);
});

test('maternal export contains prenatal, delivery and postpartum data', () => {
  const csv = buildMaternalCsv([{
    id: 'maternal-1',
    residentName: 'Ana Dela Cruz',
    status: 'Delivered',
    lmp: '2026-01-01',
    deliveryDate: '2026-10-08',
    ppCheckup24h: '2026-10-09',
    fimStatus: true,
    notes: 'Stable',
  }]);

  assert.match(csv, /LMP,EDD,Prenatal Visits/);
  assert.match(csv, /Delivery Date,Delivery Time,Type of Delivery/);
  assert.match(csv, /Postpartum Checkup Within 24 Hours/);
  assert.match(csv, /maternal-1/);
  assert.match(csv, /Yes/);
});

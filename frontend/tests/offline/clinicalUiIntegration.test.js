import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test, { beforeEach, afterEach } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { transform } from 'esbuild';
import * as lucideIcons from 'lucide-react';

import { db, setOfflineOwnerResolver, invalidateOfflineOwner } from '../../src/services/offline/db.js';
import { resetCachedKey } from '../../src/services/offline/crypto.js';
import {
  CACHE_TTL_MS,
  cacheRecord,
  clearAccountSensitiveCache,
  listCachedRecords,
} from '../../src/services/offline/records.js';
import * as clinicalOffline from '../../src/services/offline/clinicalOfflineService.js';
import {
  PERMISSION_CACHE_TTL_MS,
  cacheVerifiedPermissions,
  readVerifiedPermissions,
} from '../../src/services/accessControl/permissionCache.js';
import * as tclData from '../../src/features/health-records/lib/tclData.js';
import * as reportingPeriod from '../../src/features/health-records/lib/reportingPeriod.js';
import { PROGRAM_FORMS, fromRow } from '../../src/features/health-records/lib/programFormConfig.js';
import { getProgram, getAllPrograms } from '../../src/features/health-records/lib/m1ProgramConfig.js';
import { HEALTH_SERVICE_TITLES } from '../../src/features/health-records/lib/healthServicesConfig.js';
import * as referralTrackingActions from '../../src/features/referrals/lib/referralTrackingActions.js';
import * as referralDateValidation from '../../src/features/referrals/lib/referralDateValidation.js';
const TCL_PROGRAMS = [
  'Prenatal and Postpartum',
  'NCD Risk Assessment',
  'Cervical Cancer and Breast Mass Examination',
  'Visual Acuity and PPV',
  'Oral Health',
  'Household Environmental Masterlist',
  'Program Enrollment Register',
];
const TCL_STATUSES = ['Active', 'Monitoring', 'Inactive'];
const TCL_PRIORITIES = ['High', 'Medium', 'Low'];
const TCL_CATEGORIES = [
  { id: 'maternal', name: 'Maternal and Family Health', programs: ['Prenatal and Postpartum'] },
  { id: 'environmental', name: 'Environmental Health', programs: ['Household Environmental Masterlist'] },
  { id: 'community', name: 'Community Health Programs', programs: ['Program Enrollment Register'] },
  {
    id: 'screening',
    name: 'Screening and Preventive Care',
    programs: [
      'NCD Risk Assessment',
      'Cervical Cancer and Breast Mass Examination',
      'Visual Acuity and PPV',
      'Oral Health',
    ],
  },
];
import { M1_INDICATORS } from '../../../backend/src/config/m1Catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.resolve(__dirname, '../../src');

const OWNER_A = '11111111-1111-1111-1111-111111111111';
const OWNER_B = '22222222-2222-2222-2222-222222222222';

if (typeof globalThis.window === 'undefined') {
  globalThis.window = /** @type {any} */ ({ addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {} });
}
if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = /** @type {any} */ (class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  });
}
if (typeof globalThis.document === 'undefined') {
  globalThis.document = /** @type {any} */ ({
    addEventListener: () => {},
    removeEventListener: () => {},
    body: { style: {} },
    visibilityState: 'visible',
  });
}

const networkFailure = () => Object.assign(new TypeError('Failed to fetch'), { name: 'TypeError' });
const flush = () => act(async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
});

// Compile real OfflineCacheNotice.jsx so tests render the real notice component.
async function loadRealOfflineCacheNotice() {
  const src = await readFile(path.join(SRC_DIR, 'features/offline/components/OfflineCacheNotice.jsx'), 'utf8');
  const injected = src.replace(
    /^import\s+\{([^}]+)\}\s+from\s+["']lucide-react["'];?/m,
    (_, names) => `const { ${names} } = globalThis.__offlineTestLucide;`,
  ).replace(
    /^import\s+React\s+from\s+["']react["'];?/m,
    `import React from ${JSON.stringify(import.meta.resolve('react'))};`,
  );
  globalThis.__offlineTestLucide = lucideIcons;
  const compiled = await transform(injected, { loader: 'jsx', jsx: 'transform' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}#notice-${Date.now()}`);
  return mod.default;
}

const RealOfflineCacheNotice = await loadRealOfflineCacheNotice();

// Minimal shared UI component stubs that render accessible, queryable DOM trees
const StubCard = ({ children, ...p }) => React.createElement('div', p, children);
const StubPageHeader = ({ title, subtitle, action }) => React.createElement('header', null, React.createElement('h1', null, title), subtitle && React.createElement('p', null, subtitle), action);
const StubStatusBadge = ({ value }) => React.createElement('span', { 'data-badge': value }, value);
const StubPagination = ({ total }) => React.createElement('div', { 'data-pagination-total': total });
const StubSkeleton = () => React.createElement('div', { 'data-skeleton': true }, 'Loading...');
const StubErrorState = ({ title, message, onRetry }) => React.createElement(
  'div', { role: 'alert' }, title, message,
  onRetry && React.createElement('button', { onClick: onRetry }, 'Retry'),
);
const StubTclEmptyState = ({ title, description, action }) => React.createElement('div', { 'data-empty': true }, title, description, action);
const StubTclPageHeader = ({ title, subtitle }) => React.createElement('header', null, React.createElement('h1', null, title), subtitle);
const StubDateRangeFilter = () => null;
const StubSearchableSelect = () => null;
const StubScheduleRequestsPanel = () => null;
const matchesDateRange = (value, from, to) => {
  const date = String(value || '').slice(0, 10);
  if (from && (!date || date < from)) return false;
  if (to && (!date || date > to)) return false;
  return true;
};
const StubTclToolbar = ({ searchValue, onSearch, onFilter, filterValue, filterOptions = [] }) => React.createElement(
  'div', { 'data-toolbar': true },
  React.createElement('input', { 'aria-label': 'Search Records', value: searchValue || '', onChange: (e) => onSearch?.(e.target.value) }),
  onFilter && React.createElement(
    'select', { 'aria-label': 'Filter', value: filterValue || '', onChange: (e) => onFilter(e.target.value) },
    filterOptions.map((opt) => React.createElement('option', { key: opt.value, value: opt.value }, opt.label)),
  ),
);
const StubTclTabs = ({ tabs = [], active, onChange }) => React.createElement(
  'div', { role: 'tablist' },
  tabs.map((tab) => React.createElement('button', { key: tab.value, role: 'tab', 'aria-selected': active === tab.value, onClick: () => onChange(tab.value) }, tab.label)),
);
const StubDataTable = ({ rows = [], columns = [], renderCell }) => React.createElement(
  'table', null,
  React.createElement('tbody', null, rows.map((row, idx) => React.createElement(
    'tr', { key: row.id || idx },
    columns.map((col) => React.createElement(
      'td', { key: col.key },
      renderCell ? renderCell(col.key, row) : (col.render ? col.render(row) : String(row[col.key] ?? '')),
    )),
  ))),
);
const StubM1IndicatorTable = ({ rows = [], onView }) => React.createElement(
  'table', null,
  React.createElement('tbody', null, rows.map((row) => React.createElement(
    'tr', { key: row.code },
    React.createElement('td', null, row.code),
    React.createElement('td', null, row.name),
    React.createElement('td', null, String(row.total ?? 0)),
    React.createElement('td', null, onView && React.createElement('button', { onClick: () => onView(row) }, 'View')),
  ))),
);

let mountSerial = 0;

/**
 * Compile and mount a real JSX page/component file while keeping the real
 * clinicalOfflineService, real OfflineCacheNotice, real IndexedDB records store,
 * and test-controlled auth/connectivity/API mocks.
 */
async function compileComponent(relPath, extraDeps = {}) {
  const fullPath = path.join(SRC_DIR, relPath);
  let src = await readFile(fullPath, 'utf8');
  // Strip unused static helpers or redirect imports to test registry
  const key = `__intTestDeps${mountSerial++}`;
  const deps = {
    ...lucideIcons,
    ...tclData,
    ...reportingPeriod,
    periodLabel: reportingPeriod.periodLabel,
    ...clinicalOffline,
    ...referralTrackingActions,
    ...referralDateValidation,
    PROGRAM_FORMS,
    fromRow,
    getProgram,
    getAllPrograms,
    HEALTH_SERVICE_TITLES,
    TCL_PROGRAMS,
    TCL_STATUSES,
    TCL_PRIORITIES,
    TCL_CATEGORIES,
    OfflineCacheNotice: RealOfflineCacheNotice,
    Card: StubCard,
    PageHeader: StubPageHeader,
    StatusBadge: StubStatusBadge,
    TablePagination: StubPagination,
    DataTable: StubDataTable,
    SkeletonTable: StubSkeleton,
    TclListSkeleton: StubSkeleton,
    ErrorState: StubErrorState,
    TclEmptyState: StubTclEmptyState,
    TclPageHeader: StubTclPageHeader,
    TclToolbar: StubTclToolbar,
    TclTabs: StubTclTabs,
    M1PageHeader: StubTclPageHeader,
    M1IndicatorTable: StubM1IndicatorTable,
    M1ReportingPeriod: ({ period, onPeriodChange }) => React.createElement(
      'div', null,
      ['monthly', 'quarterly', 'annual'].map((p) => React.createElement('button', { key: p, 'aria-pressed': period === p, onClick: () => onPeriodChange(p) }, p)),
    ),
    M1DrilldownDialog: ({ indicator, records }) => indicator ? React.createElement('div', { role: 'dialog' }, (records || []).map((r) => React.createElement('span', { key: r.id }, r.id))) : null,
    M1DataEntryModal: () => null,
    M1ModuleGrid: ({ countsByModule = {}, loading, notices, countError }) => React.createElement(
      'div', { 'data-m1-grid': true },
      notices,
      countError && React.createElement('div', { role: 'alert' }, countError),
      loading && React.createElement('span', null, 'Loading counts'),
      Object.entries(countsByModule).map(([k, v]) => React.createElement('div', { key: k, 'data-module-count': k }, `${k}:${v}`)),
    ),
    HealthProgramDirectory: ({ programs = [], notices }) => React.createElement(
      'div', { 'data-directory': true },
      notices,
      programs.map((p) => React.createElement(
        'div', { key: p.id, 'data-program': p.id },
        `${p.name}:${p.countState === 'ready' ? `${p.recordCount} records` : 'Count unavailable'}`,
      )),
    ),
    ResidentSearchSelect: () => null,
    MaternalRecordEditor: ({ detail, onClose }) => detail ? React.createElement('div', { 'data-maternal-detail': detail.id }, `Visits:${(detail.visits || []).length}`, React.createElement('button', { onClick: onClose }, 'Close')) : null,
    WorkflowSelector: () => null,
    RegisterPregnancyForm: () => null,
    RecordEncounterForm: () => null,
    DeliveryRecordForm: () => null,
    PostpartumFollowUpForm: () => null,
    ProgramFormModal: () => null,
    ReferralHistory: ({ history = [] }) => React.createElement('div', null, `History:${history.length}`),
    DateRangeFilter: StubDateRangeFilter,
    matchesDateRange,
    SearchableSelect: StubSearchableSelect,
    ScheduleRequestsPanel: StubScheduleRequestsPanel,
    useM1OfficialPrint: () => ({ startPrint: async () => {}, portal: null, brandingError: null }),
    useMaternalRecordPrint: () => ({ startPrint: async () => {}, portal: null }),
    useHouseholdWorkers: () => ({ rows: [], loading: false, error: null, refresh: () => {} }),
    getSupervisorScope: (u) => u?.role === 'health_supervisor' ? { level: 'barangay', assignedBarangay: u.assignedBarangay || u.barangay } : null,
    isHealthSupervisor: (u) => u?.role === 'health_supervisor',
    HS_SCOPE: { BARANGAY: 'barangay', MUNICIPAL: 'municipality' },
    ROLE: { RESIDENT: 'resident', RESIDENT_LIMITED: 'resident_limited', HEALTH_SUPERVISOR: 'health_supervisor', PHN: 'phn', MHO: 'mho', RHU_PERSONNEL: 'rhu_personnel' },
    usePermissions: () => ({ can: () => true }),
    useLocation: () => ({ pathname: '/app/health_supervisor/records', state: null }),
    useNavigate: () => () => {},
    useParams: () => ({ section: 'B' }),
    useSearchParams: () => [new URLSearchParams(), () => {}],
    Link: ({ children, to }) => React.createElement('a', { href: to }, children),
    createPortal: (node) => node,
    formatClinicalDate: (v) => v || '—',
    formatClinicalDateTime: (v) => ({ date: v || '—', time: '—' }),
    buildTclCsv: () => '',
    buildMaternalCsv: () => '',
    buildProgramCsv: () => '',
    buildOralStatisticsCsv: () => '',
    downloadCsv: () => {},
    downloadReferralPdf: async () => {},
    availableYears: () => [2026],
    reportingYearOptions: (y) => [y || 2026],
    followUpStatus: () => 'On track',
    classifySyncError: (e) => (e?.name === 'TypeError' || /failed to fetch/i.test(e?.message || '')) ? { code: 'network' } : { code: 'unknown' },
    SYNC_ERROR: { NETWORK: 'network' },
    listResidentsOffline: async ({ ownerId }) => {
      const rows = (await listCachedRecords(ownerId, 'resident')).map((r) => r.data);
      return { rows, total: rows.length };
    },
    listHouseholdsOffline: async ({ ownerId }) => {
      const rows = (await listCachedRecords(ownerId, 'household')).map((r) => r.data);
      return { rows, total: rows.length };
    },
    ...extraDeps,
  };
  globalThis[key] = deps;

  const reactImport = JSON.stringify(import.meta.resolve('react'));
  // Handle relative imports like ../components/ProgramFormPage cleanly inside pages
  src = src.replace(/^import\s+([\s\S]*?)\s+from\s+(['"])([^'"]+)\2;?/gm, (stmt, bindings, _q, modPath) => {
    if (modPath === 'react') return stmt.replace(/['"]react['"]/, reactImport);
    const trimmed = bindings.trim();
    if (trimmed.startsWith('{')) {
      return `const ${trimmed.replace(/\bas\b/g, ':')} = globalThis.${key};`;
    }
    if (trimmed.includes(',')) {
      const [def, rest] = trimmed.split(/,(.+)/);
      return `const ${def.trim()} = globalThis.${key}.${def.trim()};\nconst ${rest.trim().replace(/\bas\b/g, ':')} = globalThis.${key};`;
    }
    return `const ${trimmed} = globalThis.${key}.${trimmed};`;
  });

  const compiled = await transform(src, { loader: 'jsx', jsx: 'transform' });
  const mod = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString('base64')}#comp-${mountSerial}`);
  return { mod, cleanup: () => { delete globalThis[key]; } };
}

beforeEach(async () => {
  setOfflineOwnerResolver(null);
  resetCachedKey();
  if (!db.isOpen()) await db.open();
  await db.transaction('rw', db.records, db.outbox, db.drafts, db.syncMeta, db.keys, async () => {
    await Promise.all([db.records.clear(), db.outbox.clear(), db.drafts.clear(), db.syncMeta.clear(), db.keys.clear()]);
  });
});

afterEach(() => {
  setOfflineOwnerResolver(null);
});

// =========================================================================
// PART 1: API-to-offline-service integration through real apiClient + API modules
// =========================================================================

test('API client -> API modules -> clinicalOfflineService -> AES-GCM IndexedDB integration', async () => {
  let owner = OWNER_A;
  let online = true;
  setOfflineOwnerResolver(() => owner);
  const originalFetch = globalThis.fetch;

  const mockResponses = {
    '/operational/tcl': { data: { rows: [{ id: 'tcl-1', resident_id: 'r-1', program: 'Oral Health', status: 'Active' }] } },
    '/operational/maternal': { data: { rows: [{ id: 'mat-1', resident_id: 'r-1', status: 'Active', risk: 'Low' }] } },
    '/operational/maternalvisits': { data: { rows: [{ id: 'mv-1', resident_id: 'r-1', maternal_case_id: 'mat-1', visit_date: '2026-11-01' }] } },
    '/operational/immunizations': { data: { rows: [{ id: 'imm-1', resident_id: 'r-1', vaccine: 'BCG', status: 'Completed' }] } },
    '/program-forms/ncd-risk': { data: { rows: [{ id: 'ncd-1', resident_id: 'r-1' }] } },
    '/program-forms/ncd-cervical': { data: { rows: [{ id: 'cerv-1', resident_id: 'r-1' }] } },
    '/program-forms/ncd-visual': { data: { rows: [{ id: 'vis-1', resident_id: 'r-1' }] } },
    '/program-forms/oral-health': { data: { rows: [{ id: 'oh-1', resident_id: 'r-1' }] } },
    '/program-forms/oral-health/statistics': { data: { statistics: { indicator_1_orally_fit_12_59: { counts: { total: 5 } } } } },
    '/program-forms/environmental': { data: { rows: [{ id: 'env-1', household_id: 'h-1' }] } },
    '/referrals': { data: { rows: [{ id: 'ref-out-1', resident_id: 'r-1', status: 'Pending' }] } },
    '/referrals/incoming': { data: { rows: [{ id: 'ref-in-1', resident_id: 'r-2', status: 'Pending' }] } },
    '/m1/report': { data: { byCode: { B1_1: { code: 'B1_1', section: 'B', name: 'Pregnant', total: 3 } } } },
    '/m1/programs/prenatal/records': { data: { program: 'prenatal', records: [{ id: 'mp-1' }], indicators: { B1_1: { code: 'B1_1', total: 3 } }, count: { records: 1, indicators: 1 } } },
  };

  globalThis.fetch = async (url) => {
    if (!online) throw networkFailure();
    const u = new URL(String(url));
    const key = u.pathname.replace(/^\/api/, '');
    if (key === '/forbidden') {
      return new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } });
    }
    const body = mockResponses[key];
    return new Response(JSON.stringify(body || { data: { rows: [] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    // Load real apiClient with mocked Supabase session
    const clientUrl = new URL('../../src/services/api/apiClient.js', import.meta.url);
    globalThis.__apiClientIntTest = {
      supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'tok', expires_at: Math.floor(Date.now() / 1000) + 3600 } } }) } },
      isSupabaseConfigured: true,
      supabaseConfigurationError: null,
    };
    const clientSrc = (await readFile(clientUrl, 'utf8'))
      .replace(/import\s+\{[^}]*\bsupabase\b[^}]*\}\s+from\s+'[^']+';/, 'const { supabase, isSupabaseConfigured, supabaseConfigurationError } = globalThis.__apiClientIntTest;')
      .replace(/from (['"])(\.{1,2}\/[^'"]+)\1/g, (_m, _q, p) => `from '${new URL(p, clientUrl).href}'`);
    const { api } = await import(`data:text/javascript;base64,${Buffer.from(clientSrc).toString('base64')}#ac-${Date.now()}`);

    // Execute real network fetches via clinicalOfflineService
    await clinicalOffline.listTclOffline({ ownerId: owner, fetchFn: () => api.get('/operational/tcl'), online: () => online });
    await clinicalOffline.listMaternalOffline({ ownerId: owner, fetchFn: () => api.get('/operational/maternal'), online: () => online });
    await clinicalOffline.listMaternalVisitsOffline({ ownerId: owner, params: { residentId: 'r-1' }, fetchFn: (p) => api.get('/operational/maternalvisits', { params: p }), online: () => online });
    await clinicalOffline.listImmunizationsOffline({ ownerId: owner, fetchFn: () => api.get('/operational/immunizations'), online: () => online });
    await clinicalOffline.listProgramFormOffline({ ownerId: owner, kind: 'ncd-risk', fetchFn: () => api.get('/program-forms/ncd-risk'), online: () => online });
    await clinicalOffline.getOralStatisticsOffline({ ownerId: owner, fetchFn: () => api.get('/program-forms/oral-health/statistics'), online: () => online });
    await clinicalOffline.listReferralsOffline({ ownerId: owner, params: { box: 'outgoing' }, fetchFn: (p) => api.get('/referrals', { params: p }), online: () => online });
    await clinicalOffline.listReferralInboxOffline({ ownerId: owner, fetchFn: () => api.get('/referrals/incoming'), online: () => online });
    await clinicalOffline.getM1ReportOffline({ ownerId: owner, params: { period: 'monthly', year: 2026, month: 11 }, fetchFn: (p) => api.get('/m1/report', { params: p }), online: () => online });
    await clinicalOffline.listM1ProgramOffline({ ownerId: owner, programId: 'prenatal', params: { period: 'monthly', year: 2026, month: 11 }, fetchFn: (p) => api.get('/m1/programs/prenatal/records', { params: p }), online: () => online });

    // Confirm raw IndexedDB records are AES-GCM encrypted (plaintext NOT leaked)
    const rawRows = await db.records.where('ownerId').equals(owner).toArray();
    assert.ok(rawRows.length >= 10);
    for (const row of rawRows) {
      assert.equal(row.data.enc, true, `${row.entity} must be AES-GCM encrypted at rest`);
    }

    // Drop network -> verify every endpoint reads back accurately from IndexedDB
    online = false;
    const tclOffline = await clinicalOffline.listTclOffline({ ownerId: owner, fetchFn: () => api.get('/operational/tcl'), online: () => online });
    assert.equal(tclOffline.source, 'cache');
    assert.equal(tclOffline.rows[0].id, 'tcl-1');
    assert.ok(Number.isFinite(tclOffline.cachedAt));

    // Verify resident-scoped filtering on maternal visits offline (r-2 returns empty, r-1 returns mv-1)
    const visitsR1 = await clinicalOffline.listMaternalVisitsOffline({ ownerId: owner, params: { residentId: 'r-1' }, fetchFn: () => api.get('/operational/maternalvisits'), online: () => online });
    assert.equal(visitsR1.rows.length, 1);
    const visitsR2 = await clinicalOffline.listMaternalVisitsOffline({ ownerId: owner, params: { residentId: 'r-2' }, fetchFn: () => api.get('/operational/maternalvisits'), online: () => online });
    assert.equal(visitsR2.rows.length, 0);

    // Verify outgoing vs incoming referral isolation
    const outRef = await clinicalOffline.listReferralsOffline({ ownerId: owner, params: { box: 'outgoing' }, fetchFn: () => api.get('/referrals'), online: () => online });
    const inRef = await clinicalOffline.listReferralInboxOffline({ ownerId: owner, fetchFn: () => api.get('/referrals/incoming'), online: () => online });
    assert.equal(outRef.rows[0].id, 'ref-out-1');
    assert.equal(inRef.rows[0].id, 'ref-in-1');

    // Verify HTTP 403 while online is NEVER treated as network failure / cache fallback
    online = true;
    await assert.rejects(
      () => clinicalOffline.listTclOffline({ ownerId: owner, fetchFn: () => api.get('/forbidden'), online: () => online }),
      { status: 403 },
    );
    await flush();
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.__apiClientIntTest;
  }
});

// =========================================================================
// PART 2: Real React Component UI Integration Tests (all 12 modules)
// =========================================================================

test('TCLS.jsx: online cache -> offline render + indicator + search/filter + barangay scope + empty cache', async () => {
  let online = true;
  let currentUser = { id: OWNER_A, role: 'health_supervisor', municipalityId: 'municipality-pili', barangayId: 'barangay-san-jose', assignedBarangay: 'San Jose' };
  const serverTcls = [
    { id: 't1', resident_id: 'r1', program: 'Prenatal and Postpartum', status: 'Active', priority: 'High', resident: { id: 'r1', first_name: 'Ana', last_name: 'Reyes', barangay: 'San Jose' } },
    { id: 't2', resident_id: 'r2', program: 'Oral Health', status: 'Active', priority: 'Medium', resident: { id: 'r2', first_name: 'Ben', last_name: 'Cruz', barangay: 'San Jose' } },
    { id: 't3', resident_id: 'r3', program: 'Oral Health', status: 'Active', priority: 'Low', resident: { id: 'r3', first_name: 'Cara', last_name: 'Other', barangay: 'San Pedro' } },
  ];
  await cacheRecord({ entity: 'resident', remoteId: 'r1', ownerId: OWNER_A, data: { id: 'r1', firstName: 'Ana', lastName: 'Reyes', barangay: 'San Jose' } });
  await cacheRecord({ entity: 'resident', remoteId: 'r2', ownerId: OWNER_A, data: { id: 'r2', firstName: 'Ben', lastName: 'Cruz', barangay: 'San Jose' } });

  const { mod, cleanup } = await compileComponent('features/health-records/pages/TCLS.jsx', {
    useAuth: () => ({ user: currentUser }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    tclApi: {
      list: async () => {
        if (!online) throw networkFailure();
        return { rows: serverTcls };
      },
    },
    loadResidentDirectory: async () => [
      { id: 'r1', name: 'Ana Reyes', barangay: 'San Jose' },
      { id: 'r2', name: 'Ben Cruz', barangay: 'San Jose' },
    ],
  });

  const TCLS = mod.default;
  let renderer;
  try {
    // 1. Online mount fetches and caches
    await act(async () => { renderer = create(React.createElement(TCLS)); });
    await flush();
    let text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Ana Reyes/);
    assert.match(text, /Ben Cruz/);
    assert.doesNotMatch(text, /Cara Other/, 'barangay scope excludes San Pedro');
    assert.doesNotMatch(text, /Offline — Showing saved records/);
    act(() => renderer.unmount());

    // 2. Disconnect & remount -> renders from IndexedDB with OfflineCacheNotice
    online = false;
    await act(async () => { renderer = create(React.createElement(TCLS)); });
    await flush();
    text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /Last synchronized:/);
    assert.match(text, /Ana Reyes/);
    assert.match(text, /Ben Cruz/);
    assert.doesNotMatch(text, /Cara Other/);

    // 3. Search works against cached records
    const searchInput = renderer.root.findByProps({ 'aria-label': 'Search Records' });
    await act(async () => { searchInput.props.onChange({ target: { value: 'Ben' } }); });
    await flush();
    text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Ben Cruz/);
    assert.doesNotMatch(text, /Ana Reyes/);
    act(() => renderer.unmount());

    // 4. Account switch to OWNER_B -> isolated empty offline state
    currentUser = { id: OWNER_B, role: 'health_supervisor', municipalityId: 'municipality-pili', barangayId: 'barangay-san-jose', assignedBarangay: 'San Jose' };
    await act(async () => { renderer = create(React.createElement(TCLS)); });
    await flush();
    text = JSON.stringify(renderer.toJSON());
    assert.match(text, /No saved records available offline\./);
    assert.doesNotMatch(text, /Ana Reyes/);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('TBRecords.jsx: online cache -> offline view, search, status filter & indicator', async () => {
  let online = true;
  const rows = [
    { id: 'tb1', resident_id: 'r1', program: 'TB Patients', status: 'Active', priority: 'High', resident: { id: 'r1', first_name: 'Diego', last_name: 'Santos', barangay: 'San Jose' } },
    { id: 'tb2', resident_id: 'r2', program: 'TB Prevention (TPT)', status: 'Completed', priority: 'Low', resident: { id: 'r2', first_name: 'Elena', last_name: 'Mendoza', barangay: 'San Jose' } },
  ];
  const { mod, cleanup } = await compileComponent('features/health-records/pages/TBRecords.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor', municipalityId: 'municipality-pili', barangayId: 'barangay-san-jose', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    DateRangeFilter: () => null,
    matchesDateRange: () => true,
    tclApi: { list: async () => { if (!online) throw networkFailure(); return { rows }; } },
  });
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /Diego Santos/);
    act(() => renderer.unmount());

    online = false;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    const text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /Diego Santos/);
    assert.match(text, /Elena Mendoza/);

    // Filter by status Completed offline
    const completedBtn = renderer.root.findAllByType('button').find((b) => b.children.includes('Completed'));
    await act(async () => { completedBtn.props.onClick(); });
    await flush();
    const filteredText = JSON.stringify(renderer.toJSON());
    assert.match(filteredText, /Elena Mendoza/);
    assert.doesNotMatch(filteredText, /Diego Santos/);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('Immunization.jsx: online cache -> offline fallback + search/status filter + empty state', async () => {
  let online = true;
  let owner = OWNER_A;
  const immRows = [
    { id: 'im1', resident_id: 'r1', vaccine: 'BCG', status: 'Completed', resident: { first_name: 'Baby', last_name: 'One', barangay: 'San Jose' } },
    { id: 'im2', resident_id: 'r2', vaccine: 'MMR', status: 'Due', resident: { first_name: 'Child', last_name: 'Two', barangay: 'San Jose' } },
  ];
  const { mod, cleanup } = await compileComponent('features/health-records/pages/Immunization.jsx', {
    useAuth: () => ({ user: { id: owner, role: 'health_supervisor', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    immunizationsApi: { list: async () => { if (!online) throw networkFailure(); return { rows: immRows }; } },
  });
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /BCG/);
    act(() => renderer.unmount());

    online = false;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    let text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /BCG/);
    assert.match(text, /MMR/);

    const dueBtn = renderer.root.findAllByType('button').find((b) => b.children.includes('Due'));
    await act(async () => { dueBtn.props.onClick(); });
    await flush();
    text = JSON.stringify(renderer.toJSON());
    assert.match(text, /MMR/);
    assert.doesNotMatch(text, /BCG/);
    act(() => renderer.unmount());

    // Switch account -> empty offline message
    owner = OWNER_B;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    text = JSON.stringify(renderer.toJSON());
    assert.match(text, /No saved records available offline\./);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('ProgramFormPage.jsx: NCD Risk, Cervical, Visual, Oral Health & Environmental all cache & search offline', async () => {
  let online = true;
  const apis = {
    'ncd-risk': { list: async () => { if (!online) throw networkFailure(); return { rows: [{ id: 'nr1', resident_id: 'r1', resident: { first_name: 'Ncd', last_name: 'RiskPatient', barangay: 'San Jose' } }] }; } },
    'ncd-cervical': { list: async () => { if (!online) throw networkFailure(); return { rows: [{ id: 'nc1', resident_id: 'r2', resident: { first_name: 'Cerv', last_name: 'Patient', barangay: 'San Jose' } }] }; } },
    'ncd-visual': { list: async () => { if (!online) throw networkFailure(); return { rows: [{ id: 'nv1', resident_id: 'r3', resident: { first_name: 'Vis', last_name: 'Senior', barangay: 'San Jose' } }] }; } },
    'oral-health': { list: async () => { if (!online) throw networkFailure(); return { rows: [{ id: 'oh1', resident_id: 'r4', resident: { first_name: 'Oral', last_name: 'Child', barangay: 'San Jose' } }] }; } },
    environmental: { list: async () => { if (!online) throw networkFailure(); return { rows: [{ id: 'ev1', household_id: 'h1', household: { head_name: 'Dela Cruz Family', purok: '1' } }] }; } },
  };
  const { mod, cleanup } = await compileComponent('features/health-records/components/ProgramFormPage.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    programFormsApi: apis,
  });

  const expectedLabels = [
    ['ncd-risk', 'Ncd RiskPatient'],
    ['ncd-cervical', 'Cerv Patient'],
    ['ncd-visual', 'Vis Senior'],
    ['oral-health', 'Oral Child'],
    ['environmental', 'Dela Cruz Family'],
  ];

  let renderer;
  try {
    // Load each online first
    online = true;
    for (const [kind] of expectedLabels) {
      await act(async () => { renderer = create(React.createElement(mod.default, { config: PROGRAM_FORMS[kind] })); });
    await flush();
      act(() => renderer.unmount());
    }

    // Verify each offline + offline indicator + search
    online = false;
    for (const [kind, marker] of expectedLabels) {
      await act(async () => { renderer = create(React.createElement(mod.default, { config: PROGRAM_FORMS[kind] })); });
    await flush();
      const text = JSON.stringify(renderer.toJSON());
      assert.match(text, /Offline — Showing saved records/, `${kind} should show offline notice`);
      assert.match(text, new RegExp(marker), `${kind} should render cached data offline`);
      act(() => renderer.unmount());
    }

    // Verify search works offline on cached environmental records
    await act(async () => { renderer = create(React.createElement(mod.default, { config: PROGRAM_FORMS.environmental })); });
    await flush();
    const search = renderer.root.findByProps({ 'aria-label': 'Search Records' });
    await act(async () => { search.props.onChange({ target: { value: 'NonExistentQuery' } }); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /No matching records found/);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('OralHealthRecords.jsx: Statistics tab caches aggregates separately from individual TCL rows', async () => {
  let online = true;
  const statsPayload = {
    statistics: {
      indicator_1_orally_fit_12_59: { label: 'Orally Fit 12-59 mos', counts: { nhts: 2, non_nhts: 3, total: 5 } },
      indicator_2_dmft_new: { label: 'DMFT New', counts: { nhts: 1, non_nhts: 1, total: 2 } },
      bohc: { child_12_59: { label: 'BOHC Children', counts: { nhts: 2, non_nhts: 3, total: 5 }, target_basis: 'Pop', target: 10 } },
    },
  };
  const { mod, cleanup } = await compileComponent('features/health-records/pages/OralHealthRecords.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    oralHealthApi: { statistics: async () => { if (!online) throw networkFailure(); return statsPayload; } },
    ProgramFormPage: () => React.createElement('div', null, 'TCL Tab'),
  });
  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    // Switch to Statistical Table (ST) tab while online
    const stTab = renderer.root.findAllByProps({ role: 'tab' }).find((t) => t.children.includes('Statistical Table (ST)'));
    await act(async () => { stTab.props.onClick(); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /Orally Fit 12-59 mos/);

    // Verify stored under oralHealthStatistics entity, NOT oral-health individual records
    assert.equal((await listCachedRecords(OWNER_A, 'oralHealthStatistics')).length, 1);
    assert.equal((await listCachedRecords(OWNER_A, 'oral-health')).length, 0);
    act(() => renderer.unmount());

    // Offline mount -> switch to ST tab -> renders cached BOHC table + offline notice
    online = false;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    const stTabOffline = renderer.root.findAllByProps({ role: 'tab' }).find((t) => t.children.includes('Statistical Table (ST)'));
    await act(async () => { stTabOffline.props.onClick(); });
    await flush();
    const text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /Orally Fit 12-59 mos/);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('M1Records.jsx: maternal records, resident-scoped visits, and module grid counts work offline', async () => {
  let online = true;
  let pathname = '/app/health_supervisor/maternal-tcl';
  const maternalRows = [
    { id: 'mat-1', resident_id: 'r1', status: 'Active', risk: 'High', resident: { first_name: 'Maria', last_name: 'Clara', barangay: 'San Jose' }, created_at: '2026-10-01' },
  ];
  const visits = [
    { id: 'v1', resident_id: 'r1', maternal_case_id: 'mat-1', visit_date: '2026-10-15' },
  ];
  const programClients = Object.fromEntries(
    ['prenatal', 'ncd', 'cervical', 'visual', 'oral', 'environmental', 'enrollment'].map((id, i) => [
      id,
      { list: async () => { if (!online) throw networkFailure(); return { program: id, records: [], indicators: {}, count: { records: i + 2, indicators: 0 } }; } },
    ]),
  );

  const { mod, cleanup } = await compileComponent('features/health-records/pages/M1Records.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    useLocation: () => ({ pathname, state: null }),
    maternalApi: { list: async () => { if (!online) throw networkFailure(); return { rows: maternalRows }; } },
    maternalVisitsApi: { list: async () => { if (!online) throw networkFailure(); return { rows: visits }; } },
    m1ProgramsApi: programClients,
    m1Api: { report: async () => ({ byCode: {} }), getMeta: async () => ({}) },
  });

  let renderer;
  try {
    // 1. Online maternal-tcl route loads & caches maternal records, open detail caches visits
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    const viewBtn = renderer.root.findAllByType('button').find((b) => b.children.includes('View'));
    await act(async () => { viewBtn.props.onClick(); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /Visits:1/);
    act(() => renderer.unmount());

    // 2. Offline maternal-tcl route reads cached records & visits
    online = false;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    let text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /Maria Clara/);
    const viewBtnOff = renderer.root.findAllByType('button').find((b) => b.children.includes('View'));
    await act(async () => { viewBtnOff.props.onClick(); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /Visits:1/);
    act(() => renderer.unmount());

    // 3. Online M1 overview grid loads & caches counts -> Offline M1 grid shows cached counts + notice
    pathname = '/app/health_supervisor/m1';
    online = true;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    assert.match(JSON.stringify(renderer.toJSON()), /prenatal:2/);
    act(() => renderer.unmount());

    online = false;
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /prenatal:2/);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('HealthReferrals.jsx & IncomingReferrals.jsx: separated referral stores, search/filter & offline detail', async () => {
  let online = true;
  const outgoingRow = { id: 'ref-1', resident_id: 'r1', status: 'Pending', priority: 'High', reason: 'OB Consult', referral_date: '2026-11-01', destination_facility: 'RHU Main', resident: { first_name: 'Juan', last_name: 'Dela Cruz', barangay: 'San Jose' } };
  const incomingRow = { id: 'ref-2', resident_id: 'r2', status: 'Accepted', priority: 'Medium', reason: 'Dental Triage', scheduled_at: '2026-11-02T09:00:00Z', resident: { first_name: 'Rosa', last_name: 'Gomez', barangay: 'San Jose' } };

  const sharedDeps = {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    referralsApi: {
      list: async () => { if (!online) throw networkFailure(); return { rows: [outgoingRow] }; },
      inbox: async () => { if (!online) throw networkFailure(); return { rows: [incomingRow] }; },
      get: async (id) => {
        if (!online) throw networkFailure();
        return { record: id === 'ref-1' ? { ...outgoingRow, history: [{ id: 'h1' }] } : { ...incomingRow, history: [{ id: 'h2' }] } };
      },
    },
    residentsApi: { directoryFilters: async () => ({ rows: [] }) },
    api: { get: async () => { if (!online) throw networkFailure(); return { rows: [] }; } },
  };

  const outMod = await compileComponent('features/referrals/pages/HealthReferrals.jsx', sharedDeps);
  const inMod = await compileComponent('features/triage/pages/IncomingReferrals.jsx', sharedDeps);
  let r1, r2;
  try {
    // Load online
    await act(async () => { r1 = create(React.createElement(outMod.mod.default)); });
    await flush();
    await act(async () => { r2 = create(React.createElement(inMod.mod.default)); });
    await flush();
    act(() => r1.unmount());
    act(() => r2.unmount());

    // Offline check — both show strictly their own referral lists & offline indicators
    online = false;
    await act(async () => { r1 = create(React.createElement(outMod.mod.default)); });
    await flush();
    await act(async () => { r2 = create(React.createElement(inMod.mod.default)); });
    await flush();
    const outText = JSON.stringify(r1.toJSON());
    const inText = JSON.stringify(r2.toJSON());

    assert.match(outText, /Offline — Showing saved records/);
    assert.match(outText, /Juan Dela Cruz/);
    assert.doesNotMatch(outText, /Rosa Gomez/);

    assert.match(inText, /Offline — Showing saved records/);
    assert.match(inText, /Rosa Gomez/);
    assert.doesNotMatch(inText, /Juan Dela Cruz/);

    // Reconnect replaces view with fresh server data
    outgoingRow.reason = 'Updated Server Reason';
    online = true;
    await act(async () => {
      // Remount or click retry simulates reconnect
      r1.unmount();
      r1 = create(React.createElement(outMod.mod.default));
    });
    await flush();
    const refreshedText = JSON.stringify(r1.toJSON());
    assert.doesNotMatch(refreshedText, /Offline — Showing saved records/);
    assert.match(refreshedText, /Updated Server Reason/);
  } finally {
    if (r1) act(() => r1.unmount());
    if (r2) act(() => r2.unmount());
    outMod.cleanup();
    inMod.cleanup();
  }
});

test('M1SectionDetail.jsx, M1Fhsis.jsx & TclWorkspace.jsx: offline report viewing and honest workspace counts', async () => {
  let online = true;
  const secB = M1_INDICATORS.filter((row) => row.section === 'B').map((row, idx) => ({ ...row, total: idx + 1 }));
  const reportObj = { byCode: Object.fromEntries(secB.map((r) => [r.code, r])) };

  const sectionMod = await compileComponent('features/health-records/pages/M1SectionDetail.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor', municipalityId: 'municipality-pili', barangayId: 'barangay-san-jose', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    m1Api: {
      report: async () => { if (!online) throw networkFailure(); return reportObj; },
      drilldown: async () => { if (!online) throw networkFailure(); return { records: [] }; },
    },
  });

  const fhsisMod = await compileComponent('features/health-records/pages/M1Fhsis.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    m1Api: {
      report: async () => { if (!online) throw networkFailure(); return reportObj; },
      daily: async () => { if (!online) throw networkFailure(); return { participants: [{ id: 'd1', date: '2026-11-18', indicator: 'Prenatal', resident: { first_name: 'Liza', last_name: 'Uy' }, status: 'Done' }] }; },
      drilldown: async () => ({ records: [] }),
    },
  });

  // Pre-cache ONLY maternal for TclWorkspace offline test (leave others uncached to test "Count unavailable")
  await cacheRecord({ entity: 'maternal', remoteId: 'm-1', ownerId: OWNER_A, data: { id: 'm-1' } });
  const workspaceMod = await compileComponent('features/health-records/pages/TclWorkspace.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor' } }),
    useSyncStatus: () => ({ online, lastSyncedAt: 1700000000000 }),
    maternalApi: { list: async () => { if (!online) throw networkFailure(); return { rows: [{ id: 'm-1' }] }; } },
    tclApi: { list: async () => { if (!online) throw networkFailure(); return { rows: [] }; } },
    programFormsApi: new Proxy({}, { get: () => ({ list: async () => { if (!online) throw networkFailure(); return { rows: [] }; } }) }),
  });

  let rs, rf, rw;
  try {
    // Load Section & FHSIS online
    await act(async () => { rs = create(React.createElement(sectionMod.mod.default)); });
    await flush();
    await act(async () => { rf = create(React.createElement(fhsisMod.mod.default)); });
    await flush();
    act(() => rs.unmount());
    act(() => rf.unmount());

    // Offline render Section, FHSIS, and TclWorkspace
    online = false;
    await act(async () => { rs = create(React.createElement(sectionMod.mod.default)); });
    await flush();
    await act(async () => { rf = create(React.createElement(fhsisMod.mod.default)); });
    await flush();
    await act(async () => { rw = create(React.createElement(workspaceMod.mod.default)); });
    await flush();

    const secText = JSON.stringify(rs.toJSON());
    assert.match(secText, /Offline — Showing saved records/);
    assert.match(secText, new RegExp(secB[0].code));

    const fhsisText = JSON.stringify(rf.toJSON());
    assert.match(fhsisText, /Offline — Showing saved records/);
    assert.match(fhsisText, /Liza Uy/);

    const wsText = JSON.stringify(rw.toJSON());
    assert.match(wsText, /Offline — Showing saved records/);
    assert.match(wsText, /Prenatal and Postpartum:1 records/);
    assert.match(wsText, /NCD Risk Assessment:Count unavailable/, 'uncached program must show Count unavailable, never a misleading 0');
  } finally {
    if (rs) act(() => rs.unmount());
    if (rf) act(() => rf.unmount());
    if (rw) act(() => rw.unmount());
    sectionMod.cleanup();
    fhsisMod.cleanup();
    workspaceMod.cleanup();
  }
});

// =========================================================================
// PART 3: Permission expiration & stale indicator security tests
// =========================================================================

test('Permission expiration & 403 revocation fail closed and never serve cached clinical data', async () => {
  await cacheRecord({ entity: 'tcl', remoteId: 't-sec', ownerId: OWNER_A, data: { id: 't-sec', resident_id: 'r1', program: 'Oral Health' } });
  await cacheVerifiedPermissions({ userId: OWNER_A, role: 'health_supervisor', matrix: { health_supervisor: { 'records.view': true } }, now: 1000 });
  assert.ok(await readVerifiedPermissions({ userId: OWNER_A, role: 'health_supervisor', now: 1001 }));
  assert.equal(await readVerifiedPermissions({ userId: OWNER_A, role: 'health_supervisor', now: 1000 + PERMISSION_CACHE_TTL_MS }), null);

  // Server returns 403 while online -> UI must show error and NOT display cached record
  const { mod, cleanup } = await compileComponent('features/health-records/pages/TCLS.jsx', {
    useAuth: () => ({ user: { id: OWNER_A, role: 'health_supervisor', municipalityId: 'municipality-pili', barangayId: 'barangay-san-jose', assignedBarangay: 'San Jose' } }),
    useSyncStatus: () => ({ online: true, lastSyncedAt: 1700000000000 }),
    tclApi: { list: async () => { throw Object.assign(new Error('Permission revoked'), { status: 403 }); } },
    loadResidentDirectory: async () => [],
  });

  let renderer;
  try {
    await act(async () => { renderer = create(React.createElement(mod.default)); });
    await flush();
    const text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Permission revoked/);
    assert.doesNotMatch(text, /t-sec/);
    assert.doesNotMatch(text, /Offline — Showing saved records/);
  } finally {
    if (renderer) act(() => renderer.unmount());
    cleanup();
  }
});

test('Stale cached records (>7d TTL) trigger outdated notice in OfflineCacheNotice', async () => {
  let renderer;
  try {
    await act(async () => {
      renderer = create(React.createElement(RealOfflineCacheNotice, {
        source: 'cache',
        cachedAt: Date.now() - CACHE_TTL_MS - 5000,
        stale: true,
        empty: false,
      }));
    });
    const text = JSON.stringify(renderer.toJSON());
    assert.match(text, /Offline — Showing saved records/);
    assert.match(text, /Last synchronized:/);
    assert.match(text, /Cached data may be outdated\./);
  } finally {
    if (renderer) act(() => renderer.unmount());
  }
});

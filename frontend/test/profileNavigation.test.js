import test from 'node:test';
import assert from 'node:assert/strict';

import {
  filterNavByPermission,
  navItemIsActive,
  NAV,
  profilePathForRole,
} from '../src/lib/navConfig.js';

test('profile action uses one stable route for every role', () => {
  for (const role of [
    'admin',
    'mho',
    'phn',
    'rhu_personnel',
    'health_supervisor',
    'bhw',
    'resident',
    'resident-limited',
  ]) {
    assert.equal(profilePathForRole(role), `/app/${role}/profile`);
  }
});

test('administrator navigation keeps destinations grouped without changing routes', () => {
  assert.deepEqual(
    NAV.admin.map(({ group, label, path }) => [group, label, path]),
    [
      ['Overview', 'Dashboard', '/app/admin/dashboard'],
      ['Management', 'User Management', '/app/admin/users'],
      ['Management', 'Roles', '/app/admin/roles'],
      ['Management', 'Role & Permissions', '/app/admin/permissions'],
      ['Health Configuration', 'Early Intervention Rules', '/app/admin/risk-rules'],
      ['Health Configuration', 'Risk Assessment', '/app/admin/risk-assessment'],
      ['System', 'Audit Trail', '/app/admin/audit'],
      ['System', 'System Settings', '/app/admin/settings'],
      ['System', 'Logs', '/app/admin/logs'],
    ],
  );
});

test('RHU navigation uses the required role-specific sections', () => {
  assert.deepEqual(
    NAV.rhu_personnel.map(({ label, group }) => [group, label]),
    [
      ['Main', 'Dashboard'],
      ['Operations', 'Triage'],
      ['Operations', 'Consultation'],
      ['Operations', 'Medical Certificates'],
      ['Operations', 'Health Programs'],
      ['Operations', 'Notifications'],
      ['System', 'Settings'],
    ],
  );
});

test('MHO navigation keeps Health Trends and referrals without a Community Monitoring item', () => {
  const groups = NAV.mho.reduce((sections, item) => {
    const current = sections[sections.length - 1];
    if (current?.group === item.group) current.items.push(item.label);
    else sections.push({ group: item.group, items: [item.label] });
    return sections;
  }, []);

  assert.deepEqual(groups.slice(0, 4), [
    { group: 'Main', items: ['Dashboard', 'Resident Directory'] },
    { group: 'Monitoring', items: ['Health Trends', 'Referrals'] },
    { group: 'Submissions', items: ['TCL & M1 Submissions'] },
    { group: 'Health Services', items: ['Medical Certificates'] },
  ]);
  assert.equal(groups.filter((section) => section.group === 'Monitoring').length, 1);
  assert.equal(NAV.mho.some((item) => item.label === 'Community Monitoring'), false);
  assert.deepEqual(
    NAV.mho.filter((item) => ['Health Trends', 'Referrals'].includes(item.label))
      .map(({ label, path }) => [label, path]),
    [
      ['Health Trends', '/app/mho/trends'],
      ['Referrals', '/app/mho/referrals'],
    ],
  );
});

test('PHN navigation keeps quick links separate and organizes the remaining destinations', () => {
  const phn = NAV.phn;
  const groups = phn.filter((item) => item.children);

  assert.deepEqual(
    phn.filter((item) => !item.children).map(({ label, path }) => [label, path]),
    [
      ['Dashboard', '/app/phn/dashboard'],
      ['Resident Directory', '/app/phn/residents'],
      ['Account Approvals', '/app/phn/account-approvals'],
      ['Notifications', '/app/phn/notifications'],
      ['Settings', '/app/phn/settings'],
    ],
  );
  assert.deepEqual(
    groups.map(({ label, children }) => [
      label,
      children.map(({ label: childLabel, path }) => [childLabel, path]),
    ]),
    [
      [
        'Clinical Care',
        [
          ['Health Records', '/app/phn/record'],
          ['PHN Check-ups', '/app/phn/consultations'],
          ['Health Services', '/app/phn/services'],
        ],
      ],
      [
        'Care Coordination',
        [
          ['Referrals', '/app/phn/referrals'],
          ['Follow-ups', '/app/phn/followups'],
        ],
      ],
      [
        'Community Risk',
        [['Household Risk Overview', '/app/phn/households/risk-overview']],
      ],
      [
        'Documents & Reports',
        [
          ['Medical Certificates', '/app/phn/certificates'],
          ['Reports', '/app/phn/reports'],
        ],
      ],
    ],
  );
  assert.deepEqual(
    phn.flatMap((item) => item.children || [])
      .filter((item) => item.permission)
      .map(({ label, permission }) => [label, permission]),
    [
      ['Health Records', 'residents.profile.view'],
      ['PHN Check-ups', 'consultation.requests.view'],
      ['Health Services', 'services.view'],
      ['Referrals', 'referrals.view'],
      ['Follow-ups', 'followups.view'],
      ['Household Risk Overview', 'households.view'],
      ['Reports', 'reports.view'],
    ],
  );
});

test('PHN submenu permissions remain enforced when filtering navigation', () => {
  const visible = filterNavByPermission(NAV.phn, (permission) =>
    ['consultation.requests.view', 'reports.view'].includes(permission),
  );

  assert.equal(
    visible.find((item) => item.label === 'Clinical Care').children
      .some((item) => item.label === 'PHN Check-ups'),
    true,
  );
  assert.equal(
    visible.find((item) => item.label === 'Documents & Reports').children
      .some((item) => item.label === 'Reports'),
    true,
  );
  assert.equal(
    visible.some((item) => item.label === 'Care Coordination'),
    false,
  );
});

test('PHN submenu active state covers direct and detail routes', () => {
  const communityRisk = NAV.phn
    .find((item) => item.label === 'Community Risk')
    .children[0];
  const certificates = NAV.phn
    .find((item) => item.label === 'Documents & Reports')
    .children.find((item) => item.label === 'Medical Certificates');

  assert.equal(
    navItemIsActive(communityRisk, '/app/phn/households/risk-overview'),
    true,
  );
  assert.equal(
    navItemIsActive(communityRisk, '/app/phn/households/household-123'),
    true,
  );
  assert.equal(
    navItemIsActive(communityRisk, '/app/phn/referrals'),
    false,
  );
  assert.equal(
    navItemIsActive(certificates, '/app/phn/certificates/new'),
    true,
  );
});
import test from 'node:test';
import assert from 'node:assert/strict';

import { NAV, profilePathForRole } from '../src/lib/navConfig.js';

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

test('MHO navigation keeps monitoring items in one section before submissions', () => {
  const groups = NAV.mho.reduce((sections, item) => {
    const current = sections[sections.length - 1];
    if (current?.group === item.group) current.items.push(item.label);
    else sections.push({ group: item.group, items: [item.label] });
    return sections;
  }, []);

  assert.deepEqual(groups.slice(0, 4), [
    { group: 'Main', items: ['Dashboard', 'Resident Directory'] },
    { group: 'Monitoring', items: ['Health Trends', 'Community Monitoring', 'Referrals'] },
    { group: 'Submissions', items: ['TCL & M1 Submissions'] },
    { group: 'Health Services', items: ['Medical Certificates'] },
  ]);
  assert.equal(groups.filter((section) => section.group === 'Monitoring').length, 1);
  assert.deepEqual(
    NAV.mho.filter((item) => ['Health Trends', 'Community Monitoring', 'Referrals'].includes(item.label))
      .map(({ label, path }) => [label, path]),
    [
      ['Health Trends', '/app/mho/trends'],
      ['Community Monitoring', '/app/mho/barangays'],
      ['Referrals', '/app/mho/referrals'],
    ],
  );
});
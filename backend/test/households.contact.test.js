import test from 'node:test';
import assert from 'node:assert/strict';

import { householdMemberValidator } from '../src/validators/household.validators.js';
import { normalizeMembers } from '../src/services/households.service.js';

const MEMBER_BASE = { name: 'A', relationship: 'Head', sex: 'Male' };

test('householdMemberValidator accepts missing/null/empty/whitespace contact', () => {
  const cases = [
    { ...MEMBER_BASE },
    { ...MEMBER_BASE, contact: null },
    { ...MEMBER_BASE, contact: '' },
    { ...MEMBER_BASE, contact: '   ' },
  ];
  for (const member of cases) {
    const result = householdMemberValidator({ member });
    assert.ok(!result.error, JSON.stringify(member));
    assert.equal(result.value.member.contact, null);
  }
});

test('householdMemberValidator accepts valid PH mobile contact', () => {
  const result = householdMemberValidator({ member: { ...MEMBER_BASE, contact: '09171234567' } });
  assert.ok(!result.error);
  assert.equal(result.value.member.contact, '09171234567');
});

test('householdMemberValidator rejects invalid contact', () => {
  const cases = ['abc', '123', '0917-123', '0917123456', '+63 912 345 6789 123'];
  for (const contact of cases) {
    const result = householdMemberValidator({ member: { ...MEMBER_BASE, contact } });
    assert.ok(result.error, contact);
    assert.ok(result.error['members[0].contact'], contact);
  }
});

test('normalizeMembers preserves valid contact and normalizes empty contact to null', () => {
  const { members, errors } = normalizeMembers([
    { name: 'A', relationship: 'Head', sex: 'Male', contact: '  0917 123 4567  ' },
    { name: 'B', relationship: 'Child', sex: 'Female', contact: '' },
    { name: 'C', relationship: 'Spouse', sex: 'Female' },
  ]);
  assert.equal(errors.length, 0);
  assert.equal(members[0].contact, '0917 123 4567');
  assert.equal(members[1].contact, null);
  assert.equal(members[2].contact, null);
});

test('normalizeMembers trims valid contact and keeps null when omitted', () => {
  const { members } = normalizeMembers([
    { name: 'A', relationship: 'Head', sex: 'Male', contact: ' 09171234567 ' },
  ]);
  assert.equal(members[0].contact, '09171234567');
});

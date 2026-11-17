import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

import {
  addHouseholdMember,
  updateHouseholdMember,
  removeHouseholdMember,
} from '../src/services/households.service.js';
import { computeHouseholdRisk, householdFlags } from '../src/utils/householdRisk.js';

const BHW_USER = {
  id: 'bhw-001',
  role: 'bhw',
  barangay: 'San Isidro',
  barangayId: 'brgy-001',
  municipalityId: 'mun-001',
};

const createFakeRepo = (initialHousehold, { withAtomic = false } = {}) => {
  let household = structuredClone(initialHousehold);
  const updateCalls = [];
  const atomicCalls = [];

  const applyRisk = (riskPatch) => {
    household = {
      ...household,
      riskScore: riskPatch.riskScore,
      riskLevel: riskPatch.riskLevel,
      riskFactors: riskPatch.riskFactors,
      flags: riskPatch.flags,
      revision: (household.revision ?? 1) + 1,
    };
  };

  const repo = {
    updateCalls,
    atomicCalls,
    async getHousehold(id) {
      if (id !== household.id) return null;
      return structuredClone(household);
    },
    async addHouseholdMember(householdId, member) {
      assert.equal(householdId, household.id);
      const created = { id: member.id || `mem-${household.members.length + 1}`, householdId, ...member };
      household.members.push(created);
      return structuredClone(created);
    },
    async updateHouseholdMember(householdId, memberId, member) {
      assert.equal(householdId, household.id);
      const idx = household.members.findIndex((m) => m.id === memberId);
      if (idx === -1) return null;
      household.members[idx] = { ...household.members[idx], ...member };
      return structuredClone(household.members[idx]);
    },
    async removeHouseholdMember(householdId, memberId) {
      assert.equal(householdId, household.id);
      const before = household.members.length;
      household.members = household.members.filter((m) => m.id !== memberId);
      return household.members.length < before;
    },
    async updateHousehold(householdId, patch) {
      assert.equal(householdId, household.id);
      updateCalls.push(structuredClone(patch));
      applyRisk(patch);
      return structuredClone(household);
    },
  };

  if (withAtomic) {
    repo.addHouseholdMemberWithRisk = async (householdId, member, riskPatch) => {
      atomicCalls.push({ op: 'add', householdId, member, riskPatch });
      const created = await repo.addHouseholdMember(householdId, member);
      applyRisk(riskPatch);
      return { member: created, household: structuredClone(household) };
    };
    repo.updateHouseholdMemberWithRisk = async (householdId, memberId, member, riskPatch) => {
      atomicCalls.push({ op: 'update', householdId, memberId, member, riskPatch });
      const updated = await repo.updateHouseholdMember(householdId, memberId, member);
      if (!updated) return { missing: 'member' };
      applyRisk(riskPatch);
      return { member: updated, household: structuredClone(household) };
    };
    repo.removeHouseholdMemberWithRisk = async (householdId, memberId, riskPatch) => {
      atomicCalls.push({ op: 'remove', householdId, memberId, riskPatch });
      const removed = await repo.removeHouseholdMember(householdId, memberId);
      if (!removed) return { missing: 'member' };
      applyRisk(riskPatch);
      return { removed: true, household: structuredClone(household) };
    };
  }

  return repo;
};

const makeHouseholdFixture = () => ({
  id: 'HH-001',
  barangay: 'San Isidro',
  barangayId: 'brgy-001',
  municipalityId: 'mun-001',
  headName: 'Maria Cruz',
  waterSource: 'level1', // 30 points -> Low (30) by itself
  toiletType: 'flush',
  sanitationAccess: 'Owned',
  monthlyIncome: 15000,
  riskScore: 30,
  riskLevel: 'Low',
  riskFactors: ['Level 1 / dug well water (+30)'],
  flags: [],
  revision: 1,
  members: [
    {
      id: 'mem-1',
      name: 'Maria Cruz',
      age: 34,
      sex: 'Female',
      classification: 'Adult',
      relationship: 'Head',
      isPwd: false,
      philhealth: 'member',
    },
  ],
});

test('P0-3: add, update, and remove member recompute and persist parent risk (atomic & fallback)', async () => {
  for (const withAtomic of [true, false]) {
    const repo = createFakeRepo(makeHouseholdFixture(), { withAtomic });

    // 1. Add pregnant + PWD member with unspecified PhilHealth -> 30 + 15 + 10 = 55 (Moderate) + PhilHealth flag
    const added = await addHouseholdMember({
      id: 'HH-001',
      user: BHW_USER,
      member: {
        name: 'Ana Cruz',
        age: 26,
        sex: 'Female',
        classification: 'P',
        relationship: 'Spouse',
        isPwd: true,
        philhealth: '',
      },
      repo,
    });
    assert.equal(added.household.riskScore, 55);
    assert.equal(added.household.riskLevel, 'Moderate');
    assert.ok(added.household.riskFactors.some((f) => /Pregnant/i.test(f)));
    assert.ok(added.household.riskFactors.some((f) => /PWD/i.test(f)));
    assert.deepEqual(added.household.flags, [
      'Sanitation Risk',
      'Verify PhilHealth enrollment for Ana Cruz',
    ]);

    // 2. Update member classification to Senior Citizen ('SC') + still PWD + add PhilHealth -> 30 + 10 + 10 = 50 (Moderate), PhilHealth flag cleared
    const updated = await updateHouseholdMember({
      id: 'HH-001',
      memberId: added.member.id,
      user: BHW_USER,
      member: {
        classification: 'SC',
        philhealth: 'member',
      },
      repo,
    });
    assert.equal(updated.household.riskScore, 50);
    assert.equal(updated.household.riskLevel, 'Moderate');
    assert.ok(updated.household.riskFactors.some((f) => /Senior citizen/i.test(f)));
    assert.deepEqual(updated.household.flags, ['Sanitation Risk']);

    // 3. Remove the added member -> reverts back to 30 (Low)
    const removed = await removeHouseholdMember({
      id: 'HH-001',
      memberId: added.member.id,
      user: BHW_USER,
      repo,
    });
    assert.equal(removed.success, true);
    assert.equal(removed.household.riskScore, 30);
    assert.equal(removed.household.riskLevel, 'Low');
    assert.deepEqual(removed.household.flags, ['Sanitation Risk']);

    if (withAtomic) {
      assert.deepEqual(repo.atomicCalls.map((c) => c.op), ['add', 'update', 'remove']);
      assert.equal(repo.updateCalls.length, 0);
    } else {
      assert.equal(repo.updateCalls.length, 3);
    }
  }
});

test('P0-3: Postgres atomic RPCs update member + risk in one transaction and roll back on failure', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    const munId = randomUUID();
    const brgyId = randomUUID();
    const resId = 'RES-P03-001';
    const migrationSql = await readFile(
      new URL('../../supabase/migrations/20261118000000_atomic_household_member_risk.sql', import.meta.url),
      'utf8',
    );

    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      create table public.households (
        id text primary key,
        municipality_id uuid not null,
        barangay_id uuid not null,
        barangay text not null default '',
        head_name text not null,
        risk_score integer not null default 0 check (risk_score >= 0),
        risk_level text not null default 'Low' check (risk_level in ('Low', 'Moderate', 'High')),
        risk_factors jsonb not null default '[]'::jsonb,
        flags jsonb not null default '[]'::jsonb,
        revision integer not null default 1,
        updated_at timestamptz not null default now()
      );
      create table public.household_members (
        id uuid primary key default gen_random_uuid(),
        household_id text not null references public.households(id) on delete cascade,
        resident_id text,
        name text not null,
        birthday text not null default '',
        age integer check (age is null or age >= 0),
        sex text not null default '' check (sex in ('', 'Male', 'Female')),
        classification text not null default '',
        relationship text not null default '',
        contact text not null default '',
        is_pwd boolean not null default false,
        philhealth text not null default '' check (philhealth in ('', 'member', 'non-member')),
        fp_method text not null default '',
        quarter_status text not null default '',
        is_head boolean not null default false,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        constraint household_members_resident_unique unique (household_id, resident_id)
      );
    `);
    await db.exec(migrationSql);

    await db.query(
      `insert into public.households (id, municipality_id, barangay_id, barangay, head_name, risk_score, risk_level)
       values ('HH-PG-1', $1, $2, 'San Isidro', 'Pedro Reyes', 30, 'Low')`,
      [munId, brgyId],
    );

    // Non-service roles must not execute the RPCs directly.
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        () => db.query(
          `select public.add_household_member_with_risk('HH-PG-1', '{}'::jsonb, '{}'::jsonb)`,
        ),
        (err) => err.code === '42501',
      );
      await db.exec('reset role');
    }

    // Add member + risk atomically.
    const computedAdd = computeHouseholdRisk({
      waterSource: 'level1',
      members: [{ classification: 'P', pwd: false, name: 'Elena Reyes', age: 25, philhealth: 'non-member' }],
    });
    const flagsAdd = householdFlags({
      waterSource: 'level1',
      members: [{ name: 'Elena Reyes', age: 25, philhealth: 'non-member' }],
    });
    const addRes = (await db.query(
      `select public.add_household_member_with_risk($1, $2::jsonb, $3::jsonb) as res`,
      [
        'HH-PG-1',
        JSON.stringify({
          resident_id: resId,
          name: 'Elena Reyes',
          age: 25,
          sex: 'Female',
          classification: 'P',
          relationship: 'Spouse',
          is_pwd: false,
          philhealth: 'non-member',
        }),
        JSON.stringify({
          risk_score: computedAdd.score,
          risk_level: computedAdd.level,
          risk_factors: computedAdd.factors,
          flags: flagsAdd,
        }),
      ],
    )).rows[0].res;

    assert.equal(addRes.member.name, 'Elena Reyes');
    assert.equal(addRes.household.risk_score, 45);
    assert.equal(addRes.household.risk_level, 'Moderate');
    assert.equal(addRes.household.revision, 2);
    assert.equal(addRes.household.flags.length, 1);

    // Transaction rollback guarantee: if risk update violates CHECK constraint, the member insert MUST roll back too!
    await assert.rejects(
      () => db.query(
        `select public.add_household_member_with_risk($1, $2::jsonb, $3::jsonb)`,
        [
          'HH-PG-1',
          JSON.stringify({ name: 'Should Rollback', age: 70, sex: 'Male', classification: 'SC' }),
          JSON.stringify({ risk_score: 99, risk_level: 'INVALID_LEVEL', risk_factors: [], flags: [] }),
        ],
      ),
    );
    const membersAfterFail = (await db.query(
      `select name from public.household_members where household_id = 'HH-PG-1'`,
    )).rows;
    assert.deepEqual(membersAfterFail, [{ name: 'Elena Reyes' }]);
    const hhAfterFail = (await db.query(
      `select risk_score, risk_level, revision from public.households where id = 'HH-PG-1'`,
    )).rows[0];
    assert.deepEqual(hhAfterFail, { risk_score: 45, risk_level: 'Moderate', revision: 2 });

    // Update member + risk atomically.
    const updRes = (await db.query(
      `select public.update_household_member_with_risk($1, $2::uuid, $3::jsonb, $4::jsonb) as res`,
      [
        'HH-PG-1',
        addRes.member.id,
        JSON.stringify({ is_pwd: true, classification: 'P' }),
        JSON.stringify({ risk_score: 55, risk_level: 'Moderate', risk_factors: ['Updated factor'], flags: [] }),
      ],
    )).rows[0].res;
    assert.equal(updRes.member.is_pwd, true);
    assert.equal(updRes.household.risk_score, 55);
    assert.equal(updRes.household.revision, 3);

    // Remove member + risk atomically.
    const rmRes = (await db.query(
      `select public.remove_household_member_with_risk($1, $2::uuid, $3::jsonb) as res`,
      [
        'HH-PG-1',
        addRes.member.id,
        JSON.stringify({ risk_score: 30, risk_level: 'Low', risk_factors: [], flags: [] }),
      ],
    )).rows[0].res;
    assert.equal(rmRes.removed, true);
    assert.equal(rmRes.household.risk_score, 30);
    assert.equal(rmRes.household.risk_level, 'Low');
    assert.equal(rmRes.household.revision, 4);
    assert.equal((await db.query(`select id from public.household_members`)).rows.length, 0);
  } finally {
    await db.close();
  }
});

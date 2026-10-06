import test from 'node:test';
import assert from 'node:assert/strict';

import * as guardianLinksService from '../src/services/guardianLinks.service.js';
import {
  MINOR_AGE_THRESHOLD,
  GUARDIAN_RELATIONSHIP_TYPES,
  GUARDIAN_LINK_STATUSES,
  isMinorAge,
} from '../src/config/guardianPolicy.js';
import {
  createGuardianLinkValidator,
  reviewGuardianLinkValidator,
  correctGuardianLinkValidator,
} from '../src/validators/guardianLinks.validators.js';
import repository from '../src/repositories/index.js';

const MINOR = {
  id: 'RES-100',
  healthRecordNo: 'RHU-000100',
  firstName: 'Kiko',
  lastName: 'Santos',
  birthDate: '2015-05-01', // ~11 years old
  sex: 'Male',
  barangay: 'San Isidro',
  barangayId: 'BRGY-1',
  municipalityId: 'MUN-1',
  verificationStatus: 'pending',
  authUserId: 'AUTH-KIKO',
};

const ADULT = {
  ...MINOR,
  id: 'RES-200',
  firstName: 'Kiko Adult',
  birthDate: '1990-05-01',
};

const HS_USER = {
  id: 'STAFF-1',
  role: 'health_supervisor',
  name: 'HS Maria',
  barangay: 'San Isidro',
  barangayId: 'BRGY-1',
  municipalityId: 'MUN-1',
};

const HS_OTHER_BARANGAY = {
  ...HS_USER,
  id: 'STAFF-2',
  barangay: 'Poblong',
  barangayId: 'BRGY-2',
};

const PHN_USER = {
  id: 'STAFF-3',
  role: 'phn',
  name: 'PHN Jo',
  municipalityId: 'MUN-1',
};

const BHW_USER = {
  ...HS_USER,
  id: 'STAFF-4',
  role: 'bhw',
};

const RESIDENT_SELF = {
  id: 'AUTH-KIKO',
  role: 'resident',
  name: 'Kiko Santos',
  barangay: 'San Isidro',
  barangayId: 'BRGY-1',
  municipalityId: 'MUN-1',
};

const installRepository = (overrides = {}) => {
  const used = [];
  const fallback = {
    getResident: async (id) => (id === MINOR.id ? { ...MINOR } : id === ADULT.id ? { ...ADULT } : null),
    getResidentByAuthUserId: async (authId) => (authId === 'AUTH-KIKO' ? { ...MINOR } : null),
    searchResidents: async ({ q }) => [
      {
        id: 'RES-300',
        healthRecordNo: 'RHU-000300',
        firstName: 'Liza',
        lastName: 'Santos',
        birthDate: '1985-01-01',
        barangay: 'San Isidro',
      },
    ],
    listResidents: async () => ({ rows: [], total: 0 }),
    getActiveGuardianLinkForMinor: async () => null,
    insertGuardianLink: async (row) => {
      used.push(row);
      return { ...row, id: 'GLINK-1', createdAt: '2026-10-05T00:00:00.000Z' };
    },
    getGuardianLink: async (id) =>
      ({
        id,
        minorResidentId: MINOR.id,
        guardianResidentId: null,
        guardianLastName: 'Santos',
        guardianFirstName: 'Liza',
        guardianMiddleName: 'R.',
        relationshipType: 'mother',
        guardianCellphoneNo: '09171234567',
        guardianIdentityNo: '',
        consentRecorded: true,
        consentNote: 'Consent explained to mother.',
        verificationStatus: 'pending_verification',
        verificationNote: '',
        verifiedByName: null,
        verifiedByRole: null,
        verifiedAt: null,
        createdByName: 'HS Maria',
        createdByRole: 'health_supervisor',
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      }),
    listGuardianLinksForMinor: async () => [
      {
        id: 'GLINK-1',
        minorResidentId: MINOR.id,
        guardianResidentId: null,
        guardianLastName: 'Santos',
        guardianFirstName: 'Liza',
        guardianMiddleName: 'R.',
        relationshipType: 'mother',
        guardianCellphoneNo: '09171234567',
        guardianIdentityNo: '',
        consentRecorded: true,
        consentNote: '',
        verificationStatus: 'pending_verification',
        verificationNote: '',
        verifiedByName: null,
        verifiedByRole: null,
        verifiedAt: null,
        createdByName: 'HS Maria',
        createdByRole: 'health_supervisor',
        createdAt: '2026-10-05T00:00:00.000Z',
        updatedAt: '2026-10-05T00:00:00.000Z',
      },
    ],
    updateGuardianLink: async (id, patch) => ({
      id,
      minorResidentId: MINOR.id,
      guardianResidentId: null,
      guardianLastName: 'Santos',
      guardianFirstName: 'Liza',
      guardianMiddleName: 'R.',
      relationshipType: 'mother',
      guardianCellphoneNo: '09171234567',
      guardianIdentityNo: '',
      consentRecorded: true,
      consentNote: '',
      verificationStatus: 'pending_verification',
      verificationNote: '',
      verifiedByName: null,
      verifiedByRole: null,
      verifiedAt: null,
      ...patch,
    }),
    updateResident: async (id, patch) => ({ id, ...patch }),
  };
  const merged = { ...fallback, ...overrides };
  const keys = Object.keys(merged);
  const originals = {};
  for (const key of keys) {
    originals[key] = repository[key];
    repository[key] = merged[key];
  }
  return {
    used,
    restore: () => {
      for (const key of keys) {
        if (originals[key] === undefined) delete repository[key];
        else repository[key] = originals[key];
      }
    },
  };
};

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test('isMinorAge: 18 is the exclusive threshold', () => {
  const year = new Date().getFullYear();
  assert.equal(isMinorAge(`${year - MINOR_AGE_THRESHOLD}-01-01`), false, 'exactly 18 is not a minor');
  assert.equal(isMinorAge(`${year - MINOR_AGE_THRESHOLD + 1}-01-01`), true, '17 is a minor');
  assert.equal(isMinorAge('2015-05-01'), true, 'child is a minor');
  assert.equal(isMinorAge('1990-01-01'), false, 'adult is not a minor');
  assert.equal(isMinorAge('not-a-date'), false, 'invalid date is not treated as minor');
  assert.equal(MINOR_AGE_THRESHOLD, 18);
  assert.deepEqual([...GUARDIAN_LINK_STATUSES], ['pending_verification', 'verified', 'rejected']);
});

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

test('createGuardianLinkValidator accepts a valid minor guardian payload', () => {
  const result = createGuardianLinkValidator({
    minorResidentId: 'RES-100',
    relationshipType: 'mother',
    guardianLastName: 'Santos',
    guardianFirstName: 'Liza',
    guardianCellphoneNo: '09171234567',
    consentRecorded: true,
  });
  assert.equal(result.error, undefined, JSON.stringify(result));
  assert.equal(result.value.guardianLink.relationshipType, 'mother');
});

test('createGuardianLinkValidator rejects missing guardian details', () => {
  const result = createGuardianLinkValidator({ minorResidentId: 'RES-100', relationshipType: 'mother' });
  assert.ok(result.error);
  assert.ok(result.error.guardianLastName);
  assert.ok(result.error.guardianFirstName);
});

test('createGuardianLinkValidator rejects invalid relationship type and bad mobile', () => {
  const result = createGuardianLinkValidator({
    minorResidentId: 'RES-100',
    relationshipType: 'best_friend',
    guardianLastName: 'Santos',
    guardianFirstName: 'Liza',
    guardianCellphoneNo: '01234',
  });
  assert.ok(result.error.relationshipType);
  assert.ok(result.error.guardianCellphoneNo);
});

test('reviewGuardianLinkValidator requires a reason on rejection', () => {
  const ok = reviewGuardianLinkValidator({ decision: 'verified', note: 'Confirmed in person.' });
  assert.equal(ok.error, undefined);
  const rejected = reviewGuardianLinkValidator({ decision: 'rejected', note: ' ' });
  assert.ok(rejected.error.note);
  const badDecision = reviewGuardianLinkValidator({ decision: 'maybe' });
  assert.ok(badDecision.error.decision);
});

test('correctGuardianLinkValidator rejects empty corrections', () => {
  const result = correctGuardianLinkValidator({});
  assert.ok(result.error);
});

// ---------------------------------------------------------------------------
// Service — creation
// ---------------------------------------------------------------------------

test('health supervisor in scope creates a pending guardian link', async () => {
  const { restore } = installRepository();
  try {
    const link = await guardianLinksService.createGuardianLink({
      user: HS_USER,
      payload: {
        minorResidentId: 'RES-100',
        relationshipType: 'mother',
        guardianLastName: 'Santos',
        guardianFirstName: 'Liza',
        guardianMiddleName: 'R.',
        guardianCellphoneNo: '09171234567',
        consentRecorded: true,
        consentNote: 'Consent explained to mother.',
      },
    });
    assert.equal(link.verificationStatus, 'pending_verification');
    assert.equal(link.minorResidentId, 'RES-100');
    assert.equal(link.relationshipLabel, 'Mother');
    assert.equal(link.verifiedBy, null, 'a created link is never auto-verified');
  } finally {
    restore();
  }
});

test('self-reference (guardian === minor) is rejected', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: HS_USER,
        payload: {
          minorResidentId: 'RES-100',
          relationshipType: 'legal_guardian',
          guardianResidentId: 'RES-100',
          guardianLastName: 'Santos',
          guardianFirstName: 'Kiko',
        },
      }),
      (err) => err.statusCode === 422 && /same record/.test(err.message),
    );
  } finally {
    restore();
  }
});

test('an adult cannot have a guardian link', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: HS_USER,
        payload: {
          minorResidentId: 'RES-200',
          relationshipType: 'mother',
          guardianLastName: 'Santos',
          guardianFirstName: 'Liza',
        },
      }),
      (err) => err.statusCode === 422 && /not a minor/.test(err.message),
    );
  } finally {
    restore();
  }
});

test('a health supervisor cannot link a minor outside their barangay', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: HS_OTHER_BARANGAY,
        payload: {
          minorResidentId: 'RES-100',
          relationshipType: 'mother',
          guardianLastName: 'Santos',
          guardianFirstName: 'Liza',
        },
      }),
      (err) => err.statusCode === 403,
    );
  } finally {
    restore();
  }
});

test('a resident role outside the allowed set cannot create links', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: { ...HS_USER, role: 'rhu_personnel' },
        payload: {
          minorResidentId: 'RES-100',
          relationshipType: 'mother',
          guardianLastName: 'Santos',
          guardianFirstName: 'Liza',
        },
      }),
      (err) => err.statusCode === 403,
    );
  } finally {
    restore();
  }
});

test('the minor own account can link only their own record', async () => {
  const OTHER_MINOR = { ...MINOR, id: 'RES-101', authUserId: 'AUTH-OTHER' };
  const { restore } = installRepository({
    getResidentByAuthUserId: async (authId) =>
      authId === 'AUTH-KIKO' ? { ...MINOR } : authId === 'AUTH-OTHER' ? { ...OTHER_MINOR } : null,
    getResident: async (id) => {
      if (id === MINOR.id) return { ...MINOR };
      if (id === OTHER_MINOR.id) return { ...OTHER_MINOR };
      if (id === ADULT.id) return { ...ADULT };
      return null;
    },
  });
  try {
    // Own record: allowed.
    const own = await guardianLinksService.createGuardianLink({
      user: RESIDENT_SELF,
      payload: {
        minorResidentId: 'RES-100',
        relationshipType: 'mother',
        guardianLastName: 'Santos',
        guardianFirstName: 'Liza',
      },
    });
    assert.equal(own.minorResidentId, 'RES-100');
    assert.equal(own.verificationStatus, 'pending_verification');

    // Someone else's minor: forbidden (the link is always derived from the
    // caller's own account, so the payload id can never widen the target).
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: { ...RESIDENT_SELF, id: 'AUTH-OTHER', role: 'resident-limited' },
        payload: {
          minorResidentId: 'RES-100',
          relationshipType: 'mother',
          guardianLastName: 'Santos',
          guardianFirstName: 'Liza',
        },
      }),
      (err) => err.statusCode === 403,
    );
  } finally {
    restore();
  }
});

test('an existing active link blocks a second different link (409)', async () => {
  const { restore } = installRepository({
    getActiveGuardianLinkForMinor: async () => ({
      id: 'GLINK-0',
      minorResidentId: MINOR.id,
      guardianLastName: 'Santos',
      guardianFirstName: 'Liza',
      guardianResidentId: null,
    }),
  });
  try {
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: HS_USER,
        payload: {
          minorResidentId: 'RES-100',
          relationshipType: 'mother',
          guardianLastName: 'Reyes',
          guardianFirstName: 'Ming',
        },
      }),
      (err) => err.statusCode === 409,
    );
  } finally {
    restore();
  }
});

test('re-creating the SAME active link is idempotent (returns existing)', async () => {
  const { restore } = installRepository({
    getActiveGuardianLinkForMinor: async () => ({
      id: 'GLINK-EXISTING',
      minorResidentId: MINOR.id,
      guardianLastName: 'Santos',
      guardianFirstName: 'Liza',
      guardianResidentId: null,
    }),
  });
  try {
    const link = await guardianLinksService.createGuardianLink({
      user: HS_USER,
      payload: {
        minorResidentId: 'RES-100',
        relationshipType: 'mother',
        guardianLastName: 'Santos',
        guardianFirstName: 'Liza',
      },
    });
    assert.equal(link.id, 'GLINK-EXISTING');
  } finally {
    restore();
  }
});

test('linking an existing resident requires a matching last name', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.createGuardianLink({
        user: HS_USER,
        payload: {
          minorResidentId: 'RES-100',
          relationshipType: 'father',
          guardianResidentId: 'RES-200',
          guardianLastName: 'Aguirre', // does not match RES-200 (Santos)
          guardianFirstName: 'Kiko Adult',
        },
      }),
      (err) => err.statusCode === 422 && /must match/.test(err.message),
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Service — review & correction
// ---------------------------------------------------------------------------

test('health supervisor verifies a pending link with full audit fields', async () => {
  const { restore } = installRepository();
  try {
    const link = await guardianLinksService.reviewGuardianLink({
      user: HS_USER,
      linkId: 'GLINK-1',
      decision: 'verified',
      note: 'Confirmed with barangay blgko.',
    });
    assert.equal(link.verificationStatus, 'verified');
    assert.equal(link.verifiedBy, 'HS Maria');
    assert.equal(link.verifiedByRole, 'health_supervisor');
    assert.ok(link.verifiedAt);
  } finally {
    restore();
  }
});

test('rejecting a link requires a substantive reason', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.reviewGuardianLink({
        user: HS_USER,
        linkId: 'GLINK-1',
        decision: 'rejected',
        note: 'ok',
      }),
      (err) => err.statusCode === 422 && /reason/i.test(err.message),
    );
    const rejected = await guardianLinksService.reviewGuardianLink({
      user: HS_USER,
      linkId: 'GLINK-1',
      decision: 'rejected',
      note: 'Name does not match barangay records.',
    });
    assert.equal(rejected.verificationStatus, 'rejected');
  } finally {
    restore();
  }
});

test('BHW and resident roles cannot review links', async () => {
  const { restore } = installRepository();
  try {
    await assert.rejects(
      guardianLinksService.reviewGuardianLink({ user: BHW_USER, linkId: 'GLINK-1', decision: 'verified' }),
      (err) => err.statusCode === 403,
    );
    await assert.rejects(
      guardianLinksService.reviewGuardianLink({
        user: RESIDENT_SELF,
        linkId: 'GLINK-1',
        decision: 'verified',
      }),
      (err) => err.statusCode === 403,
    );
  } finally {
    restore();
  }
});

test('PHN may correct relationship details on an in-scope link', async () => {
  const { restore } = installRepository();
  try {
    const link = await guardianLinksService.correctGuardianLink({
      user: PHN_USER,
      linkId: 'GLINK-1',
      payload: { relationshipType: 'legal_guardian', guardianCellphoneNo: '09170000000' },
    });
    assert.equal(link.relationshipType, 'legal_guardian');
    assert.equal(link.guardianCellphoneNo, '09170000000');
    assert.equal(link.verificationStatus, 'pending_verification', 'correction does not change status');
  } finally {
    restore();
  }
});

test('listing a minor guardian links is scope-checked', async () => {
  const { restore } = installRepository();
  try {
    const links = await guardianLinksService.listGuardianLinksForMinor({ user: HS_USER, minorResidentId: 'RES-100' });
    assert.equal(links.length, 1);
    assert.equal(links[0].id, 'GLINK-1');
    await assert.rejects(
      guardianLinksService.listGuardianLinksForMinor({ user: HS_OTHER_BARANGAY, minorResidentId: 'RES-100' }),
      (err) => err.statusCode === 403,
    );
  } finally {
    restore();
  }
});

// ---------------------------------------------------------------------------
// Service — candidate search
// ---------------------------------------------------------------------------

test('staff candidate search is barangay-scoped and display-safe', async () => {
  const { restore } = installRepository({
    searchResidents: async ({ q, limit }) => {
      assert.ok(q.length >= 2);
      assert.equal(limit, 10);
      return [
        {
          id: 'RES-300',
          healthRecordNo: 'RHU-000300',
          firstName: 'Liza',
          lastName: 'Santos',
          birthDate: '1985-01-01',
          barangay: 'San Isidro',
        },
      ];
    },
  });
  try {
    const results = await guardianLinksService.searchGuardianCandidates({ user: HS_USER, q: 'santos' });
    assert.equal(results.length, 1);
    assert.equal(results[0].name, 'Liza Santos');
    assert.equal(results[0].address, undefined, 'address is not exposed in candidate results');
  } finally {
    restore();
  }
});

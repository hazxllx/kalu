/**
 * Local development seed data.
 *
 * Loads fabricated residents and sample submissions into the JSON file store
 * on first boot (file driver only, store empty). These are NOT real people —
 * the same fictional directory used by the rest of the development UI. Real
 * (Supabase) environments seed through database/seeds instead.
 */
import env from '../config/env.js';
import store from '../repositories/fileStore.js';
import { computeBMI } from '../utils/bmi.js';
import { residentId, healthRecordNo, submissionId } from '../repositories/ids.js';
import { SUBMISSION_STATUS } from '../config/facility.js';

const now = new Date().toISOString();

const residentSeed = (n, fields) => ({
  id: residentId(n),
  healthRecordNo: healthRecordNo(n),
  createdAt: now,
  updatedAt: now,
  ...fields,
});

const SEED_RESIDENTS = [
  residentSeed(1, {
    lastName: 'Santos', firstName: 'Maria', middleName: 'Reyes', suffix: '',
    birthDate: '1992-05-14', birthPlace: 'Pili, Camarines Sur', sex: 'Female',
    civilStatus: 'Single', religion: 'Roman Catholic', employmentStatus: 'Employed',
    fatherName: 'Ramon Santos', motherName: 'Elena Reyes Santos', is4PsMember: false,
    philhealthNo: '12-345678901-2', currentAddress: 'Zone 3, San Jose, Pili, Camarines Sur',
    permanentAddress: 'Zone 3, San Jose, Pili, Camarines Sur', cellphoneNo: '0917 123 4567',
    identityNo: '', barangay: 'San Jose',
  }),
  residentSeed(2, {
    lastName: 'Dela Cruz', firstName: 'Juan', middleName: 'Santos', suffix: '',
    birthDate: '1985-03-09', birthPlace: 'Calabanga, Camarines Sur', sex: 'Male',
    civilStatus: 'Married', religion: 'Roman Catholic', employmentStatus: 'Employed',
    fatherName: 'Pedro Dela Cruz', motherName: 'Rosario Santos Dela Cruz', is4PsMember: true,
    philhealthNo: '11-223344556-7', currentAddress: 'Zone 1, San Jose, Pili, Camarines Sur',
    permanentAddress: 'Calabanga, Camarines Sur', cellphoneNo: '0918 234 5678',
    identityNo: '', barangay: 'San Jose',
  }),
  residentSeed(3, {
    lastName: 'Aquino', firstName: 'Grace', middleName: 'Lim', suffix: '',
    birthDate: '1999-11-20', birthPlace: 'Pili, Camarines Sur', sex: 'Female',
    civilStatus: 'Single', religion: 'Roman Catholic', employmentStatus: 'Student',
    fatherName: 'Danilo Aquino', motherName: 'Melanie Lim Aquino', is4PsMember: true,
    philhealthNo: '', currentAddress: 'Sitio Maligaya, Cadlan, Pili, Camarines Sur',
    permanentAddress: 'Sitio Maligaya, Cadlan, Pili, Camarines Sur', cellphoneNo: '0919 345 6789',
    identityNo: '', barangay: 'Cadlan',
  }),
  residentSeed(4, {
    lastName: 'Aguilar', firstName: 'Roberto', middleName: 'Bautista', suffix: '',
    birthDate: '1968-02-17', birthPlace: 'Naga City, Camarines Sur', sex: 'Male',
    civilStatus: 'Married', religion: 'Roman Catholic', employmentStatus: 'Self-Employed',
    fatherName: 'Tomas Aguilar', motherName: 'Leticia Bautista Aguilar', is4PsMember: false,
    philhealthNo: '12-998877665-4', currentAddress: 'Purok 5, Cadlan, Pili, Camarines Sur',
    permanentAddress: 'Purok 5, Cadlan, Pili, Camarines Sur', cellphoneNo: '0920 456 7890',
    identityNo: '', barangay: 'Cadlan',
  }),
  residentSeed(5, {
    lastName: 'Mendoza', firstName: 'Lourdes', middleName: 'Ramos', suffix: '',
    birthDate: '1963-08-30', birthPlace: 'Talisay, Pili, Camarines Sur', sex: 'Female',
    civilStatus: 'Widowed', religion: 'Roman Catholic', employmentStatus: 'Retired',
    fatherName: 'Benigno Ramos', motherName: 'Consuelo Ramos', is4PsMember: true,
    philhealthNo: '13-445566778-9', currentAddress: 'Zone 2, Talisay, Pili, Camarines Sur',
    permanentAddress: 'Zone 2, Talisay, Pili, Camarines Sur', cellphoneNo: '0921 567 8901',
    identityNo: '', barangay: 'Talisay',
  }),
];

const buildVitals = (vitals) => {
  const { bmi } = computeBMI(vitals.heightCm, vitals.weightKg);
  return { ...vitals, bmi };
};

const SEED_VISITS = [
  {
    residentId: residentId(1),
    recordedById: 'dev-bhw', recordedByRole: 'bhw', recordedByName: 'Maria Cruz',
    status: SUBMISSION_STATUS.SUBMITTED,
    visitDate: '2026-08-20T01:45:00.000Z',
    chiefComplaint: 'Request for laboratory examination (CBC) — pallor, easy fatigability',
    clinicalHistory:
      'Patient reports progressive fatigue over the past month, occasional dizziness and pale appearance. ' +
      'No active bleeding. Menstrual history: regular. Dietary history: inadequate iron intake.',
    findings:
      'Pale conjunctivae and nail beds. Tachycardic on exertion. Lungs clear. Abdomen soft, non-tender. ' +
      'No jaundice or petechiae.',
    treatmentGiven: 'Ferrous sulfate 60 mg once a day x 30 days; advised dietary iron sources.',
    recommendation: 'CBC and peripheral smear. Return for follow-up with results.',
    vitals: buildVitals({ bp: '110/70', hr: 76, rr: 18, o2sat: 98, temperature: 36.5, heightCm: 158, weightKg: 55 }),
    submittedAt: '2026-08-20T02:00:00.000Z',
    createdAt: '2026-08-20T01:45:00.000Z', updatedAt: '2026-08-20T02:00:00.000Z',
  },
  {
    residentId: residentId(2),
    recordedById: 'dev-rhu_personnel', recordedByRole: 'rhu_personnel', recordedByName: 'Antonio Reyes',
    status: SUBMISSION_STATUS.SUBMITTED,
    visitDate: '2026-08-22T00:30:00.000Z',
    chiefComplaint: 'Recurrent epigastric pain with heartburn',
    clinicalHistory:
      'Burning epigastric pain for 3 weeks, worse after meals and at night. Relieved temporarily by antacids. ' +
      'No hematemesis or melena. Smoker, 10 sticks/day. Occasional alcohol intake.',
    findings:
      'Mild epigastric tenderness on palpation. No palpable mass or organomegaly. Bowel sounds normal.',
    treatmentGiven: 'Omeprazole 20 mg once daily before breakfast x 14 days. Advised smoking cessation.',
    recommendation: 'Reassess after 2 weeks. Consider H. pylori testing / upper endoscopy if symptoms persist.',
    vitals: buildVitals({ bp: '120/80', hr: 82, rr: 20, o2sat: 97, temperature: 36.8, heightCm: 170, weightKg: 72 }),
    submittedAt: '2026-08-22T00:45:00.000Z',
    createdAt: '2026-08-22T00:30:00.000Z', updatedAt: '2026-08-22T00:45:00.000Z',
  },
];

export const seedLocalDataIfEmpty = async () => {
  if (env.isSupabaseConfigured) return { seeded: false, reason: 'supabase-driver' };
  if (store.residents.length > 0) return { seeded: false, reason: 'already-has-data' };

  const result = await store.mutate((data) => {
    SEED_RESIDENTS.forEach((resident) => data.residents.push(JSON.parse(JSON.stringify(resident))));
    SEED_VISITS.forEach((visit, index) => {
      const id = submissionId(index + 1);
      data.visits.push({ id, createdAt: now, updatedAt: now, ...visit });
    });
    data.counters = {
      residents: SEED_RESIDENTS.length,
      submissions: SEED_VISITS.length,
      referrals: 0,
    };
    return { seeded: true };
  });
  return result;
};

export default { seedLocalDataIfEmpty };

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
  // San Isidro — the barangay assigned to the Health Supervisor demo account.
  residentSeed(6, {
    lastName: 'Reyes', firstName: 'Carmen', middleName: 'Fuentes', suffix: '',
    birthDate: '1968-06-02', birthPlace: 'Pili, Camarines Sur', sex: 'Female',
    civilStatus: 'Married', religion: 'Roman Catholic', employmentStatus: 'Retired',
    fatherName: 'Ernesto Fuentes', motherName: 'Lourdes Bautista', is4PsMember: true,
    philhealthNo: '14-556677889-0', currentAddress: 'Purok 2, San Isidro, Pili, Camarines Sur',
    permanentAddress: 'Purok 2, San Isidro, Pili, Camarines Sur', cellphoneNo: '0922 678 9012',
    identityNo: '', barangay: 'San Isidro',
  }),
  residentSeed(7, {
    lastName: 'Villanueva', firstName: 'Rodolfo', middleName: 'Dela Peña', suffix: '',
    birthDate: '1979-01-25', birthPlace: 'Pili, Camarines Sur', sex: 'Male',
    civilStatus: 'Married', religion: 'Roman Catholic', employmentStatus: 'Employed',
    fatherName: 'Felix Villanueva', motherName: 'Norma Dela Peña', is4PsMember: false,
    philhealthNo: '14-667788990-1', currentAddress: 'Purok 4, San Isidro, Pili, Camarines Sur',
    permanentAddress: 'Purok 4, San Isidro, Pili, Camarines Sur', cellphoneNo: '0923 789 0123',
    identityNo: '', barangay: 'San Isidro',
  }),
  residentSeed(8, {
    lastName: 'Fuentes', firstName: 'Teresa', middleName: 'Amor', suffix: '',
    birthDate: '1995-09-12', birthPlace: 'Pili, Camarines Sur', sex: 'Female',
    civilStatus: 'Married', religion: 'Roman Catholic', employmentStatus: 'Employed',
    fatherName: 'Danilo Amor', motherName: 'Sofia Cruz Amor', is4PsMember: true,
    philhealthNo: '14-778899001-2', currentAddress: 'Purok 1, San Isidro, Pili, Camarines Sur',
    permanentAddress: 'Purok 1, San Isidro, Pili, Camarines Sur', cellphoneNo: '0924 890 1234',
    identityNo: '', barangay: 'San Isidro',
  }),
];

/**
 * Pending resident verifications. San Isidro requests belong to the Health
 * Supervisor demo account (assigned to San Isidro — see config/devAccounts);
 * the San Jose entry must never be visible to that account.
 */
const verificationSeed = (fields) => ({
  status: 'Pending',
  decision: null,
  ...fields,
});

export const SEED_VERIFICATIONS = [
  verificationSeed({
    ref: 'KSG-2026-00428', name: 'Juan Dela Cruz Reyes', barangay: 'San Isidro',
    registeredDate: '2026-07-05', contactNumber: '0917 123 4567', birthDate: '1994-03-14',
    sex: 'Male', civilStatus: 'Married', address: 'Barangay San Isidro, Pili, Camarines Sur',
    residencyStatus: 'Verified Resident', lengthOfResidency: '8 years', householdId: 'HH-2026-0184',
    proofDocument: 'Barangay Certificate of Residency',
  }),
  verificationSeed({
    ref: 'KSG-2026-00427', name: 'Maria Santos Lopez', barangay: 'San Isidro',
    registeredDate: '2026-07-04', contactNumber: '0918 234 5678', birthDate: '1990-11-02',
    sex: 'Female', civilStatus: 'Married', address: 'Purok 3, Barangay San Isidro, Pili, Camarines Sur',
    residencyStatus: 'Verified Resident', lengthOfResidency: '12 years', householdId: 'HH-2026-0184',
    proofDocument: 'Barangay Certificate of Residency',
  }),
  verificationSeed({
    ref: 'KSG-2026-00425', name: 'Roberto Aguilar Cruz', barangay: 'San Isidro',
    registeredDate: '2026-07-04', contactNumber: '0919 345 6789', birthDate: '1978-05-21',
    sex: 'Male', civilStatus: 'Widowed', address: 'Purok 5, Barangay San Isidro, Pili, Camarines Sur',
    residencyStatus: 'Verified Resident', lengthOfResidency: '15 years', householdId: 'HH-2026-0201',
    proofDocument: 'Barangay Certificate of Residency',
  }),
  verificationSeed({
    ref: 'KSG-2026-00421', name: 'Ana Patricia Lim', barangay: 'San Isidro',
    registeredDate: '2026-07-03', contactNumber: '0920 456 7890', birthDate: '1998-08-17',
    sex: 'Female', civilStatus: 'Single', address: 'Purok 1, Barangay San Isidro, Pili, Camarines Sur',
    residencyStatus: 'Verified Resident', lengthOfResidency: '4 years', householdId: 'HH-2026-0212',
    proofDocument: 'Barangay Certificate of Residency',
  }),
  verificationSeed({
    ref: 'KSG-2026-00419', name: 'Fernando Garcia Jr.', barangay: 'San Isidro',
    registeredDate: '2026-07-03', contactNumber: '0921 567 8901', birthDate: '1985-02-09',
    sex: 'Male', civilStatus: 'Married', address: 'Purok 2, Barangay San Isidro, Pili, Camarines Sur',
    residencyStatus: 'Verified Resident', lengthOfResidency: '6 years', householdId: 'HH-2026-0095',
    proofDocument: 'Barangay Certificate of Residency',
  }),
  verificationSeed({
    ref: 'KSG-2026-00416', name: 'Elena Bautista Ramos', barangay: 'San Jose',
    registeredDate: '2026-07-02', contactNumber: '0922 678 9012', birthDate: '1972-09-30',
    sex: 'Female', civilStatus: 'Married', address: 'Zone 4, Barangay San Jose, Pili, Camarines Sur',
    residencyStatus: 'Verified Resident', lengthOfResidency: '20 years', householdId: 'HH-2026-0033',
    proofDocument: 'Barangay Certificate of Residency',
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
  {
    residentId: residentId(6),
    recordedById: 'dev-health_supervisor', recordedByRole: 'health_supervisor', recordedByName: 'Maria Dela Cruz',
    status: SUBMISSION_STATUS.SUBMITTED,
    visitDate: '2026-08-28T08:30:00.000Z',
    chiefComplaint: 'Hypertension follow-up — elevated blood pressure reading',
    clinicalHistory:
      'Known hypertensive on maintenance amlodipine 10 mg daily. Reports occasional headache and dizziness ' +
      'in the mornings. Non-smoker, occasional salty diet.',
    findings: 'BP elevated at 152/94 mmHg. Cardiac rate regular. No edema. Lungs clear.',
    treatmentGiven: 'Continued amlodipine; low-sodium diet counseling; BP monitoring twice weekly.',
    recommendation: 'Home BP log. Return in 2 weeks or sooner if BP exceeds 160/100.',
    vitals: buildVitals({ bp: '152/94', hr: 88, rr: 18, o2sat: 98, temperature: 36.6, heightCm: 152, weightKg: 62 }),
    submittedAt: '2026-08-28T08:50:00.000Z',
    createdAt: '2026-08-28T08:30:00.000Z', updatedAt: '2026-08-28T08:50:00.000Z',
  },
  {
    residentId: residentId(7),
    recordedById: 'dev-health_supervisor', recordedByRole: 'health_supervisor', recordedByName: 'Maria Dela Cruz',
    status: SUBMISSION_STATUS.SUBMITTED,
    visitDate: '2026-08-30T09:00:00.000Z',
    chiefComplaint: 'Diabetes monitoring — medication refill and counseling',
    clinicalHistory:
      'Type 2 diabetes mellitus diagnosed 4 years ago, on metformin 500 mg twice daily. Reports good ' +
      'compliance. Occasional numbness of both feet.',
    findings: 'BP 132/84 mmHg. No wounds on both feet; diminished sensation to light touch distally.',
    treatmentGiven: 'Metformin refill; foot care counseling; advised daily walking.',
    recommendation: 'Fasting blood sugar and HbA1c on next visit. Annual eye exam reminder.',
    vitals: buildVitals({ bp: '132/84', hr: 80, rr: 18, o2sat: 98, temperature: 36.7, heightCm: 165, weightKg: 78 }),
    submittedAt: '2026-08-30T09:20:00.000Z',
    createdAt: '2026-08-30T09:00:00.000Z', updatedAt: '2026-08-30T09:20:00.000Z',
  },
  {
    residentId: residentId(8),
    recordedById: 'dev-health_supervisor', recordedByRole: 'health_supervisor', recordedByName: 'Maria Dela Cruz',
    status: SUBMISSION_STATUS.SUBMITTED,
    visitDate: '2026-09-02T10:00:00.000Z',
    chiefComplaint: 'Prenatal check-up, second trimester',
    clinicalHistory: 'G2P1, LMP approximately 19 weeks ago. Taking prenatal vitamins. No bleeding or contractions.',
    findings: 'BP 118/76 mmHg. Fundic height consistent with dates. Fetal heart tones positive.',
    treatmentGiven: 'Prenatal vitamins continued; iron and folate supplementation; tetanus toxoid schedule reviewed.',
    recommendation: 'Monthly prenatal visit; ultrasound at 24 weeks.',
    vitals: buildVitals({ bp: '118/76', hr: 84, rr: 18, o2sat: 99, temperature: 36.5, heightCm: 157, weightKg: 58 }),
    submittedAt: '2026-09-02T10:25:00.000Z',
    createdAt: '2026-09-02T10:00:00.000Z', updatedAt: '2026-09-02T10:25:00.000Z',
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
    SEED_VERIFICATIONS.forEach((verification) => data.verifications.push(JSON.parse(JSON.stringify(verification))));
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

// DEVELOPMENT-ONLY fake data. Clinical records — Health Supervisor / PHN only.
// Never visible to BHW; a resident sees only their own record.

export const mockHealthRecords = [
  { id: 'HR-0001', residentId: 'RES-0001', bp: '118/76', weight: 55, notes: 'Prenatal check-up, normal', updated: '2026-06-02' },
  { id: 'HR-0002', residentId: 'RES-0004', bp: '150/95', weight: 78, notes: 'Hypertension follow-up, medication continued', updated: '2026-06-18' },
];

export default mockHealthRecords;

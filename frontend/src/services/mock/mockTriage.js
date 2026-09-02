// DEVELOPMENT-ONLY fake data. Triage queue — RHU Personnel (and Health
// Supervisor). Workflow: triage -> nurse/midwife consultation.

export const mockTriage = [
  { id: 'TRG-0001', residentId: 'RES-0004', priority: 'Urgent', chiefComplaint: 'Elevated BP, headache', status: 'Waiting', arrived: '2026-07-10 09:12' },
  { id: 'TRG-0002', residentId: 'RES-0003', priority: 'Routine', chiefComplaint: 'Prenatal visit', status: 'Routed to consultation', arrived: '2026-07-10 09:40' },
];

export default mockTriage;

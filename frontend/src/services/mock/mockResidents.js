// DEVELOPMENT-ONLY fake data. Not real people. Frontend testing only.
// Resident directory — visible to Health Supervisor / PHN / MHO. NOT to BHW.

export const mockResidents = [
  { id: 'RES-0001', name: 'Maria Santos', barangay: 'San Jose', age: 34, sex: 'F', risk: 'Low', verified: true, householdId: 'HH-0001' },
  { id: 'RES-0002', name: 'Juan Dela Cruz', barangay: 'San Jose', age: 41, sex: 'M', risk: 'Medium', verified: true, householdId: 'HH-0001' },
  { id: 'RES-0003', name: 'Grace Aquino', barangay: 'Cadlan', age: 27, sex: 'F', risk: 'Low', verified: false, householdId: 'HH-0002' },
  { id: 'RES-0004', name: 'Roberto Aguilar', barangay: 'Cadlan', age: 58, sex: 'M', risk: 'High', verified: true, householdId: 'HH-0002' },
  { id: 'RES-0005', name: 'Lourdes Mendoza', barangay: 'Talisay', age: 63, sex: 'F', risk: 'Medium', verified: true, householdId: 'HH-0003' },
];

export default mockResidents;

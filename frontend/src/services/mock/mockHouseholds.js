// DEVELOPMENT-ONLY fake data. Household/community profiling — the data BHW
// collects. Contains no personal clinical records (those are separate and not
// visible to BHW).

export const mockHouseholds = [
  { id: 'HH-0001', address: '12 Purok 1, San Isidro', members: 5, waterSource: 'Level II (communal faucet)', toilet: 'Water-sealed', concerns: ['Hypertension', 'WASH'] },
  { id: 'HH-0002', address: '7 Purok 3, San Antonio', members: 4, waterSource: 'Level I (point source)', toilet: 'Shared', concerns: ['Sanitation', 'Nutrition'] },
  { id: 'HH-0003', address: '21 Purok 2, Old San Roque', members: 6, waterSource: 'Level III (piped)', toilet: 'Water-sealed', concerns: ['Senior care'] },
];

export default mockHouseholds;

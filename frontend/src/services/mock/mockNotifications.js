// DEVELOPMENT-ONLY fake data. Minimal cross-role notifications sample.
// (The dashboard shell reads richer per-role samples from `notificationData.js`;
// this is the small, structured set referenced by PHASE 13.)

export const mockNotifications = [
  { id: 'NTF-0001', role: 'resident', title: 'Follow-up reminder', body: 'BP monitoring on Aug 15 at the Barangay Health Center.', read: false },
  { id: 'NTF-0002', role: 'health_supervisor', title: 'New verification request', body: 'Grace Aquino submitted registration for review.', read: false },
  { id: 'NTF-0003', role: 'rhu_personnel', title: 'Triage queue', body: '1 urgent case waiting to be assessed.', read: false },
];

export default mockNotifications;

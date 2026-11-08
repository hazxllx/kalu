const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizeResident = (row) => {
  if (!row?.id) return null;
  const birthDate = row.birthDate || row.birth_date || '';
  const birth = birthDate ? new Date(`${birthDate.slice(0, 10)}T00:00:00`) : null;
  const now = new Date();
  let age = row.age ?? '';
  if (age === '' && birth && !Number.isNaN(birth.getTime())) {
    age = now.getFullYear() - birth.getFullYear();
    if (now.getMonth() < birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() < birth.getDate())) age -= 1;
    if (age < 0) age = '';
  }
  return {
    ...row,
    id: String(row.id),
    name: row.name || [row.firstName || row.first_name, row.middleName || row.middle_name, row.lastName || row.last_name, row.suffix].filter(Boolean).join(' ').trim(),
    age,
    birthDate,
    gender: row.gender || row.sex || '',
    barangay: row.barangay || '',
    barangayId: row.barangayId || row.barangay_id || null,
  };
};

export const normalizeTcl = (row) => {
  if (!row?.id || !(row.residentId || row.resident_id) || !String(row.program || '').trim()) throw new Error('The server returned an incomplete TCL record.');
  const assignment = String(row.assigned_bhw || '');
  return {
    ...row,
    id: String(row.id),
    residentId: String(row.residentId || row.resident_id),
    resident: normalizeResident(row.resident),
    bhwId: row.assignedBhwId || row.assigned_bhw_id || (uuid.test(assignment) ? assignment : ''),
    bhw: row.assignedBhwName || row.assigned_bhw_name || (!uuid.test(assignment) ? assignment : ''),
    lastVisit: row.last_visit || '',
    nextVisit: row.next_visit || '',
    nextVisitTime: row.next_visit_time || '',
  };
};

export const workersForResident = (workers, resident) => resident?.barangayId
  ? workers.filter((worker) => worker.role === 'bhw' && worker.barangayId === resident.barangayId)
  : [];

/** Registry identity is selected by ID, including residents beyond page one. */
export const loadResidentDirectory = async (list) => {
  const residents = new Map();
  const limit = 100;
  for (let offset = 0; ; offset += limit) {
    const result = await list({ limit, offset });
    const rows = Array.isArray(result) ? result : result?.rows;
    if (!Array.isArray(rows)) throw new Error('The resident directory response was incomplete.');
    const previousSize = residents.size;
    rows.forEach((row) => {
      const resident = normalizeResident(row);
      if (!resident) throw new Error('The resident directory returned a record without a stable identity.');
      residents.set(resident.id, resident);
    });
    if (rows.length < limit && Number(result?.total) > offset + rows.length) throw new Error('The resident directory response was incomplete.');
    if (rows.length < limit || (Number.isFinite(result?.total) && offset + rows.length >= result.total)) break;
    if (residents.size === previousSize) throw new Error('The resident directory pagination did not advance.');
  }
  return [...residents.values()];
};

export const tclDateError = ({ lastVisit, nextVisit, nextVisitTime }) => {
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (lastVisit && !validDate(lastVisit)) return 'Last visit date is invalid.';
  if (nextVisit && !validDate(nextVisit)) return 'Next visit date is invalid.';
  if (nextVisitTime && (!nextVisit || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(nextVisitTime))) return 'Set a valid next visit date and time.';
  if (lastVisit && nextVisit && nextVisit < lastVisit) return 'The next visit cannot precede the last recorded visit.';
  return '';
};

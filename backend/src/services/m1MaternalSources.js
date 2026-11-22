const text = (value) => String(value ?? '').trim();
const PAGE_SIZE = 500;

export const validMaternalDate = (value) => {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
};

export const maternalServiceDay = (value) => {
  const date = validMaternalDate(value);
  if (date) return date;
  if (value instanceof Date && !Number.isFinite(value.getTime())) return '';
  const timestamp = value instanceof Date ? value.toISOString() : text(value);
  if (!/^\d{4}-\d{2}-\d{2}[T ].*(?:Z|[+-]\d{2}(?::?\d{2})?)$/i.test(timestamp)) return '';
  if (!validMaternalDate(timestamp.slice(0, 10))) return '';
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(parsed);
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
};

export const inMaternalScope = (row, scope) => (!scope?.barangayId || row.barangay_id === scope.barangayId)
  && (!scope?.municipalityId || row.municipality_id === scope.municipalityId);

// A sole pregnancy, a resident name, or a delivery day alone is not episode identity.
export const sameMaternalEpisode = (left, right) => {
  const residentId = text(left.resident_id || left.resident?.id);
  if (!residentId || residentId !== text(right.resident_id || right.resident?.id)) return false;
  const leftId = text(left.pregnancy_id);
  const rightId = text(right.pregnancy_id);
  if (leftId && rightId && leftId !== rightId) return false;
  // Server-verified canonical identity survives a later dating correction.
  // Legacy pointers and date-only snapshots still require nonconflicting dates.
  if (leftId && leftId === rightId && left.pregnancy_identity_confirmed && right.pregnancy_identity_confirmed) return true;
  let matchedDate = false;
  for (const key of ['lmp', 'edd']) {
    const a = validMaternalDate(left[key]);
    const b = validMaternalDate(right[key]);
    if (a && b && a !== b) return false;
    if (a && b) matchedDate = true;
  }
  const leftDelivery = validMaternalDate(left.delivery_date);
  const rightDelivery = validMaternalDate(right.delivery_date);
  if (leftDelivery && rightDelivery && leftDelivery !== rightDelivery) return false;
  return Boolean(leftId && rightId && leftId === rightId) || matchedDate;
};

const normalizeConsultation = (raw) => {
  const originalResident = Array.isArray(raw.resident) ? raw.resident[0] : raw.resident;
  const resident = originalResident ? {
    ...originalResident,
    id: originalResident.id,
    first_name: originalResident.first_name ?? originalResident.firstName,
    middle_name: originalResident.middle_name ?? originalResident.middleName,
    last_name: originalResident.last_name ?? originalResident.lastName,
    birth_date: originalResident.birth_date ?? originalResident.birthDate,
  } : null;
  const details = raw.consultation_details ?? raw.consultationDetails ?? {};
  const maternal = details.maternal || {};
  const reportingScope = details.reportingScope && typeof details.reportingScope === 'object'
    && !Array.isArray(details.reportingScope) ? details.reportingScope : null;
  const service = Array.isArray(raw.health_service) ? raw.health_service[0] : raw.health_service;
  const serviceId = text(raw.health_service_id ?? raw.healthServiceId);
  const category = text(details.healthServiceCategory || service?.category);
  const serviceName = text(raw.health_service_name ?? raw.healthServiceName) || text(service?.name);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(serviceId)
    || service && text(service.id) !== serviceId || !service && !category) return null;
  const prenatalName = /\b(?:prenatal|antenatal|anc)\b/i.test(serviceName);
  const postpartumName = /\b(?:postpartum|postnatal|pnc)\b/i.test(serviceName);
  if (!/\b(?:maternal|prenatal|antenatal|postpartum|postnatal)\b/i.test(category)
    && !prenatalName && !postpartumName) return null;
  const explicitCare = text(maternal.careType).toLowerCase();
  const careType = ['prenatal', 'postpartum'].includes(explicitCare) ? explicitCare
    : postpartumName || /postpartum|postnatal/i.test(category) ? 'postpartum'
      : prenatalName || /prenatal|antenatal/i.test(category) ? 'prenatal' : 'maternal';
  const status = text(raw.status).toLowerCase();
  const visitDate = validMaternalDate(details.consultationDate)
    || maternalServiceDay(raw.visit_date ?? raw.visitDate);
  const numeric = (value) => !['number', 'string'].includes(typeof value) || text(value) === '' ? null
    : Number.isFinite(Number(value)) ? Number(value) : null;
  return {
    id: raw.id,
    source: 'visits',
    resident_id: text(raw.resident_id ?? raw.residentId) || text(resident?.id),
    resident,
    barangay_id: reportingScope ? text(reportingScope.barangayId) || null : raw.barangay_id ?? raw.barangayId ?? null,
    municipality_id: reportingScope ? text(reportingScope.municipalityId) || null : raw.municipality_id ?? raw.municipalityId ?? null,
    reporting_scope_source: reportingScope ? 'consultation_snapshot' : 'legacy_visit_columns',
    resident_scope: {
      barangay_id: originalResident?.barangay_id ?? originalResident?.barangayId ?? null,
      municipality_id: originalResident?.municipality_id ?? originalResident?.municipalityId ?? null,
    },
    pregnancy_id: text(maternal.pregnancyId) || null,
    pregnancy_indicated_by_diagnosis: maternal.pregnancyIndicatedByDiagnosis === true,
    pregnancy_identity_confirmed: details.clinicalIntegrityVersion === 'consultation-clinical-v1'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text(maternal.pregnancyId)),
    maternal_record_id: text(maternal.maternalRecordId) || null,
    lmp: validMaternalDate(maternal.lmpDate),
    edd: validMaternalDate(maternal.eddDate),
    visit_type: careType,
    visit_date: visitDate,
    visit_timestamp: raw.visit_date ?? raw.visitDate ?? null,
    gestational_age_weeks: numeric(maternal.gestationalAgeWeeks),
    height_cm: numeric(raw.height_cm ?? raw.vitals?.heightCm),
    weight: numeric(raw.weight_kg ?? raw.vitals?.weightKg),
    bmi: numeric(raw.bmi ?? raw.vitals?.bmi),
    health_service_id: serviceId,
    health_service_name: serviceName,
    health_service_category: category,
    status: raw.status,
    eligible: Boolean(visitDate) && ['completed', 'referred'].includes(status),
    record: raw,
  };
};

export const loadMaternalSources = async ({ supabase, scope, repo }) => {
  const read = async (table, select = '*', parent = null, snapshotScope = false) => {
    if (parent && !parent.ids.length) return [];
    const rows = [];
    const batches = parent ? Array.from({ length: Math.ceil(parent.ids.length / 100) }, (_, index) => parent.ids.slice(index * 100, (index + 1) * 100)) : [null];
    for (const ids of batches) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        let query = supabase.from(table).select(select);
        if (parent) query = query.in(parent.field, ids);
        else {
          if (scope.barangayId) query = query.eq(snapshotScope ? 'consultation_details->reportingScope->>barangayId' : 'barangay_id', scope.barangayId);
          if (scope.municipalityId) query = query.eq(snapshotScope ? 'consultation_details->reportingScope->>municipalityId' : 'municipality_id', scope.municipalityId);
        }
        const paginated = typeof query.range === 'function';
        if (paginated) query = query.order('id').range(offset, offset + PAGE_SIZE - 1);
        const { data, error } = await query;
        if (error || data != null && !Array.isArray(data)) {
          throw Object.assign(new Error(error?.message || `Could not load ${table}`), { statusCode: 500, details: error });
        }
        rows.push(...(data || []));
        if (!paginated || (data || []).length < PAGE_SIZE) break;
      }
    }
    return rows;
  };
  const residentSelect = 'id, first_name, middle_name, last_name, barangay, barangay_id, municipality_id, sex, birth_date';
  const caseSelect = `*, resident:residents(${residentSelect})`;
  const visitSelect = `${caseSelect}, health_service:health_services(id, name, category)`;
  const merge = (rows, extra) => {
    const ids = new Set(rows.map((row) => row.id).filter(Boolean));
    return [...rows, ...extra.filter((row) => !row.id || !ids.has(row.id))];
  };
  let legacy = [];
  let pregnancies = [];
  let visits = [];
  if (!supabase) {
    if (repo?.driver !== 'file' || typeof repo.listVisits !== 'function') {
      throw Object.assign(new Error('Maternal reporting requires a configured data driver.'), { statusCode: 503 });
    }
    for (let offset = 0; ; offset += PAGE_SIZE) {
      // The repository municipality filter follows the current resident.
      // Filter service-time IDs below so a transfer cannot move M1 activity.
      const result = await repo.listVisits({ orderBy: 'clinicalDate', offset, limit: PAGE_SIZE });
      if (!Array.isArray(result?.rows)) throw Object.assign(new Error('Could not load consultation visits.'), { statusCode: 500 });
      visits.push(...result.rows);
      if (result.rows.length < PAGE_SIZE) break;
    }
  } else {
    let snapshotVisits;
    [legacy, pregnancies, visits, snapshotVisits] = await Promise.all([
      read('maternal_records', caseSelect), read('maternal_pregnancies', caseSelect), read('visits', visitSelect),
      scope.barangayId || scope.municipalityId ? read('visits', visitSelect, null, true) : Promise.resolve([]),
    ]);
    visits = merge(visits, snapshotVisits);
    const scopedConsultations = visits.map(normalizeConsultation).filter((row) => row && inMaternalScope(row, scope));
    const residentIds = [...new Set([...legacy, ...pregnancies, ...scopedConsultations].map((row) => text(row.resident_id || row.resident?.id)).filter(Boolean))];
    const residentParent = { field: 'resident_id', ids: residentIds };
    // Complete connected histories only for people with scoped case/service
    // evidence. Transfers must not restart attainment; foreign raw rows are not
    // disclosed in the scoped report.
    const continuityRows = await Promise.all([
      read('maternal_records', caseSelect, residentParent),
      read('maternal_pregnancies', caseSelect, residentParent),
      read('visits', visitSelect, residentParent),
    ]);
    legacy = merge(legacy, continuityRows[0]);
    pregnancies = merge(pregnancies, continuityRows[1]);
    visits = merge(visits, continuityRows[2]);
  }
  const consultations = visits.map(normalizeConsultation).filter((row) => row?.resident_id);
  if (!supabase) {
    const ids = new Set(consultations.filter((row) => inMaternalScope(row, scope)
      || !row.barangay_id && !row.municipality_id && inMaternalScope(row.resident_scope, scope)).map((row) => row.resident_id));
    return { legacy, pregnancies, consultations: consultations.filter((row) => ids.has(row.resident_id)), encounters: [], services: [], deliveries: [], postpartum: [], legacyVisits: [], immunizations: [] };
  }
  const pregnancyParent = { field: 'pregnancy_id', ids: pregnancies.map((row) => row.id) };
  const [encounters, services, deliveries, postpartum, legacyVisits, immunizations] = await Promise.all([
    read('pregnancy_encounters', '*', pregnancyParent), read('prenatal_services', '*', pregnancyParent),
    read('delivery_records', '*', pregnancyParent), read('postpartum_encounters', '*', pregnancyParent),
    read('maternal_visits', '*', { field: 'maternal_case_id', ids: legacy.map((row) => row.id) }),
    read('immunizations', '*', { field: 'resident_id', ids: [...new Set([...legacy, ...pregnancies].map((row) => row.resident_id).filter(Boolean))] }),
  ]);
  return { legacy, pregnancies, consultations, encounters, services, deliveries, postpartum, legacyVisits, immunizations };
};

// Reporting permission does not imply access to consultation diagnoses, Rx or
// general clinical history. Preserve the source record itself in its repository;
// expose only maternal evidence/provenance in newly added report disclosures.
export const maternalReportEvidence = (record = {}) => {
  const fields = [
    'id', 'resident_id', 'residentId', 'pregnancy_id', 'maternal_case_id',
    'visit_date', 'visitDate', 'visit_type', 'encounter_date', 'encounter_type',
    'barangay_id', 'barangayId', 'municipality_id', 'municipalityId', 'status',
    'health_service_id', 'healthServiceId', 'health_service_name', 'healthServiceName',
    'gestational_age_weeks', 'height_cm', 'weight', 'weight_kg', 'bmi',
    'lmp', 'edd', 'lmp_date', 'edd_date', 'gravida', 'para', 'pregnancy_number',
    'date_of_registration', 'date_provided', 'service_type', 'result_date',
    'delivery_date', 'delivery_outcome', 'birth_weight', 'birth_weight_kg', 'birth_weight_class',
    'type_of_delivery', 'place_of_delivery', 'birth_attendant',
    'scheduled_milestone', 'iron_folic_completed', 'vitamin_a_given',
  ];
  const evidence = Object.fromEntries(fields.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
  const details = record.consultation_details ?? record.consultationDetails;
  if (details && typeof details === 'object') {
    const maternal = details.maternal || {};
    const selected = {
      consultationDate: validMaternalDate(details.consultationDate) || null,
      consultationTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(text(details.consultationTime)) ? details.consultationTime : null,
      healthServiceCategory: details.healthServiceCategory || '',
      maternal: Object.fromEntries(['careType', 'pregnancyId', 'maternalRecordId', 'lmpDate', 'eddDate', 'gestationalAgeWeeks', 'pregnancyIndicatedByDiagnosis']
        .filter((key) => maternal[key] !== undefined).map((key) => [key, maternal[key]])),
      ...(details.reportingScope ? { reportingScope: {
        barangayId: details.reportingScope.barangayId ?? null, municipalityId: details.reportingScope.municipalityId ?? null,
      } } : {}),
    };
    evidence[record.consultation_details ? 'consultation_details' : 'consultationDetails'] = selected;
  }
  if (record.service_details) evidence.service_details = Object.fromEntries(['course_completed', 'dose_number']
    .filter((key) => record.service_details[key] !== undefined).map((key) => [key, record.service_details[key]]));
  if (record.result_status || record.result_value) {
    const result = text(record.result_status || record.result_value).toLowerCase();
    evidence.result_status = ['+', 'positive'].includes(result) ? 'positive' : ['-', 'negative'].includes(result) ? 'negative' : 'unknown';
  }
  if (record.vitals) evidence.vitals = Object.fromEntries(['heightCm', 'weightKg', 'bmi']
    .filter((key) => record.vitals[key] !== undefined).map((key) => [key, record.vitals[key]]));
  return evidence;
};

export const maternalReportContact = (visit) => {
  const { record, resident_scope: _residentScope, ...contact } = visit;
  const safe = maternalReportEvidence(contact);
  for (const key of ['source', 'episode_key', 'eligible', 'pregnancy_indicated_by_diagnosis', 'pregnancy_identity_confirmed', 'health_service_category', 'reporting_scope_source', 'attributionStatus']) {
    if (contact[key] !== undefined) safe[key] = contact[key];
  }
  if (contact.resident) safe.resident = Object.fromEntries(['id', 'first_name', 'middle_name', 'last_name', 'birth_date', 'sex']
    .filter((key) => contact.resident[key] !== undefined).map((key) => [key, contact.resident[key]]));
  safe.record = maternalReportEvidence(record || contact);
  return safe;
};

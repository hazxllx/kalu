import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import { assignedBarangay } from '../config/scope.js';

const text = (v) => String(v ?? '').trim();
const throwOnError = (error, fallback) => {
  if (error) throw Object.assign(new Error(error.message || fallback), { statusCode: 500, details: error });
};

// Manila timezone offset for date calculations
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;
export const manilaDateString = (d = new Date()) =>
  new Date(d.getTime() + MANILA_OFFSET_MS).toISOString().slice(0, 10);

const dateIsDateOnly = (value) =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));

// ============================================================================
// PREGNANCY DATING & CALCULATION UTILITIES
// ============================================================================

/**
 * Calculate estimated delivery date (EDD) from LMP date.
 * Standard calculation: LMP + 280 days (40 weeks)
 * Returns null if LMP is invalid or missing.
 */
export const calculateEDD = (lmpDate) => {
  if (!lmpDate || !dateIsDateOnly(lmpDate)) return null;
  const lmp = new Date(`${lmpDate}T00:00:00Z`);
  if (Number.isNaN(lmp.getTime())) return null;
  const edd = new Date(lmp.getTime() + 280 * 24 * 60 * 60 * 1000);
  return edd.toISOString().slice(0, 10);
};

/**
 * Calculate gestational age in weeks from LMP or other dating method.
 * Returns { weeks, days } or null if invalid.
 * Calculated as of encounterDate (default: today).
 */
export const calculateGestationalAge = (lmpDate, encounterDate = manilaDateString()) => {
  if (!lmpDate || !dateIsDateOnly(lmpDate)) return null;
  if (!dateIsDateOnly(encounterDate)) return null;
  
  const lmp = new Date(`${lmpDate}T00:00:00Z`);
  const encounter = new Date(`${encounterDate}T00:00:00Z`);
  
  if (Number.isNaN(lmp.getTime()) || Number.isNaN(encounter.getTime())) return null;
  
  const daysDiff = Math.floor((encounter.getTime() - lmp.getTime()) / (24 * 60 * 60 * 1000));
  if (daysDiff < 0) return null; // encounter before LMP is invalid
  
  const weeks = Math.floor(daysDiff / 7);
  const days = daysDiff % 7;
  
  return { weeks, days, totalDays: daysDiff };
};

/**
 * Calculate BMI from height (cm) and weight (kg).
 * Formula: weight (kg) / (height (m))^2
 * Returns null if either measurement is missing or invalid.
 */
export const calculateBMI = (heightCm, weightKg) => {
  const h = Number(heightCm);
  const w = Number(weightKg);
  
  if (!Number.isFinite(h) || !Number.isFinite(w) || h <= 0 || w <= 0) return null;
  
  const heightM = h / 100;
  const bmi = w / (heightM * heightM);
  
  return Math.round(bmi * 100) / 100; // round to 2 decimal places
};

// ============================================================================
// PREGNANCY REGISTRATION & AUTOFILL
// ============================================================================

/**
 * Retrieve resident information for pregnancy autofill.
 * Returns: { id, first_name, middle_name, last_name, sex, birth_date, barangay_id, municipality_id }
 */
export const getResidentForPregnancyRegistration = async (residentId, { supabase = getServiceClient() } = {}) => {
  const { data, error } = await supabase
    .from('residents')
    .select('id, first_name, middle_name, last_name, sex, birth_date, barangay_id, municipality_id, auth_user_id')
    .eq('id', residentId)
    .maybeSingle();
  
  throwOnError(error, 'Could not load resident information');
  if (!data) throw ApiError.notFound('Resident not found');
  
  return data;
};

/**
 * Check for existing active pregnancy records for a resident.
 * Prevents accidental duplicate pregnancy registration.
 */
export const checkExistingPregnancy = async (residentId, { supabase = getServiceClient() } = {}) => {
  const { data, error } = await supabase
    .from('maternal_pregnancies')
    .select('id, status, lmp_date, edd_date, created_at')
    .eq('resident_id', residentId)
    .in('status', ['active', 'lost_to_followup', 'transferred'])
    .maybeSingle();
  
  throwOnError(error, 'Could not check for existing pregnancy');
  return data;
};

/**
 * Register a new pregnancy for a resident.
 * Validates data, autofills derived values, and creates the pregnancy record.
 */
export const registerPregnancy = async (payload = {}, { user, supabase = getServiceClient() } = {}) => {
  if (!user?.id) throw ApiError.unauthorized('User not authenticated');
  
  const residentId = text(payload.residentId || payload.resident_id);
  if (!residentId) throw ApiError.unprocessable('Resident ID is required');
  
  // Get resident and validate scope
  const resident = await getResidentForPregnancyRegistration(residentId, { supabase });
  
  // Check for existing active pregnancy
  const existing = await checkExistingPregnancy(residentId, { supabase });
  if (existing) {
    throw ApiError.conflict(`Resident already has an active pregnancy (status: ${existing.status}). Mark it as delivered or transferred before creating a new one.`);
  }
  
  // Validate LMP date
  const lmpDate = text(payload.lmpDate || payload.lmp_date);
  if (!lmpDate) throw ApiError.unprocessable('LMP date is required to register pregnancy');
  if (!dateIsDateOnly(lmpDate)) throw ApiError.unprocessable('LMP date must be in YYYY-MM-DD format');
  
  // Validate LMP is not in future
  if (lmpDate > manilaDateString()) {
    throw ApiError.unprocessable('LMP date cannot be in the future');
  }
  
  // Calculate EDD from LMP
  const eddDate = calculateEDD(lmpDate);
  if (!eddDate) throw ApiError.unprocessable('Could not calculate EDD from LMP date');
  
  // Validate LMP reliability
  const lmpReliability = text(payload.lmpReliability || payload.lmp_reliability || 'certain');
  if (!['certain', 'uncertain', 'unknown'].includes(lmpReliability)) {
    throw ApiError.unprocessable('LMP reliability must be: certain, uncertain, or unknown');
  }
  
  // Prepare pregnancy record
  const pregnancyRecord = {
    resident_id: residentId,
    status: 'active',
    pregnancy_number: payload.gravida || payload.pregnancy_number || 1,
    parity_before_pregnancy: payload.parity || payload.parity_before_pregnancy || 0,
    lmp_date: lmpDate,
    lmp_reliability: lmpReliability,
    edd_date: eddDate,
    edd_source: 'lmp',
    pregnancy_dating_method: 'lmp',
    gravida: payload.gravida,
    para: payload.para,
    date_of_registration: manilaDateString(),
    registered_by: user.id,
    socio_economic_status: text(payload.socioEconomicStatus || payload.socio_economic_status || ''),
    primary_provider: text(payload.primaryProvider || payload.primary_provider || user.name || ''),
    risk_level: '',
    created_by: user.id,
  };
  
  // Insert pregnancy record
  const { data, error } = await supabase
    .from('maternal_pregnancies')
    .insert([pregnancyRecord])
    .select('id, resident_id, status, lmp_date, edd_date, created_at');
  
  throwOnError(error, 'Could not create pregnancy record');
  if (!data?.length) throw ApiError.unprocessable('Pregnancy record creation failed');
  
  // Log audit
  await auditMaternalAction(supabase, user, 'created', 'pregnancy', data[0].id, resident);
  
  // Notify resident
  await notifyResident(supabase, resident, 'pregnancy_registered', data[0]);
  
  return data[0];
};

// ============================================================================
// PRENATAL ENCOUNTER RECORDING
// ============================================================================

/**
 * Create a prenatal encounter (visit) for a pregnancy.
 * Automatically calculates gestational age based on encounter date and pregnancy LMP.
 */
export const addPrenatalEncounter = async (pregnancyId, payload = {}, { user, supabase = getServiceClient() } = {}) => {
  if (!user?.id) throw ApiError.unauthorized('User not authenticated');
  
  if (!pregnancyId) throw ApiError.unprocessable('Pregnancy ID is required');
  
  // Get pregnancy record
  const { data: pregnancy, error: pregError } = await supabase
    .from('maternal_pregnancies')
    .select('id, resident_id, lmp_date, status, created_at')
    .eq('id', pregnancyId)
    .maybeSingle();
  
  throwOnError(pregError, 'Could not load pregnancy record');
  if (!pregnancy) throw ApiError.notFound('Pregnancy record not found');
  
  if (pregnancy.status !== 'active') {
    throw ApiError.conflict('Cannot record encounters for a pregnancy that is not active');
  }
  
  // Validate encounter date
  const encounterDate = text(payload.encounterDate || payload.encounter_date);
  if (!encounterDate) throw ApiError.unprocessable('Encounter date is required');
  if (!dateIsDateOnly(encounterDate)) throw ApiError.unprocessable('Encounter date must be in YYYY-MM-DD format');
  if (encounterDate > manilaDateString()) throw ApiError.unprocessable('Encounter date cannot be in the future');
  
  // Get resident
  const resident = await getResidentForPregnancyRegistration(pregnancy.resident_id, { supabase });
  
  // Calculate gestational age
  const gaCalc = calculateGestationalAge(pregnancy.lmp_date, encounterDate);
  if (!gaCalc) throw ApiError.unprocessable('Could not calculate gestational age');
  
  // Validate and calculate BMI if both height and weight provided
  let bmi = null;
  const heightCm = payload.heightCm || payload.height_cm;
  const weightKg = payload.weightKg || payload.weight_kg;
  
  if (heightCm && weightKg) {
    bmi = calculateBMI(heightCm, weightKg);
    if (bmi === null) throw ApiError.unprocessable('Height and weight must be valid positive numbers to calculate BMI');
  }
  
  // Get highest encounter number
  const { data: encounters, error: encError } = await supabase
    .from('pregnancy_encounters')
    .select('encounter_number')
    .eq('pregnancy_id', pregnancyId)
    .order('encounter_number', { ascending: false })
    .limit(1);
  
  throwOnError(encError, 'Could not load encounter history');
  const encounterNumber = (encounters?.[0]?.encounter_number || 0) + 1;
  
  // Prepare encounter record
  const encounterRecord = {
    pregnancy_id: pregnancyId,
    resident_id: pregnancy.resident_id,
    encounter_type: 'prenatal',
    encounter_date: encounterDate,
    encounter_number: encounterNumber,
    provider_id: user.id,
    provider_name: user.name || '',
    gestational_age_weeks: gaCalc.weeks + gaCalc.days / 7,
    gestational_age_source: 'lmp',
    systolic_bp: payload.systolicBp || payload.systolic_bp ? Number(payload.systolicBp || payload.systolic_bp) : null,
    diastolic_bp: payload.diastolicBp || payload.diastolic_bp ? Number(payload.diastolicBp || payload.diastolic_bp) : null,
    weight_kg: payload.weightKg || payload.weight_kg ? Number(payload.weightKg || payload.weight_kg) : null,
    height_cm: heightCm ? Number(heightCm) : null,
    bmi: bmi,
    fundal_height_cm: payload.fundalHeightCm || payload.fundal_height_cm ? Number(payload.fundalHeightCm || payload.fundal_height_cm) : null,
    fetal_heart_rate: payload.fetalHeartRate || payload.fetal_heart_rate ? Number(payload.fetalHeartRate || payload.fetal_heart_rate) : null,
    fetal_position: text(payload.fetalPosition || payload.fetal_position || ''),
    clinical_findings: text(payload.clinicalFindings || payload.clinical_findings || ''),
    complications_identified: text(payload.complicationsIdentified || payload.complications_identified || ''),
    assessment: text(payload.assessment || ''),
    care_plan: text(payload.carePlan || payload.care_plan || ''),
    next_visit_planned_date: payload.nextVisitPlannedDate || payload.next_visit_planned_date || null,
    referral_needed: Boolean(payload.referralNeeded || payload.referral_needed),
    referral_reason: text(payload.referralReason || payload.referral_reason || ''),
    referral_facility: text(payload.referralFacility || payload.referral_facility || ''),
    services_provided: Array.isArray(payload.servicesProvided) ? payload.servicesProvided : [],
    notes: text(payload.notes || ''),
    created_by: user.id,
  };
  
  // Insert encounter
  const { data: inserted, error: insError } = await supabase
    .from('pregnancy_encounters')
    .insert([encounterRecord])
    .select('id, encounter_date, encounter_number, gestational_age_weeks, created_at');
  
  throwOnError(insError, 'Could not create encounter record');
  if (!inserted?.length) throw ApiError.unprocessable('Encounter creation failed');
  
  // Update pregnancy's current gestational age
  const { error: updateError } = await supabase
    .from('maternal_pregnancies')
    .update({
      current_gestational_age_weeks: gaCalc.weeks + gaCalc.days / 7,
      current_gestational_age_calculated_at: encounterDate,
    })
    .eq('id', pregnancyId);
  
  throwOnError(updateError, 'Could not update pregnancy record');
  
  // Log audit
  await auditMaternalAction(supabase, user, 'created', 'encounter', inserted[0].id, resident);
  
  return inserted[0];
};

// ============================================================================
// PRENATAL SERVICE TRACKING
// ============================================================================

/**
 * Record a prenatal service (immunization, screening, supplementation, etc.)
 * Prevents duplicate entries for the same service type per pregnancy.
 */
export const recordPrenatalService = async (pregnancyId, payload = {}, { user, supabase = getServiceClient() } = {}) => {
  if (!user?.id) throw ApiError.unauthorized('User not authenticated');
  
  if (!pregnancyId) throw ApiError.unprocessable('Pregnancy ID is required');
  
  const serviceType = text(payload.serviceType || payload.service_type);
  const serviceCategory = text(payload.serviceCategory || payload.service_category);
  const serviceName = text(payload.serviceName || payload.service_name);
  
  if (!serviceType) throw ApiError.unprocessable('Service type is required');
  if (!serviceCategory) throw ApiError.unprocessable('Service category is required');
  if (!serviceName) throw ApiError.unprocessable('Service name is required');
  
  if (!['immunization', 'micronutrient', 'deworming', 'infectious_disease_screening', 'laboratory_screening', 'other'].includes(serviceCategory)) {
    throw ApiError.unprocessable('Invalid service category');
  }
  
  // Get pregnancy
  const { data: pregnancy, error: pregError } = await supabase
    .from('maternal_pregnancies')
    .select('id, resident_id, status')
    .eq('id', pregnancyId)
    .maybeSingle();
  
  throwOnError(pregError, 'Could not load pregnancy record');
  if (!pregnancy) throw ApiError.notFound('Pregnancy record not found');
  
  const resident = await getResidentForPregnancyRegistration(pregnancy.resident_id, { supabase });
  
  // Check for existing service of this type
  const { data: existing, error: checkError } = await supabase
    .from('prenatal_services')
    .select('id, status')
    .eq('pregnancy_id', pregnancyId)
    .eq('service_type', serviceType)
    .neq('status', 'not_applicable')
    .maybeSingle();
  
  throwOnError(checkError, 'Could not check for existing service');
  
  if (existing) {
    throw ApiError.conflict(`This service (${serviceName}) has already been recorded for this pregnancy. Mark it as not_applicable or update the existing record.`);
  }
  
  // Validate service status
  const status = text(payload.status || 'pending');
  if (!['pending', 'due', 'overdue', 'completed', 'unable_to_provide', 'contraindicated', 'declined', 'not_applicable'].includes(status)) {
    throw ApiError.unprocessable('Invalid service status');
  }
  
  // Validate dates if provided
  const dateProvided = payload.dateProvided || payload.date_provided;
  if (dateProvided && !dateIsDateOnly(dateProvided)) {
    throw ApiError.unprocessable('Date provided must be in YYYY-MM-DD format');
  }
  
  const resultDate = payload.resultDate || payload.result_date;
  if (resultDate && !dateIsDateOnly(resultDate)) {
    throw ApiError.unprocessable('Result date must be in YYYY-MM-DD format');
  }
  
  // Prepare service record
  const serviceRecord = {
    pregnancy_id: pregnancyId,
    resident_id: pregnancy.resident_id,
    service_category: serviceCategory,
    service_type: serviceType,
    service_name: serviceName,
    status: status,
    date_provided: dateProvided || null,
    provider_id: user.id,
    provider_name: user.name || '',
    result_status: text(payload.resultStatus || payload.result_status || ''),
    result_value: text(payload.resultValue || payload.result_value || ''),
    result_date: resultDate || null,
    result_notes: text(payload.resultNotes || payload.result_notes || ''),
    service_details: payload.serviceDetails || payload.service_details || {},
    date_due: payload.dateDue || payload.date_due || null,
    date_overdue_after: payload.dateOverdueAfter || payload.date_overdue_after || null,
    notes_on_non_completion: text(payload.notesOnNonCompletion || payload.notes_on_non_completion || ''),
    created_by: user.id,
  };
  
  // Insert service
  const { data: inserted, error: insError } = await supabase
    .from('prenatal_services')
    .insert([serviceRecord])
    .select('id, service_type, status, date_provided, result_date, created_at');
  
  throwOnError(insError, 'Could not create service record');
  if (!inserted?.length) throw ApiError.unprocessable('Service record creation failed');
  
  // Log audit
  await auditMaternalAction(supabase, user, 'created', 'service', inserted[0].id, resident);
  
  return inserted[0];
};

// ============================================================================
// DELIVERY & POSTPARTUM AUTOMATION
// ============================================================================

/**
 * Record delivery outcome and auto-generate postpartum follow-up schedule.
 */
export const recordDelivery = async (pregnancyId, payload = {}, { user, supabase = getServiceClient() } = {}) => {
  if (!user?.id) throw ApiError.unauthorized('User not authenticated');
  
  if (!pregnancyId) throw ApiError.unprocessable('Pregnancy ID is required');
  
  // Get pregnancy
  const { data: pregnancy, error: pregError } = await supabase
    .from('maternal_pregnancies')
    .select('id, resident_id, lmp_date, status')
    .eq('id', pregnancyId)
    .maybeSingle();
  
  throwOnError(pregError, 'Could not load pregnancy record');
  if (!pregnancy) throw ApiError.notFound('Pregnancy record not found');
  
  if (pregnancy.status === 'delivered') {
    throw ApiError.conflict('Delivery has already been recorded for this pregnancy');
  }
  
  const resident = await getResidentForPregnancyRegistration(pregnancy.resident_id, { supabase });
  
  // Validate delivery date
  const deliveryDate = text(payload.deliveryDate || payload.delivery_date);
  if (!deliveryDate) throw ApiError.unprocessable('Delivery date is required');
  if (!dateIsDateOnly(deliveryDate)) throw ApiError.unprocessable('Delivery date must be in YYYY-MM-DD format');
  if (deliveryDate > manilaDateString()) throw ApiError.unprocessable('Delivery date cannot be in the future');
  
  // Validate delivery outcome
  const deliveryOutcome = text(payload.deliveryOutcome || payload.delivery_outcome);
  if (!['live_birth', 'stillbirth', 'abortion', 'ectopic'].includes(deliveryOutcome)) {
    throw ApiError.unprocessable('Delivery outcome must be: live_birth, stillbirth, abortion, or ectopic');
  }
  
  // Prepare delivery record
  const deliveryRecord = {
    pregnancy_id: pregnancyId,
    resident_id: pregnancy.resident_id,
    delivery_date: deliveryDate,
    delivery_time: text(payload.deliveryTime || payload.delivery_time || ''),
    delivery_outcome: deliveryOutcome,
    type_of_delivery: text(payload.typeOfDelivery || payload.type_of_delivery || ''),
    place_of_delivery: text(payload.placeOfDelivery || payload.place_of_delivery || ''),
    birth_attendant: text(payload.birthAttendant || payload.birth_attendant || ''),
    newborn_sex: text(payload.newbornSex || payload.newborn_sex || ''),
    birth_weight_kg: payload.birthWeightKg || payload.birth_weight_kg ? Number(payload.birthWeightKg || payload.birth_weight_kg) : null,
    birth_weight_class: text(payload.birthWeightClass || payload.birth_weight_class || ''),
    apgar_1min: payload.apgar1min || payload.apgar_1min ? Number(payload.apgar1min || payload.apgar_1min) : null,
    apgar_5min: payload.apgar5min || payload.apgar_5min ? Number(payload.apgar5min || payload.apgar_5min) : null,
    maternal_complications: text(payload.maternalComplications || payload.maternal_complications || ''),
    newborn_complications: text(payload.newbornComplications || payload.newborn_complications || ''),
    delivery_notes: text(payload.deliveryNotes || payload.delivery_notes || ''),
    postpartum_schedule_generated: false,
    recorded_by: user.id,
  };
  
  // Insert delivery record
  const { data: delivery, error: delError } = await supabase
    .from('delivery_records')
    .insert([deliveryRecord])
    .select('id, pregnancy_id, delivery_date, delivery_outcome, created_at');
  
  throwOnError(delError, 'Could not create delivery record');
  if (!delivery?.length) throw ApiError.unprocessable('Delivery record creation failed');
  
  const deliveryId = delivery[0].id;
  
  // Update pregnancy status to delivered
  const { error: updateError } = await supabase
    .from('maternal_pregnancies')
    .update({
      status: 'delivered',
      outcome: deliveryOutcome,
      outcome_date: deliveryDate,
    })
    .eq('id', pregnancyId);
  
  throwOnError(updateError, 'Could not update pregnancy status');
  
  // Generate postpartum follow-up schedule (only for live births)
  if (deliveryOutcome === 'live_birth') {
    const followUpMilestones = [
      { milestone: '24h', days_from_delivery: 1 },
      { milestone: '3d', days_from_delivery: 3 },
      { milestone: '7-14d', days_from_delivery: 7 },
      { milestone: '6wk', days_from_delivery: 42 },
    ];
    
    const deliveryDateObj = new Date(`${deliveryDate}T00:00:00Z`);
    const followUpsToInsert = followUpMilestones.map(m => {
      const expectedDate = new Date(deliveryDateObj.getTime() + m.days_from_delivery * 24 * 60 * 60 * 1000);
      const expectedDateStr = expectedDate.toISOString().slice(0, 10);
      const endDateObj = new Date(deliveryDateObj.getTime() + (m.days_from_delivery + 1) * 24 * 60 * 60 * 1000);
      const endDateStr = endDateObj.toISOString().slice(0, 10);
      
      return {
        pregnancy_id: pregnancyId,
        delivery_record_id: deliveryId,
        resident_id: pregnancy.resident_id,
        milestone: m.milestone,
        days_from_delivery: m.days_from_delivery,
        expected_start_date: expectedDateStr,
        expected_end_date: endDateStr,
        status: 'pending',
      };
    });
    
    const { error: followUpError } = await supabase
      .from('postpartum_follow_ups')
      .insert(followUpsToInsert);
    
    throwOnError(followUpError, 'Could not generate postpartum follow-up schedule');
    
    // Mark schedule as generated
    await supabase
      .from('delivery_records')
      .update({ postpartum_schedule_generated: true })
      .eq('id', deliveryId);
  }
  
  // Log audit
  await auditMaternalAction(supabase, user, 'created', 'delivery', deliveryId, resident);
  
  // Notify resident
  await notifyResident(supabase, resident, 'delivery_recorded', delivery[0]);
  
  return delivery[0];
};

/**
 * Record a postpartum encounter (visit).
 */
export const addPostpartumEncounter = async (deliveryId, payload = {}, { user, supabase = getServiceClient() } = {}) => {
  if (!user?.id) throw ApiError.unauthorized('User not authenticated');
  
  if (!deliveryId) throw ApiError.unprocessable('Delivery ID is required');
  
  // Get delivery record
  const { data: delivery, error: delError } = await supabase
    .from('delivery_records')
    .select('id, pregnancy_id, delivery_date, resident_id')
    .eq('id', deliveryId)
    .maybeSingle();
  
  throwOnError(delError, 'Could not load delivery record');
  if (!delivery) throw ApiError.notFound('Delivery record not found');
  
  // Validate encounter date
  const encounterDate = text(payload.encounterDate || payload.encounter_date);
  if (!encounterDate) throw ApiError.unprocessable('Encounter date is required');
  if (!dateIsDateOnly(encounterDate)) throw ApiError.unprocessable('Encounter date must be in YYYY-MM-DD format');
  if (encounterDate > manilaDateString()) throw ApiError.unprocessable('Encounter date cannot be in the future');
  
  // Calculate days postpartum
  const daysPostpartum = Math.floor((new Date(`${encounterDate}T00:00:00Z`).getTime() - new Date(`${delivery.delivery_date}T00:00:00Z`).getTime()) / (24 * 60 * 60 * 1000));
  
  if (daysPostpartum < 0) throw ApiError.unprocessable('Encounter date cannot be before delivery date');
  
  const resident = await getResidentForPregnancyRegistration(delivery.resident_id, { supabase });
  
  // Get highest encounter number
  const { data: encounters, error: encError } = await supabase
    .from('postpartum_encounters')
    .select('encounter_number')
    .eq('delivery_record_id', deliveryId)
    .order('encounter_number', { ascending: false })
    .limit(1);
  
  throwOnError(encError, 'Could not load encounter history');
  const encounterNumber = (encounters?.[0]?.encounter_number || 0) + 1;
  
  // Prepare postpartum encounter
  const postpartumEncounter = {
    pregnancy_id: delivery.pregnancy_id,
    delivery_record_id: deliveryId,
    resident_id: delivery.resident_id,
    encounter_date: encounterDate,
    encounter_number: encounterNumber,
    days_postpartum: daysPostpartum,
    visit_type: text(payload.visitType || payload.visit_type || 'routine'),
    scheduled_milestone: text(payload.scheduledMilestone || payload.scheduled_milestone || ''),
    provider_id: user.id,
    provider_name: user.name || '',
    visit_location: text(payload.visitLocation || payload.visit_location || ''),
    systolic_bp: payload.systolicBp || payload.systolic_bp ? Number(payload.systolicBp || payload.systolic_bp) : null,
    diastolic_bp: payload.diastolicBp || payload.diastolic_bp ? Number(payload.diastolicBp || payload.diastolic_bp) : null,
    temperature_celsius: payload.temperatureCelsius || payload.temperature_celsius ? Number(payload.temperatureCelsius || payload.temperature_celsius) : null,
    weight_kg: payload.weightKg || payload.weight_kg ? Number(payload.weightKg || payload.weight_kg) : null,
    uterine_involution_status: text(payload.uterineInvolutionStatus || payload.uterine_involution_status || ''),
    lochia_status: text(payload.lochiaStatus || payload.lochia_status || ''),
    episiotomy_wound_status: text(payload.episiotomyWoundStatus || payload.episiotomy_wound_status || ''),
    breast_examination_findings: text(payload.breastExaminationFindings || payload.breast_examination_findings || ''),
    complications_identified: text(payload.complicationsIdentified || payload.complications_identified || ''),
    referral_needed: Boolean(payload.referralNeeded || payload.referral_needed),
    referral_reason: text(payload.referralReason || payload.referral_reason || ''),
    referral_facility: text(payload.referralFacility || payload.referral_facility || ''),
    iron_folic_given: Boolean(payload.ironFolicGiven || payload.iron_folic_given),
    vitamin_a_given: Boolean(payload.vitaminAGiven || payload.vitamin_a_given),
    family_planning_discussed: Boolean(payload.familyPlanningDiscussed || payload.family_planning_discussed),
    family_planning_method_chosen: text(payload.familyPlanningMethodChosen || payload.family_planning_method_chosen || ''),
    newborn_assessed: Boolean(payload.newbornAssessed || payload.newborn_assessed),
    newborn_findings: text(payload.newbornFindings || payload.newborn_findings || ''),
    newborn_referral_needed: Boolean(payload.newbornReferralNeeded || payload.newborn_referral_needed),
    services_provided: Array.isArray(payload.servicesProvided) ? payload.servicesProvided : [],
    assessment: text(payload.assessment || ''),
    care_plan: text(payload.carePlan || payload.care_plan || ''),
    next_visit_planned_date: payload.nextVisitPlannedDate || payload.next_visit_planned_date || null,
    notes: text(payload.notes || ''),
    created_by: user.id,
  };
  
  // Insert encounter
  const { data: inserted, error: insError } = await supabase
    .from('postpartum_encounters')
    .insert([postpartumEncounter])
    .select('id, encounter_date, encounter_number, days_postpartum, created_at');
  
  throwOnError(insError, 'Could not create postpartum encounter');
  if (!inserted?.length) throw ApiError.unprocessable('Postpartum encounter creation failed');
  
  // Update postpartum follow-up status if applicable
  if (payload.scheduledMilestone || payload.scheduled_milestone) {
    const milestone = text(payload.scheduledMilestone || payload.scheduled_milestone);
    const { error: updateError } = await supabase
      .from('postpartum_follow_ups')
      .update({ status: 'completed', completed_date: encounterDate })
      .eq('delivery_record_id', deliveryId)
      .eq('milestone', milestone);
    
    throwOnError(updateError, 'Could not update follow-up status');
  }
  
  // Log audit
  await auditMaternalAction(supabase, user, 'created', 'postpartum_encounter', inserted[0].id, resident);
  
  return inserted[0];
};

// ============================================================================
// MATERNAL PROFILE & RETRIEVAL
// ============================================================================

/**
 * Get consolidated maternal care profile for a pregnancy.
 * Returns pregnancy details, encounters, services, delivery info, and postpartum schedule.
 */
export const getMaternalProfile = async (pregnancyId, { supabase = getServiceClient() } = {}) => {
  // Get pregnancy
  const { data: pregnancy, error: pregError } = await supabase
    .from('maternal_pregnancies')
    .select('*')
    .eq('id', pregnancyId)
    .maybeSingle();
  
  throwOnError(pregError, 'Could not load pregnancy record');
  if (!pregnancy) throw ApiError.notFound('Pregnancy record not found');
  
  // Get prenatal encounters
  const { data: encounters, error: encError } = await supabase
    .from('pregnancy_encounters')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .order('encounter_date', { ascending: true });
  
  throwOnError(encError, 'Could not load encounters');
  
  // Get prenatal services
  const { data: services, error: serError } = await supabase
    .from('prenatal_services')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .order('created_at', { ascending: true });
  
  throwOnError(serError, 'Could not load services');
  
  // Get delivery record if exists
  const { data: deliveries, error: delError } = await supabase
    .from('delivery_records')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  throwOnError(delError, 'Could not load delivery record');
  
  // Get postpartum encounters if delivery recorded
  let postpartumEncounters = [];
  let postpartumSchedule = [];
  
  if (deliveries?.id) {
    const { data: ppEnc, error: ppEncError } = await supabase
      .from('postpartum_encounters')
      .select('*')
      .eq('delivery_record_id', deliveries.id)
      .order('encounter_date', { ascending: true });
    
    throwOnError(ppEncError, 'Could not load postpartum encounters');
    postpartumEncounters = ppEnc || [];
    
    const { data: ppSched, error: ppSchedError } = await supabase
      .from('postpartum_follow_ups')
      .select('*')
      .eq('delivery_record_id', deliveries.id)
      .order('expected_start_date', { ascending: true });
    
    throwOnError(ppSchedError, 'Could not load postpartum schedule');
    postpartumSchedule = ppSched || [];
  }
  
  return {
    pregnancy,
    encounters: encounters || [],
    services: services || [],
    delivery: deliveries || null,
    postpartumEncounters,
    postpartumSchedule,
  };
};

// ============================================================================
// AUDIT & NOTIFICATIONS
// ============================================================================

const auditMaternalAction = async (supabase, user, action, entityType, entityId, resident) => {
  const { error } = await supabase
    .from('maternal_care_audit_log')
    .insert({
      entity_type: entityType,
      entity_id: entityId,
      action: action,
      actor_id: user.id,
      actor_role: user.role || '',
      municipality_id: resident?.municipality_id || null,
      barangay_id: resident?.barangay_id || null,
    });
  
  throwOnError(error, 'Could not write maternal care audit log');
};

const notifyResident = async (supabase, resident, eventType, record) => {
  if (!resident?.auth_user_id) return;
  
  let title = '';
  let message = '';
  
  switch (eventType) {
    case 'pregnancy_registered':
      title = 'Pregnancy registered';
      message = 'Your pregnancy has been registered in the maternal care system.';
      break;
    case 'delivery_recorded':
      title = 'Delivery recorded';
      message = 'Your delivery has been recorded. Postpartum follow-up appointments have been scheduled.';
      break;
    default:
      return;
  }
  
  const { error } = await supabase
    .from('notifications')
    .insert({
      recipient_id: resident.auth_user_id,
      category: 'information',
      title: title,
      message: message,
      related_type: 'maternal_pregnancies',
      related_id: record.id,
    });
  
  throwOnError(error, 'Could not send resident notification');
};

export default {
  calculateEDD,
  calculateGestationalAge,
  calculateBMI,
  getResidentForPregnancyRegistration,
  checkExistingPregnancy,
  registerPregnancy,
  addPrenatalEncounter,
  recordPrenatalService,
  recordDelivery,
  addPostpartumEncounter,
  getMaternalProfile,
};

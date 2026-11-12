import { getServiceClient } from '../config/supabase.js';
import ApiError from '../utils/apiError.js';
import * as kalusagapService from '../services/kalusagap.service.js';

// ============================================================================
// PREGNANCY REGISTRATION
// ============================================================================

export const checkPregnancyStatus = async (req, res) => {
  const { residentId } = req.params;
  
  if (!residentId) {
    throw ApiError.badRequest('Resident ID is required');
  }
  
  const supabase = getServiceClient();
  
  // Get resident info for autofill
  const resident = await kalusagapService.getResidentForPregnancyRegistration(residentId, { supabase });
  
  // Check for existing pregnancy
  const existingPregnancy = await kalusagapService.checkExistingPregnancy(residentId, { supabase });
  
  res.json({
    resident: {
      id: resident.id,
      firstName: resident.first_name,
      middleName: resident.middle_name,
      lastName: resident.last_name,
      sex: resident.sex,
      birthDate: resident.birth_date,
    },
    existingPregnancy: existingPregnancy ? {
      id: existingPregnancy.id,
      status: existingPregnancy.status,
      lmpDate: existingPregnancy.lmp_date,
      eddDate: existingPregnancy.edd_date,
      createdAt: existingPregnancy.created_at,
    } : null,
  });
};

export const registerPregnancy = async (req, res) => {
  const supabase = getServiceClient();
  
  const pregnancy = await kalusagapService.registerPregnancy(req.body, {
    user: req.user,
    supabase,
  });
  
  res.status(201).json({
    id: pregnancy.id,
    residentId: pregnancy.resident_id,
    status: pregnancy.status,
    lmpDate: pregnancy.lmp_date,
    eddDate: pregnancy.edd_date,
    createdAt: pregnancy.created_at,
  });
};

export const getPregnancy = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const profile = await kalusagapService.getMaternalProfile(id, { supabase });
  
  // Transform to camelCase for frontend
  res.json({
    pregnancy: transformPregnancy(profile.pregnancy),
    encounters: profile.encounters.map(transformEncounter),
    services: profile.services.map(transformService),
    delivery: profile.delivery ? transformDelivery(profile.delivery) : null,
    postpartumEncounters: profile.postpartumEncounters.map(transformPostpartumEncounter),
    postpartumSchedule: profile.postpartumSchedule.map(transformFollowUp),
  });
};

export const updatePregnancy = async (req, res) => {
  const { id } = req.params;
  
  if (!id) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  // Get existing pregnancy
  const { data: pregnancy, error: pregError } = await supabase
    .from('maternal_pregnancies')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  
  if (pregError) throw pregError;
  if (!pregnancy) throw ApiError.notFound('Pregnancy not found');
  
  // Build update payload
  const updateData = {};
  
  if (req.body.riskLevel !== undefined) {
    updateData.risk_level = req.body.riskLevel || '';
  }
  
  if (req.body.status !== undefined) {
    updateData.status = req.body.status;
  }
  
  if (req.body.primaryProvider !== undefined) {
    updateData.primary_provider = req.body.primaryProvider || '';
  }
  
  if (req.body.notes !== undefined) {
    updateData.outcome_notes = req.body.notes || '';
  }
  
  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  
  updateData.updated_at = new Date().toISOString();
  updateData.version = (pregnancy.version || 1) + 1;
  
  const { data: updated, error: updateError } = await supabase
    .from('maternal_pregnancies')
    .update(updateData)
    .eq('id', id)
    .select('*')
    .maybeSingle();
  
  if (updateError) throw updateError;
  
  res.json(transformPregnancy(updated));
};

// ============================================================================
// PRENATAL ENCOUNTERS
// ============================================================================

export const addPrenatalEncounter = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const encounter = await kalusagapService.addPrenatalEncounter(pregnancyId, req.body, {
    user: req.user,
    supabase,
  });
  
  res.status(201).json(transformEncounter(encounter));
};

export const listPrenatalEncounters = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnacyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('pregnancy_encounters')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .order('encounter_date', { ascending: true });
  
  if (error) throw error;
  
  res.json(data?.map(transformEncounter) || []);
};

export const getPrenatalEncounter = async (req, res) => {
  const { id: pregnancyId, encounterId } = req.params;
  
  if (!pregnancyId || !encounterId) {
    throw ApiError.badRequest('Pregnancy ID and encounter ID are required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('pregnancy_encounters')
    .select('*')
    .eq('id', encounterId)
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw ApiError.notFound('Encounter not found');
  
  res.json(transformEncounter(data));
};

export const updatePrenatalEncounter = async (req, res) => {
  const { id: pregnancyId, encounterId } = req.params;
  
  if (!pregnancyId || !encounterId) {
    throw ApiError.badRequest('Pregnancy ID and encounter ID are required');
  }
  
  const supabase = getServiceClient();
  
  // Build update payload
  const updateData = {};
  const mappings = {
    bloodPressure: 'systolic_bp',
    diastolicBp: 'diastolic_bp',
    weightKg: 'weight_kg',
    heightCm: 'height_cm',
    fundalHeightCm: 'fundal_height_cm',
    fetalHeartRate: 'fetal_heart_rate',
    fetalPosition: 'fetal_position',
    clinicalFindings: 'clinical_findings',
    complicationsIdentified: 'complications_identified',
    assessment: 'assessment',
    carePlan: 'care_plan',
    referralNeeded: 'referral_needed',
    referralReason: 'referral_reason',
    referralFacility: 'referral_facility',
    notes: 'notes',
  };
  
  Object.keys(mappings).forEach(camelKey => {
    if (req.body[camelKey] !== undefined) {
      updateData[mappings[camelKey]] = req.body[camelKey];
    }
  });
  
  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  
  updateData.updated_at = new Date().toISOString();
  
  const { data: updated, error } = await supabase
    .from('pregnancy_encounters')
    .update(updateData)
    .eq('id', encounterId)
    .eq('pregnancy_id', pregnancyId)
    .select('*')
    .maybeSingle();
  
  if (error) throw error;
  if (!updated) throw ApiError.notFound('Encounter not found');
  
  res.json(transformEncounter(updated));
};

export const deletePrenatalEncounter = async (req, res) => {
  const { id: pregnancyId, encounterId } = req.params;
  
  if (!pregnancyId || !encounterId) {
    throw ApiError.badRequest('Pregnancy ID and encounter ID are required');
  }
  
  const supabase = getServiceClient();
  
  const { error } = await supabase
    .from('pregnancy_encounters')
    .delete()
    .eq('id', encounterId)
    .eq('pregnancy_id', pregnancyId);
  
  if (error) throw error;
  
  res.status(204).send();
};

// ============================================================================
// PRENATAL SERVICES
// ============================================================================

export const recordPrenatalService = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const service = await kalusagapService.recordPrenatalService(pregnancyId, req.body, {
    user: req.user,
    supabase,
  });
  
  res.status(201).json(transformService(service));
};

export const listPrenatalServices = async (req, res) => {
  const { id: pregnancyId } = req.params;
  const { status } = req.query;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  let query = supabase
    .from('prenatal_services')
    .select('*')
    .eq('pregnancy_id', pregnancyId);
  
  if (status) {
    query = query.eq('status', status);
  }
  
  const { data, error } = await query.order('created_at', { ascending: true });
  
  if (error) throw error;
  
  res.json(data?.map(transformService) || []);
};

export const getPrenatalService = async (req, res) => {
  const { id: pregnancyId, serviceId } = req.params;
  
  if (!pregnancyId || !serviceId) {
    throw ApiError.badRequest('Pregnancy ID and service ID are required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('prenatal_services')
    .select('*')
    .eq('id', serviceId)
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw ApiError.notFound('Service not found');
  
  res.json(transformService(data));
};

export const updatePrenatalService = async (req, res) => {
  const { id: pregnancyId, serviceId } = req.params;
  
  if (!pregnancyId || !serviceId) {
    throw ApiError.badRequest('Pregnancy ID and service ID are required');
  }
  
  const supabase = getServiceClient();
  
  const updateData = {};
  const mappings = {
    status: 'status',
    dateProvided: 'date_provided',
    resultStatus: 'result_status',
    resultValue: 'result_value',
    resultDate: 'result_date',
    resultNotes: 'result_notes',
    serviceDetails: 'service_details',
    dateDue: 'date_due',
    dateOverdueAfter: 'date_overdue_after',
    notesOnNonCompletion: 'notes_on_non_completion',
  };
  
  Object.keys(mappings).forEach(camelKey => {
    if (req.body[camelKey] !== undefined) {
      updateData[mappings[camelKey]] = req.body[camelKey];
    }
  });
  
  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  
  updateData.updated_at = new Date().toISOString();
  
  const { data: updated, error } = await supabase
    .from('prenatal_services')
    .update(updateData)
    .eq('id', serviceId)
    .eq('pregnancy_id', pregnancyId)
    .select('*')
    .maybeSingle();
  
  if (error) throw error;
  if (!updated) throw ApiError.notFound('Service not found');
  
  res.json(transformService(updated));
};

export const deletePrenatalService = async (req, res) => {
  const { id: pregnancyId, serviceId } = req.params;
  
  if (!pregnancyId || !serviceId) {
    throw ApiError.badRequest('Pregnancy ID and service ID are required');
  }
  
  const supabase = getServiceClient();
  
  const { error } = await supabase
    .from('prenatal_services')
    .delete()
    .eq('id', serviceId)
    .eq('pregnancy_id', pregnancyId);
  
  if (error) throw error;
  
  res.status(204).send();
};

// ============================================================================
// DELIVERY RECORDS
// ============================================================================

export const recordDelivery = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const delivery = await kalusagapService.recordDelivery(pregnancyId, req.body, {
    user: req.user,
    supabase,
  });
  
  res.status(201).json(transformDelivery(delivery));
};

export const getDeliveryRecord = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('delivery_records')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  if (error) throw error;
  
  if (!data) {
    return res.status(204).send();
  }
  
  res.json(transformDelivery(data));
};

export const updateDeliveryRecord = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const updateData = {};
  const mappings = {
    typeOfDelivery: 'type_of_delivery',
    placeOfDelivery: 'place_of_delivery',
    birthAttendant: 'birth_attendant',
    newbornSex: 'newborn_sex',
    birthWeightKg: 'birth_weight_kg',
    birthWeightClass: 'birth_weight_class',
    apgar1min: 'apgar_1min',
    apgar5min: 'apgar_5min',
    maternalComplications: 'maternal_complications',
    newbornComplications: 'newborn_complications',
    deliveryNotes: 'delivery_notes',
  };
  
  Object.keys(mappings).forEach(camelKey => {
    if (req.body[camelKey] !== undefined) {
      updateData[mappings[camelKey]] = req.body[camelKey];
    }
  });
  
  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  
  updateData.updated_at = new Date().toISOString();
  
  const { data: updated, error } = await supabase
    .from('delivery_records')
    .update(updateData)
    .eq('pregnancy_id', pregnancyId)
    .select('*')
    .maybeSingle();
  
  if (error) throw error;
  if (!updated) throw ApiError.notFound('Delivery record not found');
  
  res.json(transformDelivery(updated));
};

// ============================================================================
// POSTPARTUM ENCOUNTERS
// ============================================================================

export const addPostpartumEncounter = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  // Get delivery ID from pregnancy
  const { data: pregnancy, error: pregError } = await supabase
    .from('maternal_pregnancies')
    .select('id')
    .eq('id', pregnancyId)
    .maybeSingle();
  
  if (pregError) throw pregError;
  if (!pregnancy) throw ApiError.notFound('Pregnancy not found');
  
  const { data: delivery, error: delError } = await supabase
    .from('delivery_records')
    .select('id')
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  if (delError) throw delError;
  if (!delivery) throw ApiError.conflict('No delivery recorded for this pregnancy');
  
  const encounter = await kalusagapService.addPostpartumEncounter(delivery.id, req.body, {
    user: req.user,
    supabase,
  });
  
  res.status(201).json(transformPostpartumEncounter(encounter));
};

export const listPostpartumEncounters = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  // Get delivery ID
  const { data: delivery, error: delError } = await supabase
    .from('delivery_records')
    .select('id')
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  if (delError) throw delError;
  if (!delivery) {
    return res.json([]);
  }
  
  const { data, error } = await supabase
    .from('postpartum_encounters')
    .select('*')
    .eq('delivery_record_id', delivery.id)
    .order('encounter_date', { ascending: true });
  
  if (error) throw error;
  
  res.json(data?.map(transformPostpartumEncounter) || []);
};

export const getPostpartumEncounter = async (req, res) => {
  const { id: pregnancyId, encounterId } = req.params;
  
  if (!pregnancyId || !encounterId) {
    throw ApiError.badRequest('Pregnancy ID and encounter ID are required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('postpartum_encounters')
    .select('*')
    .eq('id', encounterId)
    .maybeSingle();
  
  if (error) throw error;
  if (!data) throw ApiError.notFound('Postpartum encounter not found');
  
  res.json(transformPostpartumEncounter(data));
};

export const updatePostpartumEncounter = async (req, res) => {
  const { id: pregnancyId, encounterId } = req.params;
  
  if (!pregnancyId || !encounterId) {
    throw ApiError.badRequest('Pregnancy ID and encounter ID are required');
  }
  
  const supabase = getServiceClient();
  
  const updateData = {};
  const mappings = {
    visitType: 'visit_type',
    systolicBp: 'systolic_bp',
    diastolicBp: 'diastolic_bp',
    temperatureCelsius: 'temperature_celsius',
    weightKg: 'weight_kg',
    uterineInvolutionStatus: 'uterine_involution_status',
    lochiaStatus: 'lochia_status',
    episiotomyWoundStatus: 'episiotomy_wound_status',
    breastExaminationFindings: 'breast_examination_findings',
    complicationsIdentified: 'complications_identified',
    referralNeeded: 'referral_needed',
    referralReason: 'referral_reason',
    referralFacility: 'referral_facility',
    ironFolicGiven: 'iron_folic_given',
    vitaminAGiven: 'vitamin_a_given',
    familyPlanningDiscussed: 'family_planning_discussed',
    familyPlanningMethodChosen: 'family_planning_method_chosen',
    newbornAssessed: 'newborn_assessed',
    newbornFindings: 'newborn_findings',
    newbornReferralNeeded: 'newborn_referral_needed',
    assessment: 'assessment',
    carePlan: 'care_plan',
    notes: 'notes',
  };
  
  Object.keys(mappings).forEach(camelKey => {
    if (req.body[camelKey] !== undefined) {
      updateData[mappings[camelKey]] = req.body[camelKey];
    }
  });
  
  if (Object.keys(updateData).length === 0) {
    throw ApiError.badRequest('No fields to update');
  }
  
  updateData.updated_at = new Date().toISOString();
  
  const { data: updated, error } = await supabase
    .from('postpartum_encounters')
    .update(updateData)
    .eq('id', encounterId)
    .select('*')
    .maybeSingle();
  
  if (error) throw error;
  if (!updated) throw ApiError.notFound('Postpartum encounter not found');
  
  res.json(transformPostpartumEncounter(updated));
};

export const deletePostpartumEncounter = async (req, res) => {
  const { id: pregnancyId, encounterId } = req.params;
  
  if (!pregnancyId || !encounterId) {
    throw ApiError.badRequest('Pregnancy ID and encounter ID are required');
  }
  
  const supabase = getServiceClient();
  
  const { error } = await supabase
    .from('postpartum_encounters')
    .delete()
    .eq('id', encounterId);
  
  if (error) throw error;
  
  res.status(204).send();
};

// ============================================================================
// POSTPARTUM FOLLOW-UP SCHEDULE
// ============================================================================

export const getPostpartumSchedule = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  // Get delivery ID
  const { data: delivery, error: delError } = await supabase
    .from('delivery_records')
    .select('id')
    .eq('pregnancy_id', pregnancyId)
    .maybeSingle();
  
  if (delError) throw delError;
  if (!delivery) {
    return res.json([]);
  }
  
  const { data, error } = await supabase
    .from('postpartum_follow_ups')
    .select('*')
    .eq('delivery_record_id', delivery.id)
    .order('expected_start_date', { ascending: true });
  
  if (error) throw error;
  
  res.json(data?.map(transformFollowUp) || []);
};

export const updatePostpartumMilestone = async (req, res) => {
  const { id: pregnancyId, milestoneId } = req.params;
  
  if (!pregnancyId || !milestoneId) {
    throw ApiError.badRequest('Pregnancy ID and milestone ID are required');
  }
  
  const supabase = getServiceClient();
  
  const updateData = {
    status: req.body.status || 'pending',
    scheduled_date: req.body.scheduledDate || req.body.scheduled_date || null,
    updated_at: new Date().toISOString(),
  };
  
  const { data: updated, error } = await supabase
    .from('postpartum_follow_ups')
    .update(updateData)
    .eq('id', milestoneId)
    .select('*')
    .maybeSingle();
  
  if (error) throw error;
  if (!updated) throw ApiError.notFound('Follow-up milestone not found');
  
  res.json(transformFollowUp(updated));
};

// ============================================================================
// MATERNAL PROFILE & REPORTS
// ============================================================================

export const listResidentPregnancies = async (req, res) => {
  const { residentId } = req.params;
  
  if (!residentId) {
    throw ApiError.badRequest('Resident ID is required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('maternal_pregnancies')
    .select('*')
    .eq('resident_id', residentId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  res.json(data?.map(transformPregnancy) || []);
};

export const getMaternalProfile = async (req, res) => {
  const { pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const profile = await kalusagapService.getMaternalProfile(pregnancyId, { supabase });
  
  res.json({
    pregnancy: transformPregnancy(profile.pregnancy),
    encounters: profile.encounters.map(transformEncounter),
    services: profile.services.map(transformService),
    delivery: profile.delivery ? transformDelivery(profile.delivery) : null,
    postpartumEncounters: profile.postpartumEncounters.map(transformPostpartumEncounter),
    postpartumSchedule: profile.postpartumSchedule.map(transformFollowUp),
  });
};

export const getServicesDueOrOverdue = async (req, res) => {
  const { id: pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const today = kalusagapService.manilaDateString();
  
  const { data, error } = await supabase
    .from('prenatal_services')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .in('status', ['pending', 'due', 'overdue'])
    .order('date_due', { ascending: true });
  
  if (error) throw error;
  
  // Mark as due/overdue based on date comparison
  const servicesWithStatus = (data || []).map(s => {
    let status = s.status;
    if (status === 'pending' && s.date_due && s.date_due <= today) {
      status = s.date_overdue_after && s.date_overdue_after < today ? 'overdue' : 'due';
    }
    return { ...transformService(s), status };
  });
  
  res.json(servicesWithStatus);
};

export const getMaternalAuditLog = async (req, res) => {
  const { pregnancyId } = req.params;
  
  if (!pregnancyId) {
    throw ApiError.badRequest('Pregnancy ID is required');
  }
  
  const supabase = getServiceClient();
  
  const { data, error } = await supabase
    .from('maternal_care_audit_log')
    .select('*')
    .eq('pregnancy_id', pregnancyId)
    .order('created_at', { ascending: false });
  
  if (error) throw error;
  
  res.json(data || []);
};

// ============================================================================
// TRANSFORMATION HELPERS (snake_case -> camelCase)
// ============================================================================

const transformPregnancy = (pregnancy) => ({
  id: pregnancy.id,
  residentId: pregnancy.resident_id,
  status: pregnancy.status,
  pregnancyNumber: pregnancy.pregnancy_number,
  parityBeforePregnancy: pregnancy.parity_before_pregnancy,
  lmpDate: pregnancy.lmp_date,
  lmpReliability: pregnancy.lmp_reliability,
  eddDate: pregnancy.edd_date,
  eddSource: pregnancy.edd_source,
  pregnancyDatingMethod: pregnancy.pregnancy_dating_method,
  gravida: pregnancy.gravida,
  para: pregnancy.para,
  currentGestationalAgeWeeks: pregnancy.current_gestational_age_weeks,
  currentGestationalAgeCalculatedAt: pregnancy.current_gestational_age_calculated_at,
  dateOfRegistration: pregnancy.date_of_registration,
  registeredBy: pregnancy.registered_by,
  socioEconomicStatus: pregnancy.socio_economic_status,
  primaryProvider: pregnancy.primary_provider,
  outcome: pregnancy.outcome,
  outcomeDate: pregnancy.outcome_date,
  outcomeNotes: pregnancy.outcome_notes,
  riskLevel: pregnancy.risk_level,
  riskAssessmentDate: pregnancy.risk_assessment_date,
  riskNotes: pregnancy.risk_notes,
  createdAt: pregnancy.created_at,
  updatedAt: pregnancy.updated_at,
});

const transformEncounter = (encounter) => ({
  id: encounter.id,
  pregnancyId: encounter.pregnancy_id,
  residentId: encounter.resident_id,
  encounterType: encounter.encounter_type,
  encounterDate: encounter.encounter_date,
  encounterNumber: encounter.encounter_number,
  providerId: encounter.provider_id,
  providerName: encounter.provider_name,
  gestationalAgeWeeks: encounter.gestational_age_weeks,
  gestationalAgeSource: encounter.gestational_age_source,
  systolicBp: encounter.systolic_bp,
  diastolicBp: encounter.diastolic_bp,
  weightKg: encounter.weight_kg,
  heightCm: encounter.height_cm,
  bmi: encounter.bmi,
  fundalHeightCm: encounter.fundal_height_cm,
  fetalHeartRate: encounter.fetal_heart_rate,
  fetalPosition: encounter.fetal_position,
  clinicalFindings: encounter.clinical_findings,
  complicationsIdentified: encounter.complications_identified,
  assessment: encounter.assessment,
  carePlan: encounter.care_plan,
  nextVisitPlannedDate: encounter.next_visit_planned_date,
  referralNeeded: encounter.referral_needed,
  referralReason: encounter.referral_reason,
  referralFacility: encounter.referral_facility,
  servicesProvided: encounter.services_provided,
  notes: encounter.notes,
  createdAt: encounter.created_at,
  updatedAt: encounter.updated_at,
});

const transformService = (service) => ({
  id: service.id,
  pregnancyId: service.pregnancy_id,
  residentId: service.resident_id,
  serviceCategory: service.service_category,
  serviceType: service.service_type,
  serviceName: service.service_name,
  status: service.status,
  dateProvided: service.date_provided,
  providerId: service.provider_id,
  providerName: service.provider_name,
  resultStatus: service.result_status,
  resultValue: service.result_value,
  resultDate: service.result_date,
  resultNotes: service.result_notes,
  serviceDetails: service.service_details,
  dateDue: service.date_due,
  dateOverdueAfter: service.date_overdue_after,
  notesOnNonCompletion: service.notes_on_non_completion,
  createdAt: service.created_at,
  updatedAt: service.updated_at,
});

const transformDelivery = (delivery) => ({
  id: delivery.id,
  pregnancyId: delivery.pregnancy_id,
  residentId: delivery.resident_id,
  deliveryDate: delivery.delivery_date,
  deliveryTime: delivery.delivery_time,
  deliveryOutcome: delivery.delivery_outcome,
  typeOfDelivery: delivery.type_of_delivery,
  placeOfDelivery: delivery.place_of_delivery,
  birthAttendant: delivery.birth_attendant,
  newbornSex: delivery.newborn_sex,
  birthWeightKg: delivery.birth_weight_kg,
  birthWeightClass: delivery.birth_weight_class,
  apgar1min: delivery.apgar_1min,
  apgar5min: delivery.apgar_5min,
  maternalComplications: delivery.maternal_complications,
  newbornComplications: delivery.newborn_complications,
  deliveryNotes: delivery.delivery_notes,
  postpartumScheduleGenerated: delivery.postpartum_schedule_generated,
  recordedAt: delivery.recorded_at,
  createdAt: delivery.created_at,
  updatedAt: delivery.updated_at,
});

const transformPostpartumEncounter = (encounter) => ({
  id: encounter.id,
  pregnancyId: encounter.pregnancy_id,
  deliveryRecordId: encounter.delivery_record_id,
  residentId: encounter.resident_id,
  encounterDate: encounter.encounter_date,
  encounterNumber: encounter.encounter_number,
  daysPostpartum: encounter.days_postpartum,
  visitType: encounter.visit_type,
  scheduledMilestone: encounter.scheduled_milestone,
  providerId: encounter.provider_id,
  providerName: encounter.provider_name,
  visitLocation: encounter.visit_location,
  systolicBp: encounter.systolic_bp,
  diastolicBp: encounter.diastolic_bp,
  temperatureCelsius: encounter.temperature_celsius,
  weightKg: encounter.weight_kg,
  uterineInvolutionStatus: encounter.uterine_involution_status,
  lochiaStatus: encounter.lochia_status,
  episiotomyWoundStatus: encounter.episiotomy_wound_status,
  breastExaminationFindings: encounter.breast_examination_findings,
  complicationsIdentified: encounter.complications_identified,
  referralNeeded: encounter.referral_needed,
  referralReason: encounter.referral_reason,
  referralFacility: encounter.referral_facility,
  ironFolicGiven: encounter.iron_folic_given,
  vitaminAGiven: encounter.vitamin_a_given,
  familyPlanningDiscussed: encounter.family_planning_discussed,
  familyPlanningMethodChosen: encounter.family_planning_method_chosen,
  newbornAssessed: encounter.newborn_assessed,
  newbornFindings: encounter.newborn_findings,
  newbornReferralNeeded: encounter.newborn_referral_needed,
  servicesProvided: encounter.services_provided,
  assessment: encounter.assessment,
  carePlan: encounter.care_plan,
  nextVisitPlannedDate: encounter.next_visit_planned_date,
  notes: encounter.notes,
  createdAt: encounter.created_at,
  updatedAt: encounter.updated_at,
});

const transformFollowUp = (followUp) => ({
  id: followUp.id,
  pregnancyId: followUp.pregnancy_id,
  deliveryRecordId: followUp.delivery_record_id,
  residentId: followUp.resident_id,
  milestone: followUp.milestone,
  daysFromDelivery: followUp.days_from_delivery,
  expectedStartDate: followUp.expected_start_date,
  expectedEndDate: followUp.expected_end_date,
  status: followUp.status,
  scheduledDate: followUp.scheduled_date,
  completedDate: followUp.completed_date,
  createdAt: followUp.created_at,
  updatedAt: followUp.updated_at,
});

export default {
  checkPregnancyStatus,
  registerPregnancy,
  getPregnancy,
  updatePregnancy,
  addPrenatalEncounter,
  listPrenatalEncounters,
  getPrenatalEncounter,
  updatePrenatalEncounter,
  deletePrenatalEncounter,
  recordPrenatalService,
  listPrenatalServices,
  getPrenatalService,
  updatePrenatalService,
  deletePrenatalService,
  recordDelivery,
  getDeliveryRecord,
  updateDeliveryRecord,
  addPostpartumEncounter,
  listPostpartumEncounters,
  getPostpartumEncounter,
  updatePostpartumEncounter,
  deletePostpartumEncounter,
  getPostpartumSchedule,
  updatePostpartumMilestone,
  listResidentPregnancies,
  getMaternalProfile,
  getServicesDueOrOverdue,
  getMaternalAuditLog,
};

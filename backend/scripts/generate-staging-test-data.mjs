#!/usr/bin/env node
/**
 * Generate synthetic test data for KALUSAGAP staging environment.
 * 
 * Creates:
 * - 1000+ residents
 * - 5000+ consultations
 * - 100+ households
 * - 50+ referrals
 * - 20+ health services
 * 
 * Distributed across San Antonio, San Isidro, and Old San Roque.
 * 
 * Usage:
 *   node scripts/generate-staging-test-data.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '..', '.env') });

const BARANGAYS = ['San Antonio', 'San Isidro', 'Old San Roque'];
const FIRST_NAMES = [
  'Maria', 'Jose', 'Juan', 'Ana', 'Pedro', 'Rosa', 'Miguel', 'Carmen',
  'Antonio', 'Elena', 'Carlos', 'Isabel', 'Manuel', 'Teresa', 'Francisco',
  'Luz', 'Ramon', 'Nena', 'Ricardo', 'Gloria', 'Roberto', 'Luisa', 'Fernando',
  'Angelina', 'Rafael', 'Rosario', 'Ernesto', 'Victoria', 'Alberto', 'Dolores',
  'Enrique', 'Josefa', 'Domingo', 'Remedios', 'Salvador', 'Esperanza', 'Raul',
  'Concepcion', 'Eduardo', 'Felisa', 'Luis', 'Pacita', 'Alfredo', 'Milagros'
];

const LAST_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Bautista', 'Garcia', 'Mendoza', 'Torres',
  'Rodriguez', 'Fernandez', 'Lopez', 'Gonzales', 'Flores', 'Ramos', 'Villanueva',
  'Rivera', 'Martinez', 'dela Cruz', 'Castillo', 'Aquino', 'Navarro', 'Morales',
  'Tan', 'Lim', 'Go', 'Chua', 'Ong', 'Sy', 'Alvarez', 'Santiago', 'Pascual'
];

const CHIEF_COMPLAINTS = [
  'Fever', 'Cough', 'Headache', 'Abdominal pain', 'Diarrhea', 'Vomiting',
  'Body weakness', 'Difficulty breathing', 'Chest pain', 'Sore throat',
  'Muscle pain', 'Joint pain', 'Back pain', 'Dizziness', 'Nausea',
  'High blood pressure', 'Diabetes follow-up', 'Prenatal checkup', 'Skin rash',
  'Dental problem', 'Eye irritation', 'Ear pain', 'Toothache'
];

const DIAGNOSES = [
  'Upper respiratory tract infection', 'Acute gastroenteritis', 'Hypertension',
  'Type 2 Diabetes Mellitus', 'Pneumonia', 'Urinary tract infection',
  'Acute bronchitis', 'Dengue fever', 'Skin infection', 'Conjunctivitis',
  'Otitis media', 'Low risk pregnancy', 'Musculoskeletal pain', 'Migraine',
  'Anxiety disorder', 'Essential hypertension', 'Gastritis', 'Tonsillitis'
];

const RISK_LEVELS = ['low', 'medium', 'high'];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function generatePhoneNumber() {
  return `09${randomInt(100000000, 999999999)}`;
}

function generateEmail(firstName, lastName) {
  const sanitized = `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, '')}`;
  return `${sanitized}${randomInt(1, 999)}@test.kalusagap.local`;
}

async function main() {
  const apply = process.argv.includes('--apply');

  if (!apply) {
    console.log('');
    console.log('KALUSAGAP Staging Test Data Generator');
    console.log('======================================');
    console.log('');
    console.log('This script will generate synthetic test data:');
    console.log('  - 1000+ residents');
    console.log('  - 5000+ consultations');
    console.log('  - 100+ households');
    console.log('  - 50+ referrals');
    console.log('  - 20+ health services');
    console.log('');
    console.log('Data will be distributed across: San Antonio, San Isidro, Old San Roque');
    console.log('');
    console.log('Run with --apply to execute:');
    console.log('  node scripts/generate-staging-test-data.mjs --apply');
    console.log('');
    return;
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in backend/.env');
    process.exit(1);
  }

  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  console.log('Starting test data generation...');
  console.log('');

  // Step 1: Generate residents (1200 total)
  console.log('Step 1/5: Creating 1200 residents...');
  const residents = [];
  const residentsByBarangay = { 'San Antonio': [], 'San Isidro': [], 'Old San Roque': [] };

  for (let i = 0; i < 1200; i++) {
    const firstName = randomChoice(FIRST_NAMES);
    const lastName = randomChoice(LAST_NAMES);
    const barangay = randomChoice(BARANGAYS);
    const birthDate = randomDate(new Date(1950, 0, 1), new Date(2020, 0, 1));
    const age = Math.floor((Date.now() - birthDate.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    
    const resident = {
      first_name: firstName,
      last_name: lastName,
      middle_name: randomChoice(FIRST_NAMES),
      birth_date: birthDate.toISOString().split('T')[0],
      sex: randomChoice(['male', 'female']),
      barangay,
      purok: `Purok ${randomInt(1, 10)}`,
      street_address: `${randomInt(1, 200)} ${randomChoice(['Main', 'Market', 'Church', 'School', 'Barangay'])} Street`,
      contact_number: generatePhoneNumber(),
      email: generateEmail(firstName, lastName),
      civil_status: randomChoice(['single', 'married', 'widowed', 'separated']),
      occupation: randomChoice(['Farmer', 'Teacher', 'Driver', 'Vendor', 'Student', 'Unemployed', 'Retired']),
      emergency_contact_name: `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`,
      emergency_contact_number: generatePhoneNumber(),
      risk_level: randomChoice(RISK_LEVELS),
      status: 'verified',
      verification_status: 'approved'
    };

    residents.push(resident);
    residentsByBarangay[barangay].push(resident);

    if ((i + 1) % 200 === 0) {
      console.log(`  Created ${i + 1} residents...`);
    }
  }

  const { data: insertedResidents, error: residentError } = await supabase
    .from('residents')
    .insert(residents)
    .select('id, barangay');

  if (residentError) {
    console.error('Error inserting residents:', residentError);
    process.exit(1);
  }

  console.log(`✓ Created ${insertedResidents.length} residents`);
  console.log('');

  // Step 2: Generate households (120 total)
  console.log('Step 2/5: Creating 120 households...');
  const households = [];

  for (const barangay of BARANGAYS) {
    const barangayResidents = insertedResidents.filter(r => r.barangay === barangay);
    
    for (let i = 0; i < 40; i++) {
      const headResident = randomChoice(barangayResidents);
      
      const household = {
        household_head_resident_id: headResident.id,
        barangay,
        purok: `Purok ${randomInt(1, 10)}`,
        street_address: `${randomInt(1, 200)} ${randomChoice(['Main', 'Market', 'Church', 'School', 'Barangay'])} Street`,
        household_size: randomInt(2, 8),
        has_functional_toilet: Math.random() > 0.2,
        has_safe_water_source: Math.random() > 0.15,
        has_electricity: Math.random() > 0.1,
        has_proper_waste_disposal: Math.random() > 0.25,
        risk_classification: randomChoice(['low', 'moderate', 'high'])
      };

      households.push(household);
    }
  }

  const { data: insertedHouseholds, error: householdError } = await supabase
    .from('households')
    .insert(households)
    .select('id, barangay');

  if (householdError) {
    console.error('Error inserting households:', householdError);
    process.exit(1);
  }

  console.log(`✓ Created ${insertedHouseholds.length} households`);
  console.log('');

  // Step 3: Generate consultations (5500 total)
  console.log('Step 3/5: Creating 5500 consultations...');
  const consultations = [];
  const startDate = new Date(2024, 0, 1);
  const endDate = new Date();

  for (let i = 0; i < 5500; i++) {
    const resident = randomChoice(insertedResidents);
    const consultDate = randomDate(startDate, endDate);
    
    const consultation = {
      resident_id: resident.id,
      barangay: resident.barangay,
      consultation_date: consultDate.toISOString().split('T')[0],
      chief_complaint: randomChoice(CHIEF_COMPLAINTS),
      vital_signs: {
        temperature: (36 + Math.random() * 2.5).toFixed(1),
        blood_pressure: `${randomInt(100, 150)}/${randomInt(60, 90)}`,
        pulse_rate: randomInt(60, 100),
        respiratory_rate: randomInt(12, 20),
        weight: randomInt(40, 100),
        height: randomInt(140, 180)
      },
      diagnosis: randomChoice(DIAGNOSES),
      treatment_plan: 'Medications prescribed, follow-up in 1 week',
      medications: [
        { name: randomChoice(['Paracetamol', 'Amoxicillin', 'Ibuprofen', 'Cetirizine']), dosage: '500mg', frequency: '3x daily' }
      ],
      follow_up_date: new Date(consultDate.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: randomChoice(['completed', 'for-follow-up', 'referred'])
    };

    consultations.push(consultation);

    if ((i + 1) % 1000 === 0) {
      console.log(`  Created ${i + 1} consultations...`);
    }
  }

  const { data: insertedConsultations, error: consultError } = await supabase
    .from('consultations')
    .insert(consultations)
    .select('id, resident_id, barangay, status');

  if (consultError) {
    console.error('Error inserting consultations:', consultError);
    process.exit(1);
  }

  console.log(`✓ Created ${insertedConsultations.length} consultations`);
  console.log('');

  // Step 4: Generate referrals (60 total)
  console.log('Step 4/5: Creating 60 referrals...');
  const referrals = [];
  const referredConsultations = insertedConsultations.filter(c => c.status === 'referred').slice(0, 60);

  for (const consultation of referredConsultations) {
    const referral = {
      resident_id: consultation.resident_id,
      source_barangay: consultation.barangay,
      referring_facility: 'Barangay Health Station',
      referred_to_facility: randomChoice(['Pili Rural Health Unit', 'Bicol Medical Center', 'Provincial Hospital']),
      referral_date: new Date().toISOString().split('T')[0],
      reason_for_referral: 'Requires specialized care and diagnostic procedures',
      clinical_summary: 'Patient needs further evaluation and management',
      urgency_level: randomChoice(['routine', 'urgent', 'emergency']),
      status: randomChoice(['pending', 'accepted', 'completed']),
      specialty_needed: randomChoice(['Internal Medicine', 'Surgery', 'OB-GYN', 'Pediatrics'])
    };

    referrals.push(referral);
  }

  const { data: insertedReferrals, error: referralError } = await supabase
    .from('health_referrals')
    .insert(referrals)
    .select('id');

  if (referralError) {
    console.error('Error inserting referrals:', referralError);
    process.exit(1);
  }

  console.log(`✓ Created ${insertedReferrals.length} referrals`);
  console.log('');

  // Step 5: Generate health services (25 total)
  console.log('Step 5/5: Creating 25 health services...');
  const services = [];
  const serviceTypes = [
    'Immunization', 'Prenatal Care', 'Family Planning', 'Deworming',
    'Nutrition Program', 'Hypertension Screening', 'Diabetes Screening'
  ];

  for (const barangay of BARANGAYS) {
    for (let i = 0; i < 8; i++) {
      const serviceDate = randomDate(new Date(2024, 0, 1), new Date());
      
      const service = {
        service_type: randomChoice(serviceTypes),
        barangay,
        location: `${barangay} Health Center`,
        service_date: serviceDate.toISOString().split('T')[0],
        scheduled_time: `${randomInt(8, 16)}:00`,
        capacity: randomInt(20, 50),
        attendees_count: randomInt(10, 40),
        status: randomChoice(['scheduled', 'ongoing', 'completed']),
        description: 'Community health service program'
      };

      services.push(service);
    }
  }

  const { data: insertedServices, error: serviceError } = await supabase
    .from('health_services')
    .insert(services)
    .select('id');

  if (serviceError) {
    console.error('Error inserting health services:', serviceError);
    process.exit(1);
  }

  console.log(`✓ Created ${insertedServices.length} health services`);
  console.log('');

  // Summary
  console.log('=====================================');
  console.log('Test Data Generation Complete!');
  console.log('=====================================');
  console.log(`Residents:      ${insertedResidents.length}`);
  console.log(`Households:     ${insertedHouseholds.length}`);
  console.log(`Consultations:  ${insertedConsultations.length}`);
  console.log(`Referrals:      ${insertedReferrals.length}`);
  console.log(`Health Services: ${insertedServices.length}`);
  console.log('');
  console.log('Distribution by barangay:');
  for (const barangay of BARANGAYS) {
    const count = insertedResidents.filter(r => r.barangay === barangay).length;
    console.log(`  ${barangay}: ${count} residents`);
  }
  console.log('');
}

main().catch(console.error);

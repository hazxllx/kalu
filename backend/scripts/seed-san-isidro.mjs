/**
 * Idempotent San Isidro demonstration-data initializer.
 *
 * Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and one password variable
 * per newly provisioned account (never committed here). Run with --apply.
 */
import '../src/config/env.js';
import { createClient } from '@supabase/supabase-js';

const apply = process.argv.includes('--apply');
const resetAccountArg = process.argv.find((arg) => arg.startsWith('--reset-account='));
const resetAccountEmail = resetAccountArg ? resetAccountArg.slice('--reset-account='.length).trim().toLowerCase() : '';
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
if (!apply) { console.log('CHECK ONLY: re-run with --apply to write San Isidro data.'); process.exit(0); }

const db = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
const q = async (promise, label) => { const { data, error } = await promise; if (error) throw new Error(`${label}: ${error.message}`); return data; };
const password = (name) => { const value = process.env[name]; if (!value) throw new Error(`Missing ${name}`); return value; };

const accounts = [
  { email: 'admin_kalusagap@gmail.com', name: 'KALUSAGAP System Administrator', role: 'admin', scope: 'none', env: 'KALUSAGAP_ADMIN_KALUSAGAP_PASSWORD' },
  { email: 'mho@gmail.com', name: 'Municipal Health Officer', role: 'mho', scope: 'municipality', env: 'KALUSAGAP_MHO_GMAIL_PASSWORD' },
  { email: 'phn@gmail.com', name: 'Public Health Nurse', role: 'phn', scope: 'municipality', env: 'KALUSAGAP_PHN_GMAIL_PASSWORD' },
  { email: 'vorimop692@comzx.com', name: 'RHU Triage Personnel', role: 'rhu_personnel', scope: 'municipality', station: 'triage', env: 'KALUSAGAP_RHU_TRIAGE_PASSWORD' },
  { email: 'decikax149@aahzz.com', name: 'RHU Consultation Personnel', role: 'rhu_personnel', scope: 'municipality', station: 'consultation', env: 'KALUSAGAP_RHU_CONSULTATION_PASSWORD' },
  { email: 'mabami5@leafflip.com', name: 'Lourdes Elena Mercado', role: 'health_supervisor', barangay: 'San Isidro', env: 'KALUSAGAP_SAN_ISIDRO_SUPERVISOR_PASSWORD' },
  { email: 'falodo8820@meinvr.com', name: 'Maria Teresa Dela Cruz', role: 'bhw', barangay: 'San Isidro', env: 'KALUSAGAP_SAN_ISIDRO_BHW1_PASSWORD' },
  { email: 'bhw.sanisidro2@kalusagap.test', name: 'Josephine Mae Villanueva', role: 'bhw', barangay: 'San Isidro', env: 'KALUSAGAP_SAN_ISIDRO_BHW2_PASSWORD' },
  { email: 'xenahov787@juicehour.com', name: 'Anita Abad', role: 'health_supervisor', barangay: 'Old San Roque', env: 'KALUSAGAP_OLD_SAN_ROQUE_SUPERVISOR_PASSWORD' },
  { email: 'wimamix617@ensproxy.com', name: 'Wilma Mae Salazar', role: 'bhw', barangay: 'Old San Roque', env: 'KALUSAGAP_OLD_SAN_ROQUE_BHW_PASSWORD' },
];

const residents = [
  ['SI-001','Dela Cruz','Ramon','Santos','', '1948-03-12','Male','Married','09171234001','High','Purok 1, San Isidro, Pili'],
  ['SI-002','Villanueva','Rosario','Gomez','', '1952-11-04','Female','Widowed','09171234002','High','Purok 1, San Isidro, Pili'],
  ['SI-003','Mercado','Edgardo','Reyes','', '1961-07-28','Male','Married','09171234003','High','Purok 2, San Isidro, Pili'],
  ['SI-004','Santos','Gloria','Mendoza','', '1968-01-19','Female','Married','09171234004','High','Purok 2, San Isidro, Pili'],
  ['SI-005','Reyes','Maricel','Alcantara','', '1974-06-09','Female','Married','09171234005','Moderate','Purok 3, San Isidro, Pili'],
  ['SI-006','Mendoza','Danilo','Cabrera','', '1979-09-21','Male','Married','09171234006','Moderate','Purok 3, San Isidro, Pili'],
  ['SI-007','Alcantara','Nena','Bautista','', '1982-02-14','Female','Single','09171234007','Moderate','Purok 4, San Isidro, Pili'],
  ['SI-008','Cabrera','Joel','Navarro','', '1985-12-03','Male','Married','09171234008','Moderate','Purok 4, San Isidro, Pili'],
  ['SI-009','Bautista','Elena','Flores','', '1988-04-26','Female','Married','09171234009','Moderate','Purok 5, San Isidro, Pili'],
  ['SI-010','Navarro','Celia','Ramos','', '1990-10-17','Female','Single','09171234010','Moderate','Purok 5, San Isidro, Pili'],
  ['SI-011','Flores','Mark Anthony','Rivera','', '1993-05-30','Male','Single','09171234011','Moderate','Purok 1, San Isidro, Pili'],
  ['SI-012','Ramos','Angela','Torres','', '1996-08-11','Female','Married','09171234012','Low','Purok 2, San Isidro, Pili'],
  ['SI-013','Rivera','Paolo Miguel','Diaz','', '2000-01-06','Male','Single','09171234013','Low','Purok 3, San Isidro, Pili'],
  ['SI-014','Torres','Beatriz','Lim','', '2001-03-22','Female','Single','09171234014','Low','Purok 4, San Isidro, Pili'],
  ['SI-015','Diaz','Carla Mae','Ocampo','', '2003-07-15','Female','Single','09171234015','Low','Purok 5, San Isidro, Pili'],
  ['SI-016','Lim','Joshua','Manalo','', '2007-09-02','Male','Single','09171234016','Low','Purok 1, San Isidro, Pili'],
  ['SI-017','Ocampo','Sofia','Garcia','', '2010-12-18','Female','Single','09171234017','Low','Purok 2, San Isidro, Pili'],
  ['SI-018','Manalo','Miguel','Cruz','', '2013-02-27','Male','Single','09171234018','Low','Purok 3, San Isidro, Pili'],
  ['SI-019','Garcia','Liza','Fernandez','', '1992-11-23','Female','Married','09171234019','Low','Purok 4, San Isidro, Pili'],
  ['SI-020','Cruz','Noel','Hernandez','', '1998-06-13','Male','Single','09171234020','Low','Purok 5, San Isidro, Pili'],
];

// Clearly synthetic encounters used only to exercise the consultation workflow.
// These IDs are deliberately stable so re-running the initializer never creates
// duplicate encounters or changes an existing clinical record.
const demonstrationConsultations = [
  ['DEMO-CONSULT-SI-001', 'SI-001', '2026-09-18', '09:10', '1f510001-0000-4000-8000-000000000001', 'Blood pressure monitoring', '138/86', 36.7, 72, 18, 165, 68, 'Medium', 'Screening reading was rechecked after rest; no urgent symptoms reported in this demonstration scenario.', 'Demonstration only: repeat blood-pressure screening and lifestyle counselling.', 'Continue home blood-pressure log and return for a scheduled reassessment.', '2026-10-02', 'Scheduled'],
  ['DEMO-CONSULT-SI-002', 'SI-002', '2026-10-03', '10:20', '1f510002-0000-4000-8000-000000000002', 'Older adult wellness consultation', '124/78', 36.5, 68, 17, 153, 58, 'Low', 'Routine wellness screening values were within the demonstration reference range.', 'Demonstration only: preventive counselling provided; no medicine dispensed.', 'Maintain hydration, activity as tolerated, and routine wellness monitoring.', '', ''],
  ['DEMO-CONSULT-SI-003', 'SI-003', '2026-10-21', '08:45', '1f510003-0000-4000-8000-000000000003', 'Cardiovascular risk screening', '156/96', 36.8, 80, 18, 168, 79, 'High', 'Repeat screening remained elevated; the scenario has no danger-sign symptoms.', 'Demonstration only: non-emergency referral guidance and blood-pressure reassessment plan.', 'Seek clinician review as scheduled; bring a home blood-pressure log.', '2026-11-04', 'Completed'],
  ['DEMO-CONSULT-SI-004', 'SI-005', '2026-11-05', '13:30', '1f510004-0000-4000-8000-000000000004', 'Nutrition and BMI counselling', '128/82', 36.6, 76, 18, 158, 72, 'Medium', 'BMI and screening blood pressure discussed as part of this synthetic training record.', 'Demonstration only: nutrition, activity, and weight-management counselling.', 'Use a balanced meal plan and return for progress review.', '2026-11-26', 'Scheduled'],
  ['DEMO-CONSULT-SI-005', 'SI-008', '2026-11-09', '11:05', '1f510005-0000-4000-8000-000000000005', 'General consultation', '118/74', 36.4, 70, 16, 171, 70, 'Low', 'No concerning screening findings documented for this demonstration encounter.', 'Demonstration only: self-care education and routine monitoring advice.', 'Return if symptoms develop; continue routine preventive care.', '', ''],
  ['DEMO-CONSULT-SI-006', 'SI-010', '2026-11-14', '14:15', '1f510006-0000-4000-8000-000000000006', 'Health education consultation', '132/84', 36.7, 74, 18, 160, 64, 'Medium', 'Borderline screening result reviewed; this is synthetic training content, not a clinical diagnosis.', 'Demonstration only: lifestyle and repeat-screening education.', 'Schedule a repeat blood-pressure screening in two weeks.', '2026-11-28', 'Scheduled'],
  ['DEMO-CONSULT-SI-007', 'SI-012', '2026-11-18', '09:40', '1f510007-0000-4000-8000-000000000007', 'Preventive health consultation', '116/72', 36.5, 66, 16, 155, 54, 'Low', 'Preventive screening completed with no follow-up needed in this demonstration record.', 'Demonstration only: preventive health education.', 'Continue routine community health monitoring.', '', ''],
  ['DEMO-CONSULT-SI-008', 'SI-015', '2026-11-22', '15:00', '1f510008-0000-4000-8000-000000000008', 'General consultation', '146/92', 36.9, 82, 19, 157, 69, 'High', 'Repeat screening remained elevated; no emergency symptoms are represented in this demonstration scenario.', 'Demonstration only: prompt outpatient reassessment guidance.', 'Attend the planned reassessment and seek urgent care if warning symptoms occur.', '2026-12-01', 'Pending'],
];

const main = async () => {
  const muni = await q(db.from('municipalities').select('id').eq('name','Pili').eq('province','Camarines Sur').single(), 'municipality lookup');
  const rhu = await q(db.from('facilities').select('id').eq('municipality_id', muni.id).eq('name', 'RHU').eq('type', 'rhu').single(), 'RHU facility lookup');
  const barangays = await q(db.from('barangays').select('id,name').eq('municipality_id', muni.id).in('name', ['San Isidro', 'Old San Roque']), 'barangay lookup');
  const brgyByName = new Map(barangays.map((b) => [b.name, b.id]));
  const brgy = { id: brgyByName.get('San Isidro') };
  if (!brgy.id || !brgyByName.get('Old San Roque')) throw new Error('Both San Isidro and Old San Roque must already exist under Pili.');
  const auth = {};
  for (const a of accounts) {
    const listed = await q(db.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'auth user list');
    let user = listed.users.find((u) => u.email?.toLowerCase() === a.email.toLowerCase());
    if (!user) user = (await q(db.auth.admin.createUser({ email: a.email, password: password(a.env), email_confirm: true, user_metadata: { full_name: a.name } }), `create ${a.email}`)).user;
    if (resetAccountEmail === a.email.toLowerCase()) {
      await q(db.auth.admin.updateUserById(user.id, { password: password(a.env), email_confirm: true }), `reset password ${a.email}`);
    }
    const profile = { id: user.id, email: a.email, full_name: a.name, role: a.role, status: 'active', municipality_id: a.scope === 'none' ? null : muni.id, barangay_id: a.barangay ? brgyByName.get(a.barangay) : null };
    if (a.role === 'rhu_personnel') Object.assign(profile, { facility_id: rhu.id, rhu_stations: [a.station] });
    await q(db.from('profiles').upsert(profile, { onConflict: 'id' }), `profile ${a.email}`);
    if (a.email === 'falodo8820@meinvr.com') auth.bhw1 = user.id;
    if (a.email === 'bhw.sanisidro2@kalusagap.test') auth.bhw2 = user.id;
    if (a.email === 'mabami5@leafflip.com') auth.supervisor = user.id;
    if (a.email === 'decikax149@aahzz.com') auth.consultation = user.id;
    if (a.email === 'xenahov787@juicehour.com') auth.oldSanRoqueSupervisor = user.id;
    if (a.email === 'wimamix617@ensproxy.com') auth.oldSanRoqueBhw = user.id;
  }
  // These demonstration accounts are created directly for repeatable local
  // data setup. Give their already-confirmed, active staff profiles the same
  // lifecycle records required by the scoped personnel-management RPCs.
  // The reconciliation function only admits trusted non-resident identities,
  // and is idempotent, so re-running this seed cannot duplicate lifecycle rows.
  await q(db.rpc('reconcile_provisioned_personnel'), 'reconcile seeded personnel lifecycle');
  const rows = residents.map(([id,last,first,middle,suffix,birth,sex,civil,cell,risk,address]) => ({ id, health_record_no: `HRN-SI-${id.slice(3)}`, last_name:last, first_name:first, middle_name:middle, suffix, birth_date:birth, sex, civil_status:civil, cellphone_no:cell, current_address:address, permanent_address:address, barangay:'San Isidro', barangay_id:brgy.id, municipality_id:muni.id, verification_status:'approved', verified_by:auth.supervisor, verified_at:'2026-11-20T09:00:00Z', risk_level:risk, risk_score:risk==='High'?80:risk==='Moderate'?45:10 }));
  await q(db.from('residents').upsert(rows, { onConflict:'id' }), 'residents');
  const householdDefs = [['HH-SI-001','Ramon Santos Dela Cruz','Purok 1'],['HH-SI-002','Edgardo Reyes Mercado','Purok 2'],['HH-SI-003','Danilo Cabrera Mendoza','Purok 3'],['HH-SI-004','Joel Navarro Cabrera','Purok 4'],['HH-SI-005','Celia Ramos Navarro','Purok 5']];
  await q(db.from('households').upsert(householdDefs.map(([id,head,purok],i)=>({id,municipality_id:muni.id,barangay_id:brgy.id,head_name:head,purok,street_address:`${purok}, San Isidro`,contact:`0917123400${i+1}`,hh_status:'Approved',approval_status:'Approved',verification_status:'Verified'})), { onConflict:'id' }), 'households');
  for (let i=0;i<20;i++) { const h=householdDefs[Math.floor(i/4)][0]; const r=rows[i]; await q(db.from('household_members').upsert({household_id:h,resident_id:r.id,name:`${r.first_name} ${r.middle_name} ${r.last_name}`,birthday:r.birth_date,age:2026-new Date(r.birth_date).getFullYear(),sex:r.sex,relationship:i%4===0?'Head':'Member',is_head:i%4===0,philhealth:'member'}, { onConflict:'household_id,resident_id' }), `household member ${r.id}`); }
  // Ten synthetic, resident-linked calendar events. Their natural key is the
  // resident plus purpose, so an initializer re-run never duplicates or edits
  // a calendar item that is already present.
  const calendarSamples = [
    ['SI-001', 'Blood pressure recheck', '2026-11-26', '14:30', 'High', 'Scheduled', 'RHU consultation room', 'Review the demonstration blood-pressure log and repeat screening.'],
    ['SI-002', 'Medication adherence counselling', '2026-11-26', '15:30', 'Medium', 'Scheduled', 'San Isidro Barangay Health Center', 'Synthetic counselling appointment; reinforce the demonstration care plan.'],
    ['SI-003', 'Cardiovascular risk review', '2026-11-27', '08:30', 'High', 'Scheduled', 'RHU consultation room', 'Review the demonstration risk-screening result and planned referral guidance.'],
    ['SI-004', 'Clinical reassessment visit', '2026-11-27', '10:00', 'Medium', 'Upcoming', 'San Isidro Barangay Health Center', 'Synthetic follow-up screening and health-education check-in.'],
    ['SI-005', 'Nutrition and BMI follow-up', '2026-11-28', '09:00', 'Medium', 'Upcoming', 'San Isidro Barangay Health Center', 'Review nutrition and activity goals from the demonstration consultation.'],
    ['SI-006', 'Repeat blood pressure screening', '2026-11-28', '13:00', 'Medium', 'Upcoming', 'RHU consultation room', 'Repeat synthetic screening and document health-education discussion.'],
    ['SI-011', 'Community wellness consultation', '2026-11-28', '10:30', 'Low', 'Scheduled', 'San Isidro Barangay Health Center', 'Synthetic wellness check-in and preventive-health education.'],
    ['SI-013', 'Healthy lifestyle planning', '2026-11-28', '14:30', 'Low', 'Scheduled', 'San Isidro Barangay Health Center', 'Synthetic activity and nutrition goal-setting follow-up.'],
    ['SI-014', 'Preventive screening review', '2026-11-28', '15:30', 'Low', 'Scheduled', 'RHU consultation room', 'Synthetic preventive screening review and routine monitoring guidance.'],
    ['SI-007', 'Older adult wellness monitoring', '2026-11-29', '09:30', 'Medium', 'Upcoming', 'San Isidro Barangay Health Center', 'Synthetic routine wellness monitoring appointment.'],
    ['SI-008', 'Health education check-in', '2026-11-29', '14:00', 'Low', 'Scheduled', 'San Isidro Barangay Health Center', 'Confirm understanding of the demonstration self-care plan.'],
    ['SI-009', 'Preventive care review', '2026-11-30', '08:30', 'Low', 'Scheduled', 'San Isidro Barangay Health Center', 'Synthetic preventive-care review; no clinical decision-making.'],
    ['SI-010', 'Routine wellness reassessment', '2026-11-30', '10:30', 'Low', 'Scheduled', 'RHU consultation room', 'Synthetic routine reassessment and community-health guidance.'],
  ];
  const followups = calendarSamples.map(([resident_id, purpose, scheduled_date, scheduled_time, priority, status, location, notes], i) => ({
    resident_id, purpose, scheduled_date, scheduled_time, priority, status, location,
    assigned_provider: i % 2 ? 'Maria Teresa Dela Cruz' : 'Josephine Mae Villanueva',
    notes: `DEMONSTRATION ONLY — ${notes}`,
    requires_resident_response: false,
    resident_decision: null,
  }));
  for (const f of followups) await q(db.from('follow_ups').select('id').eq('resident_id',f.resident_id).eq('purpose',f.purpose).maybeSingle().then(async ({data,error})=> error ? {data,error} : data ? {data,error:null} : db.from('follow_ups').insert(f)), 'follow-up');
  // Correct the four legacy demonstration entries created before this calendar
  // sample set was refined. A future appointment must never be shown as
  // completed. This touches only the known synthetic rows, never user-created
  // follow-ups, and is a no-op once their dates have passed.
  const manilaToday = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Manila', year:'numeric', month:'2-digit', day:'2-digit' })
    .formatToParts(new Date()).reduce((date, part) => ({ ...date, [part.type]:part.value }), {});
  const today = `${manilaToday.year}-${manilaToday.month}-${manilaToday.day}`;
  for (const [residentId, purpose] of [
    ['SI-007', 'Older adult scheduled monitoring'],
    ['SI-008', 'Health education follow-up'],
    ['SI-009', 'Preventive health monitoring'],
    ['SI-010', 'Routine reassessment'],
  ]) {
    await q(db.from('follow_ups').update({ status:'Scheduled', completed_at:null })
      .eq('resident_id', residentId).eq('purpose', purpose).eq('status', 'Completed').gt('scheduled_date', today),
    'future demonstration follow-up status correction');
  }
  // Historical outcome samples feed the Health Trends Follow-up Completion
  // table. Every item is visibly synthetic and has a scheduled date inside the
  // selected reporting period; only dates already in the past are completed.
  const trendFollowUpSamples = [
    ['SI-011', '2025-12-18', 'Completed'], ['SI-012', '2026-01-16', 'Missed'],
    ['SI-013', '2026-02-13', 'Completed'], ['SI-014', '2026-03-17', 'Completed'],
    ['SI-015', '2026-04-14', 'Missed'], ['SI-016', '2026-05-19', 'Completed'],
    ['SI-017', '2026-06-16', 'Completed'], ['SI-018', '2026-07-21', 'Missed'],
    ['SI-019', '2026-08-18', 'Completed'], ['SI-020', '2026-09-15', 'Completed'],
    ['SI-011', '2026-10-20', 'Missed'], ['SI-012', '2026-11-20', 'Completed'],
  ].map(([resident_id, scheduled_date, status]) => ({
    resident_id, scheduled_date, status, scheduled_time:'09:00', location:'San Isidro Barangay Health Center', priority:'Low',
    purpose:`DEMONSTRATION ONLY — Follow-up outcome sample (${scheduled_date.slice(0, 7)})`,
    assigned_provider:'RHU Consultation Personnel',
    notes:'Synthetic training data for Health Trends only; not an actual patient encounter or clinical outcome.',
    requires_resident_response:false, resident_decision:null,
    ...(status === 'Completed' ? { completed_at:`${scheduled_date}T10:00:00+08:00` } : {}),
  }));
  for (const sample of trendFollowUpSamples) await q(db.from('follow_ups').select('id')
    .eq('resident_id', sample.resident_id).eq('purpose', sample.purpose).maybeSingle().then(async ({ data, error }) =>
      error ? { data, error } : data ? { data, error:null } : db.from('follow_ups').insert(sample)), 'Health Trends demonstration follow-up');
  const maternal = rows.filter(r=>r.sex==='Female').slice(0,5).map((r,i)=>({resident_id:r.id,program:'Maternal',priority:i<2?'High':'Medium',status:'Active',last_visit:`2026-11-${10+i}`,next_visit:`2026-12-${10+i}`,notes:'Prenatal monitoring record; continue scheduled maternal care.'}));
  for (const [i,m] of maternal.entries()) { const existing=await q(db.from('tcl_entries').select('id').eq('resident_id',m.resident_id).eq('program','Maternal').maybeSingle(),'TCL lookup'); if(!existing) await q(db.from('tcl_entries').insert({...m,assigned_bhw_id:i%2?auth.bhw1:auth.bhw2}),'TCL entry'); }
  for (const r of rows.filter(r=>r.sex==='Female').slice(0,5)) { const existing=await q(db.from('maternal_records').select('id').eq('resident_id',r.id).maybeSingle(),'maternal lookup'); if(!existing) await q(db.from('maternal_records').insert({resident_id:r.id,lmp:'2026-08-01',edd:'2027-05-08',prenatal_visits:3,risk:'Low',status:'Active',provider:'Lourdes Elena Mercado',notes:'Routine prenatal monitoring.'}),'maternal record'); }
  const services = [
    { id:'1f510001-0000-4000-8000-000000000001', name:'Blood Pressure Monitoring', category:'Consultation' },
    { id:'1f510002-0000-4000-8000-000000000002', name:'Older Adult Wellness', category:'Consultation' },
    { id:'1f510003-0000-4000-8000-000000000003', name:'Cardiovascular Risk Screening', category:'Consultation' },
    { id:'1f510004-0000-4000-8000-000000000004', name:'Nutrition and BMI Counselling', category:'Consultation' },
    { id:'1f510005-0000-4000-8000-000000000005', name:'General Consultation', category:'Consultation' },
    { id:'1f510006-0000-4000-8000-000000000006', name:'Health Education', category:'Consultation' },
    { id:'1f510007-0000-4000-8000-000000000007', name:'Preventive Health Consultation', category:'Consultation' },
    { id:'1f510008-0000-4000-8000-000000000008', name:'General Consultation Follow-up', category:'Consultation' },
  ].map((service) => ({ ...service, description:'Demonstration service used by synthetic consultation records only.', municipality_id:muni.id, facility_id:rhu.id, active:true, created_by:auth.consultation }));
  const existingServices = await q(db.from('health_services').select('id').in('id', services.map((service) => service.id)), 'demonstration service lookup');
  const missingServices = services.filter((service) => !new Set(existingServices.map(({ id }) => id)).has(service.id));
  if (missingServices.length) await q(db.from('health_services').insert(missingServices), 'demonstration health services');

  const consultationRows = demonstrationConsultations.map(([id, residentId, consultationDate, consultationTime, serviceId, serviceName, bp, temperature, hr, rr, height, weight, level, findings, treatmentGiven, adviceGiven, nextVisitDate, followUpStatus]) => {
    const [systolic, diastolic] = bp.split('/').map(Number);
    const bmi = +(weight / ((height / 100) ** 2)).toFixed(1);
    const riskReason = level === 'High' ? 'Synthetic elevated blood-pressure screening requires planned reassessment.' : level === 'Medium' ? 'Synthetic screening result supports routine follow-up and health education.' : 'Synthetic routine screening result; preventive monitoring advised.';
    return {
      id, resident_id:residentId, recorded_by_id:auth.consultation, recorded_by_role:'rhu_personnel', recorded_by_name:'RHU Consultation Personnel', status:'completed',
      visit_date:`${consultationDate}T${consultationTime}:00+08:00`, recorded_at:`${consultationDate}T${consultationTime}:00+08:00`, completed_at:`${consultationDate}T${consultationTime}:00+08:00`, consultation_effects_completed_at:`${consultationDate}T${consultationTime}:00+08:00`,
      chief_complaint:`DEMONSTRATION ONLY — ${serviceName}`, findings, treatment_given:treatmentGiven, recommendation:adviceGiven, clinical_history:'Synthetic training data. This is not an actual patient encounter or medical history.',
      bp, hr, rr, o2sat:98, temperature, height_cm:height, weight_kg:weight, bmi, bmi_category:bmi >= 25 ? 'Overweight' : 'Normal', phn_assessment:'Demonstration consultation assessment', phn_notes:'Synthetic record for KALUSAGAP workflow demonstration only.',
      health_service_id:serviceId, health_service_name:serviceName, medications:[], referral_required:false,
      bp_classification:{ category: level === 'High' ? 'Stage 2 Hypertension' : level === 'Medium' ? 'Stage 1 Hypertension' : 'Normal', label:level === 'High' ? 'Stage 2 Hypertension' : level === 'Medium' ? 'Stage 1 Hypertension' : 'Normal', systolic, diastolic, classificationVersion:'demonstration-v1' },
      consultation_details:{ demonstrationRecord:true, demonstrationNotice:'Synthetic training data — not an actual patient encounter or medical history.', consultationDate, consultationTime, chiefComplaint:`DEMONSTRATION ONLY — ${serviceName}`, findings, diagnosis:'Demonstration screening assessment only; not a clinical diagnosis.', treatmentGiven, medicationPrescribed:'', adviceGiven, remarks:'Synthetic training data. Do not use for clinical decision-making.', nextVisitDate, followUpRequired:nextVisitDate ? 'Yes' : 'No', followUpStatus, healthServiceCategory:'Consultation', clinicalAssessment:{ level, status:'completed', reasons:[{ ruleId:'demonstration_screening', message:riskReason }] } },
    };
  });
  const existingConsultations = await q(db.from('visits').select('id').in('id', consultationRows.map((row) => row.id)), 'demonstration consultation lookup');
  const existingConsultationIds = new Set(existingConsultations.map(({ id }) => id));
  const missingConsultations = consultationRows.filter((row) => !existingConsultationIds.has(row.id));
  if (missingConsultations.length) await q(db.from('visits').insert(missingConsultations), 'demonstration consultations');
  console.log(JSON.stringify({barangay:'San Isidro',residents:rows.length,households:householdDefs.length,followUps:followups.length,trendFollowUps:trendFollowUpSamples.length,maternalTcl:maternal.length,demonstrationConsultations:{ inserted:missingConsultations.length, existing:existingConsultationIds.size, total:consultationRows.length },accounts:accounts.map(a=>({email:a.email,barangay:a.barangay})),oldSanRoqueResidents:0},null,2));
};
main().catch((e)=>{ console.error(e.message); process.exit(1); });
